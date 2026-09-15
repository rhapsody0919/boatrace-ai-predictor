/**
 * Supabase データサービス
 *
 * Supabaseからデータを取得し、既存のJSON形式に変換して返す
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */

import { supabase } from "./supabaseClient";
import { getVolatilityLevel } from "../utils/volatilityLevel";
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";

// race_resultsの1行が集計対象として使えるか（中止・不成立・未確定を除外）。
// getRacerVenueStats/getRacerRaceHistoryの両方で同じ判定を使うための共通化
function isUsableRaceResult(result) {
  return (
    !!result &&
    !result.is_cancelled &&
    !result.is_no_race &&
    result.rank1 !== null
  );
}

// Edge API のベースURL（本番環境では同一オリジン）
const EDGE_API_BASE = "";

/**
 * 2層キャッシュ機構（メモリ + localStorage）
 * - メモリ: 最速、セッション中のみ有効
 * - localStorage: ページリロード後も有効
 * スクレイピングは1時間に1回なので、30分間キャッシュを保持
 */
const CACHE_TTL = 30 * 60 * 1000; // 30分
// 過去レースの分析データは不変のため長期キャッシュしてよい
// （Supabase egress削減: レース単位の分析クエリは1レースあたり約0.5MBの生データを転送するため）
const PAST_RACE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7日

/**
 * キャッシュキーからTTLを推定する。
 * キー末尾がrace_id形式（YYYY-MM-DD-VV-RR）かつ過去日付なら長期TTL
 * （本日分は展示データ投入・結果確定で内容が変わるため通常TTL）
 */
function inferTtlFromKey(key) {
  const m = String(key).match(/(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}(?::.*)?$/);
  if (m) {
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];
    if (m[1] < today) return PAST_RACE_CACHE_TTL;
  }
  return CACHE_TTL;
}
const CACHE_PREFIX = "boatai:";

const cache = {
  memory: new Map(),

  /**
   * キャッシュからデータを取得
   * 1. メモリキャッシュ（最速）
   * 2. localStorageキャッシュ（リロード後も有効）
   * @param {string} key
   * @param {number} [ttl] - TTL(ms)。省略時はグローバルCACHE_TTL
   */
  get(key, ttl = CACHE_TTL) {
    // 1. メモリから
    const memCached = this.memory.get(key);
    if (memCached && Date.now() - memCached.timestamp < ttl) {
      const remaining = Math.round(
        (ttl - (Date.now() - memCached.timestamp)) / 1000,
      );
      console.log(`[Cache HIT] Memory: ${key} (${remaining}s remaining)`);
      return memCached.data;
    }

    // 2. localStorageから
    try {
      const stored = localStorage.getItem(CACHE_PREFIX + key);
      if (stored) {
        const { data, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < ttl) {
          const remaining = Math.round((ttl - (Date.now() - timestamp)) / 1000);
          console.log(
            `[Cache HIT] localStorage: ${key} (${remaining}s remaining)`,
          );
          // メモリにも復元
          this.memory.set(key, { data, timestamp });
          return data;
        } else {
          // 期限切れは削除
          localStorage.removeItem(CACHE_PREFIX + key);
        }
      }
    } catch (e) {
      console.warn("[Cache] localStorage read error:", e);
    }

    return null;
  },

  /**
   * キャッシュにデータを保存（メモリ + localStorage両方）
   */
  set(key, data) {
    const timestamp = Date.now();

    // メモリに保存（サイズ制限なし）
    this.memory.set(key, { data, timestamp });

    // localStorageに保存（サイズ制限あり: 500KB以下のみ）
    try {
      const serialized = JSON.stringify({ data, timestamp });
      const sizeKB = serialized.length / 1024;

      if (sizeKB > 500) {
        // 500KB超はlocalStorageに保存しない（メモリキャッシュのみ）
        console.log(
          `[Cache SET] ${key} (memory only, ${sizeKB.toFixed(0)}KB exceeds localStorage limit)`,
        );
        return;
      }

      localStorage.setItem(CACHE_PREFIX + key, serialized);
      console.log(`[Cache SET] ${key} (${sizeKB.toFixed(0)}KB)`);
    } catch (e) {
      // localStorage容量超過時は古いキャッシュを削除して再試行
      if (e.name === "QuotaExceededError") {
        this._cleanupOldCache();
        try {
          localStorage.setItem(
            CACHE_PREFIX + key,
            JSON.stringify({ data, timestamp }),
          );
        } catch (e2) {
          console.log(`[Cache SET] ${key} (memory only, localStorage full)`);
        }
      } else {
        console.warn("[Cache] localStorage write error:", e);
      }
    }
  },

  /**
   * キャッシュをクリア
   */
  clear(key = null) {
    if (key) {
      this.memory.delete(key);
      try {
        localStorage.removeItem(CACHE_PREFIX + key);
      } catch (e) {}
      console.log(`[Cache CLEAR] ${key}`);
    } else {
      this.memory.clear();
      this._clearAllLocalStorage();
      console.log("[Cache CLEAR] All");
    }
  },

  /**
   * localStorage内の龍神レーダーキャッシュを全削除
   */
  _clearAllLocalStorage() {
    try {
      const keys = Object.keys(localStorage).filter((k) =>
        k.startsWith(CACHE_PREFIX),
      );
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  },

  /**
   * 古いキャッシュを削除（容量超過時）
   */
  _cleanupOldCache() {
    try {
      const entries = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) {
          const stored = localStorage.getItem(key);
          if (stored) {
            const { timestamp } = JSON.parse(stored);
            entries.push({ key, timestamp });
          }
        }
      }
      // 古い順にソートして半分削除
      entries.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
      toDelete.forEach((e) => localStorage.removeItem(e.key));
      console.log(`[Cache CLEANUP] Removed ${toDelete.length} old entries`);
    } catch (e) {}
  },
};

/**
 * キャッシュ付きデータ取得
 * 同一キーの取得が進行中の場合は同じPromiseを返す（in-flightデデュープ）。
 * プリフェッチとコンポーネントの取得が重なっても二重クエリにならない
 */
const inflightRequests = new Map();

function withCache(key, fetcher, ttl) {
  const effectiveTtl = ttl ?? inferTtlFromKey(key);
  const cached = cache.get(key, effectiveTtl);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  if (inflightRequests.has(key)) {
    return inflightRequests.get(key);
  }

  console.log(`[Cache MISS] ${key}`);
  const promise = fetcher()
    .then((data) => {
      cache.set(key, data);
      return data;
    })
    .finally(() => {
      inflightRequests.delete(key);
    });
  inflightRequests.set(key, promise);
  return promise;
}

// キャッシュクリア（手動更新時に使用）
export function clearCache(key = null) {
  cache.clear(key);
}

// 配列を指定サイズごとに分割する（Supabase の in() 上限対策）
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Supabaseのデフォルトlimit(1000行)を超えるin()クエリを.range()でページネーションして全件取得する
// （race_id 1件につき最大6艇分の行がある race_start_timings/exhibition_data 等、
// 「in()のキー数 × 1行あたりの行数」が1000を超えうるクエリで使用する）
async function fetchAllByIn(table, select, column, values) {
  const results = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(column, values)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error(`${table}取得エラー:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

// 指定会場の直近90日のレース一覧を取得する（BOA-151、複数メソッドで共有するためキャッシュする）
function getRacesForVenue(venueCode, days = 90) {
  return withCache(`races-for-venue-${venueCode}-${days}`, async () => {
    if (!supabase) return [];

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);
    const cutoff = daysAgo.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("races")
      .select("race_id, race_date")
      .eq("venue_code", venueCode)
      .gte("race_date", cutoff)
      .order("race_date");

    if (error) {
      console.error("races取得エラー:", error.message);
      return [];
    }
    return data ?? [];
  });
}

const NEUTRAL_EXHIBITION_DIFF_SEC = 0.02; // これ未満は展示タイムの日次ブレの範囲内とみなす
const INTERPRETATION_WINDOW_DAYS = 3; // 前後何日分の平均で比較するか

/**
 * 指定会場・モーター番号の日次系列（race_entries+exhibition_data結合、日付単位
 * dedupe済み）を取得する内部共通ヘルパー。getMotorConditionTrend/
 * getMotorPartsHistoryの両方が同じrace_entries+exhibition_data結合パターンを
 * 必要とするため共通化（BOA-221）。withCacheで結果を共有することで、両関数が
 * 同じ(venueCode, motorNumber, days)を同時に要求した場合の二重フェッチも防ぐ
 */
function fetchMotorDailySeries(venueCode, motorNumber, days) {
  return withCache(
    `motor-daily-series-${venueCode}-${motorNumber}-${days}`,
    async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const races = await getRacesForVenue(venueCode, days);
      if (races.length === 0) return [];

      const raceDateById = new Map(races.map((r) => [r.race_id, r.race_date]));
      const raceIds = races.map((r) => r.race_id);
      const chunks = chunkArray(raceIds, 500);

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("race_entries")
            .select("race_id, boat_number, motor_2rate, motor_3rate")
            .in("race_id", chunk)
            .eq("motor_number", motorNumber)
            .order("race_id"),
        ),
      );
      let entries = [];
      results.forEach(({ data, error }) => {
        if (error) {
          console.error("race_entries取得エラー:", error.message);
          return;
        }
        entries = entries.concat(data);
      });
      if (entries.length === 0) return [];

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time, propeller_change, parts_changed",
        "race_id",
        entries.map((e) => e.race_id),
      );
      const exhibitionByKey = new Map(
        exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
      );

      // 日付単位でdedupe。motor_2rate/motor_3rate/exhibitionTimeは節単位でほぼ
      // 一定のためrace_idで安定ソート済みの先頭を採用するが、部品交換・プロペラ
      // 交換は「同日の特定の1レースだけに記録されるイベント」のため先頭決め打ちでは
      // 取りこぼす（例: 同日中の途中交換で、交換後のレースにしか記録されない）。
      // 同日の全レース分をOR/合算してdedupeする
      const byDate = new Map();
      entries
        .map((e) => ({
          ...e,
          race_date: raceDateById.get(e.race_id),
          exhibition: exhibitionByKey.get(`${e.race_id}-${e.boat_number}`),
        }))
        .filter((e) => e.race_date)
        .sort(
          (a, b) =>
            a.race_date.localeCompare(b.race_date) ||
            a.race_id.localeCompare(b.race_id),
        )
        .forEach((e) => {
          const propellerChanged = !!e.exhibition?.propeller_change;
          const parts = e.exhibition?.parts_changed ?? null;
          const existing = byDate.get(e.race_date);
          if (!existing) {
            byDate.set(e.race_date, {
              date: e.race_date,
              motor_2rate: e.motor_2rate,
              motor_3rate: e.motor_3rate,
              exhibitionTime: e.exhibition?.exhibition_time ?? null,
              propellerChanged,
              parts,
            });
            return;
          }
          existing.propellerChanged =
            existing.propellerChanged || propellerChanged;
          if (parts && parts.length > 0) {
            existing.parts = [
              ...new Set([...(existing.parts ?? []), ...parts]),
            ];
          }
        });

      return [...byDate.values()];
    },
  );
}

/**
 * 会場コード→会場名のマッピング
 */
const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

async function fetchVenueWinRateMap() {
  if (!supabase) return {};
  const { data } = await supabase
    .from("venues")
    .select("code, avg_first_win_rate");
  return Object.fromEntries(
    (data || []).map((v) => [v.code, v.avg_first_win_rate]),
  );
}

/**
 * race_results 1件分（camelCaseに正規化済み）から raceData.result を組み立てる共通ヘルパー
 * （BOA-238。Edge API経路/直接クエリ経路の2箇所から呼ばれるため重複を避けるために切り出した）
 * rank4〜6・追加payout種別・人気はバックフィルしていない過去データではnullのため、
 * 各セクションはpayoutが存在する場合のみエントリを持つ設計にしている
 *
 * ⚠️ 命名注意: 引数r（DB race_results由来）のpayoutTrifecta/payoutTrioは歴史的経緯で
 * 英語名と実態が逆転している（Trifecta=3連単/Trio=3連複が正しい英語ギャンブル用語で、
 * アプリ内の他機能（TrifectaReferenceCard.jsx等）もこの正しい意味で使っている）。
 * この関数の出力オブジェクトでは同じ混乱を持ち込まないよう、実際の意味で
 * sanrenpuku（3連複）/sanrentan（3連単）という曖昧さの無いキー名で正規化する
 */
function buildRaceResult(r) {
  if (!r || !r.rank1) return null;

  const sortAsc = (nums) => [...nums].sort((a, b) => a - b);
  const wideEntry = (amount, popularity, boats) =>
    amount
      ? { boats: sortAsc(boats), amount, popularity: popularity ?? null }
      : null;

  return {
    finished: true,
    isCancelled: r.isCancelled || false,
    isNoRace: r.isNoRace || false,
    rank1: r.rank1,
    rank2: r.rank2,
    rank3: r.rank3,
    rank4: r.rank4 ?? null,
    rank5: r.rank5 ?? null,
    rank6: r.rank6 ?? null,
    raceTimes: [
      r.raceTime1,
      r.raceTime2,
      r.raceTime3,
      r.raceTime4,
      r.raceTime5,
      r.raceTime6,
    ].map((t) => t || null),
    winningTechnique: r.winningTechnique || null,
    payouts: {
      win: r.payoutWin ? { boats: [r.rank1], amount: r.payoutWin } : null,
      place: [
        r.payoutPlace1 ? { boat: r.rank1, amount: r.payoutPlace1 } : null,
        r.payoutPlace2 ? { boat: r.rank2, amount: r.payoutPlace2 } : null,
      ].filter(Boolean),
      // DB列名はpayout_trifectaだが実態は3連複（順不同）
      sanrenpuku: r.payoutTrifecta
        ? {
            boats: sortAsc([r.rank1, r.rank2, r.rank3]),
            amount: r.payoutTrifecta,
            popularity: r.popularityTrifecta ?? null,
          }
        : null,
      // DB列名はpayout_trioだが実態は3連単（着順通り）
      sanrentan: r.payoutTrio
        ? {
            boats: [r.rank1, r.rank2, r.rank3],
            amount: r.payoutTrio,
            popularity: r.popularityTrio ?? null,
          }
        : null,
      exacta: r.payoutExacta
        ? {
            boats: [r.rank1, r.rank2],
            amount: r.payoutExacta,
            popularity: r.popularityExacta ?? null,
          }
        : null,
      quinella: r.payoutQuinella
        ? {
            boats: sortAsc([r.rank1, r.rank2]),
            amount: r.payoutQuinella,
            popularity: r.popularityQuinella ?? null,
          }
        : null,
      wide: [
        wideEntry(r.payoutWide1, r.popularityWide1, [r.rank1, r.rank2]),
        wideEntry(r.payoutWide2, r.popularityWide2, [r.rank1, r.rank3]),
        wideEntry(r.payoutWide3, r.popularityWide3, [r.rank2, r.rank3]),
      ].filter(Boolean),
    },
  };
}

/**
 * Edge APIレスポンスをフロント期待形式に変換
 * Edge API(RPC)とSupabase直接クエリの構造差異を吸収する
 */
function transformEdgeResponse(edgeData, date, venueWinRateMap = {}) {
  const transformedRaces = (edgeData.races || []).map((race) => {
    const entries = race.entries || [];
    const predictions = race.predictions || {};

    // players配列を作成（entriesからaiScoreでソート）
    const createPlayers = (modelPred, scoreField) =>
      entries
        .map((e) => ({
          number: e.number,
          name: e.name,
          racerId: e.racerId ?? null,
          grade: e.grade,
          age: e.age,
          winRate: String(e.winRate || ""),
          localWinRate: String(e.localWinRate || ""),
          global2Rate: e.global2Rate != null ? String(e.global2Rate) : null,
          motorNumber: e.motorNumber,
          motor2Rate: String(e.motor2Rate || ""),
          boatNumber: e.boatNumber,
          boat2Rate: String(e.boat2Rate || ""),
          aiScore: e[scoreField] || 0,
        }))
        .sort((a, b) => b.aiScore - a.aiScore);

    // turnPrediction を取得（standardの予測に含まれる）
    const stdPred = predictions.standard;
    const rawTurn = stdPred?.turnPrediction || null;
    const turnPrediction = rawTurn
      ? {
          ...rawTurn,
          patterns: rawTurn.patterns || [
            {
              technique: rawTurn.technique,
              winnerCourse: rawTurn.winnerCourse,
              probability: rawTurn.probability,
            },
          ],
        }
      : null;

    const raceData = {
      raceId: race.raceId,
      venue:
        race.venue || VENUE_NAMES[race.venueCode] || `会場${race.venueCode}`,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime || "",
      cancellationStatus: race.cancellationStatus ?? null,
      raceGrade: race.raceGrade ?? null,
      raceTitle: race.raceTitle ?? null,
      seriesDay: race.seriesDay ?? null,
      isFinalDay: race.isFinalDay ?? null,
      raceStage: race.raceStage ?? null,
      volatility: race.volatility
        ? {
            ...race.volatility,
            venueWinRate: venueWinRateMap[race.venueCode] ?? null,
          }
        : null,
      turnPrediction,
      racerStats: stdPred?.racerStats || null,
      exhibitionData:
        race.exhibitionData?.map((ed) => ({
          boat_number: ed.boatNumber,
          exhibition_time: ed.exhibitionTime,
          start_timing: ed.startTiming,
        })) || null,
      predictionOdds: race.predictionOdds || null,
      // モデル非依存の選手一覧（race_entriesから直接構築、DataRaceTable等がunifiedモデルの
      // predictions行が無い過去日付でも表示できるようにするため）
      players: createPlayers(null, null),
    };

    // 予測データ（モデル別）
    raceData.predictions = {};
    for (const [modelId, pred] of Object.entries(predictions)) {
      if (!pred) continue;
      // unifiedモデル専用のai_score列はDBに存在しない（旧3モデル
      // aiScoreStandard/SafeBet/UpsetFocusのみ）。従来はここが必ずaiScoreUpsetFocusに
      // フォールバックしており、unified.playersを直接参照する経路が増えた場合に
      // 穴狙いモデルの並び順が紛れ込むバグになっていた（2026-08-14修正、BOA-187）。
      // nullを渡しaiScore=0（順位付け不能）として扱う
      const scoreField =
        modelId === "standard"
          ? "aiScoreStandard"
          : modelId === "safeBet"
            ? "aiScoreSafeBet"
            : modelId === "upsetFocus"
              ? "aiScoreUpsetFocus"
              : null;
      const players = createPlayers(pred, scoreField);
      const topPickPlayer = players.find((p) => p.number === pred.topPick);
      raceData.predictions[modelId] = {
        topPick: pred.topPick,
        top3: pred.top3 || [pred.topPick],
        confidence: Number(pred.confidence) || 0,
        players,
        reasoning: generateReasoning(topPickPlayer, modelId),
      };
    }

    // unifiedモデル（AI予想モデル大規模改修）: turnPrediction/volatilityPercentile/reasonsは
    // 019マイグレーション時点でturnPredictionのみRPCから汎用的に取得できていたが、
    // volatilityPercentile/volatilityReasonsは031マイグレーション未適用の間はundefinedになる
    // （docs/db-migration/031_add_unified_fields_to_predictions_rpc.sql参照、SUPABASE_ACCESS_TOKEN
    // 失効中のため2026-08-13時点で未適用。適用後はEdge API経由でも取得できるようになる）
    const unifiedRaw = predictions.unified;
    if (unifiedRaw) {
      const rawUnifiedTurn = unifiedRaw.turnPrediction || null;
      raceData.unified = {
        topPick: unifiedRaw.topPick,
        top2nd: unifiedRaw.top3?.[1] ?? null,
        players: raceData.predictions.unified?.players || [],
        turnPrediction: rawUnifiedTurn
          ? {
              ...rawUnifiedTurn,
              patterns: rawUnifiedTurn.patterns || [
                {
                  technique: rawUnifiedTurn.technique,
                  winnerCourse: rawUnifiedTurn.winnerCourse,
                  probability: rawUnifiedTurn.probability,
                },
              ],
            }
          : null,
        volatilityPercentile: unifiedRaw.volatilityPercentile ?? null,
        volatilityPercentileIsFallback:
          unifiedRaw.volatilityPercentileIsFallback ?? null,
        volatilityReasons: unifiedRaw.volatilityReasons || [],
      };
    }

    // 結果データ（051マイグレーションでresultのjson_build_objectに追加したキーは
    // 既にcamelCaseのためbuildRaceResult()にそのまま渡せる）
    raceData.result = buildRaceResult(race.result);

    return raceData;
  });

  return {
    date,
    generatedAt: edgeData.generatedAt || new Date().toISOString(),
    updatedAt: edgeData.updatedAt || new Date().toISOString(),
    races: transformedRaces,
  };
}

/**
 * 予想根拠を生成する関数
 * 各モデルの特性に基づいた詳細な分析結果を生成
 */
function generateReasoning(topPickPlayer, modelType) {
  if (!topPickPlayer) return ["予想データなし"];

  const reasons = [];
  const number = topPickPlayer.number;
  const name = topPickPlayer.name;
  const grade = topPickPlayer.grade || "";
  const winRate = parseFloat(topPickPlayer.winRate) || 0;
  const localWinRate = parseFloat(topPickPlayer.localWinRate) || 0;
  const motor2Rate = parseFloat(topPickPlayer.motor2Rate) || 0;
  const boat2Rate = parseFloat(topPickPlayer.boat2Rate) || 0;

  if (modelType === "standard") {
    // スタンダードモデル: 選手実力・機材・コース・当地相性を総合評価
    reasons.push(`【総合分析】${number}号艇 ${name}選手を本命に選定`);

    // 選手評価
    const playerAnalysis = [];
    if (grade === "A1") playerAnalysis.push("最高峰A1級の実力");
    else if (grade === "A2") playerAnalysis.push("上位A2級の安定感");
    else if (grade === "B1") playerAnalysis.push("B1級");

    if (winRate >= 7.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}はトップクラス`);
    else if (winRate >= 6.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}の高水準`);
    else if (winRate >= 5.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}`);

    if (playerAnalysis.length > 0) {
      reasons.push(`選手力: ${playerAnalysis.join("、")}`);
    }

    // 機材評価
    const equipAnalysis = [];
    if (motor2Rate >= 45)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%は上位機`);
    else if (motor2Rate >= 35)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%で安定`);
    if (boat2Rate >= 40)
      equipAnalysis.push(`ボート2連率${topPickPlayer.boat2Rate}%の好艇`);

    if (equipAnalysis.length > 0) {
      reasons.push(`機材力: ${equipAnalysis.join("、")}`);
    }

    // 当地・コース評価
    const courseAnalysis = [];
    if (number === 1) courseAnalysis.push("1コースの圧倒的有利を活かせる位置");
    else if (number <= 3)
      courseAnalysis.push(`${number}コースからのスタート展開に期待`);

    if (localWinRate >= 7.0)
      courseAnalysis.push(`当地勝率${topPickPlayer.localWinRate}と抜群の相性`);
    else if (localWinRate >= 5.5)
      courseAnalysis.push(
        `当地勝率${topPickPlayer.localWinRate}で水面適性あり`,
      );

    if (courseAnalysis.length > 0) {
      reasons.push(`展開: ${courseAnalysis.join("、")}`);
    }

    reasons.push("→ 独自の重み付けアルゴリズムにより総合スコア最高と判定");
  } else if (modelType === "safeBet") {
    // 本命狙いモデル: 的中率重視、1コース・A級選手・安定性を重視
    reasons.push(`【堅実分析】${number}号艇 ${name}選手を本命に選定`);

    // コース優位性（本命狙いでは最重要）
    if (number === 1) {
      reasons.push(`コース: 1号艇は統計上55%以上の1着率、最も信頼できるコース`);
    } else if (number === 2) {
      reasons.push(`コース: 2号艇から差し・まくりの展開を想定`);
    } else if (number === 3) {
      reasons.push(`コース: 3号艇からまくり展開の可能性を評価`);
    } else {
      reasons.push(`コース: ${number}号艇ながら他要素で高評価`);
    }

    // 選手の安定性評価
    const stabilityAnalysis = [];
    if (grade === "A1") {
      stabilityAnalysis.push("A1級選手は安定した成績を残す傾向が強い");
      if (winRate >= 7.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}は信頼度◎`);
    } else if (grade === "A2") {
      stabilityAnalysis.push("A2級選手として堅実なレース運び");
      if (winRate >= 6.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}で期待十分`);
    } else if (grade === "B1" && winRate >= 5.5) {
      stabilityAnalysis.push(
        `B1級ながら勝率${topPickPlayer.winRate}と実力上位`,
      );
    }

    if (stabilityAnalysis.length > 0) {
      reasons.push(`安定性: ${stabilityAnalysis.join("、")}`);
    }

    // 機材の信頼性
    if (motor2Rate >= 40 || boat2Rate >= 40) {
      const equipParts = [];
      if (motor2Rate >= 40)
        equipParts.push(`モーター${topPickPlayer.motor2Rate}%`);
      if (boat2Rate >= 40) equipParts.push(`ボート${topPickPlayer.boat2Rate}%`);
      reasons.push(`機材信頼度: ${equipParts.join("・")}で堅実`);
    }

    reasons.push("→ 的中率を最大化する独自ロジックにより選出");
  } else if (modelType === "upsetFocus") {
    // 穴狙いモデル: 期待値・回収率重視、過小評価されている要素を発掘
    reasons.push(`【穴馬分析】${number}号艇 ${name}選手を本命に選定`);

    // 穴要素の分析
    const upsetFactors = [];

    // アウトコースからの逆転要素
    if (number >= 4) {
      if (motor2Rate >= 40) {
        upsetFactors.push(
          `${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の上位機で逆転機会あり`,
        );
      } else if (motor2Rate >= 33) {
        upsetFactors.push(
          `${number}号艇でもモーター${topPickPlayer.motor2Rate}%でまくり展開を狙える`,
        );
      }
    } else if (number >= 2 && number <= 3) {
      if (localWinRate > winRate + 0.5) {
        upsetFactors.push(
          `当地勝率${topPickPlayer.localWinRate}が全国勝率を上回る隠れた適性`,
        );
      }
    }

    // 過小評価されがちな要素
    if (grade === "B1" && winRate >= 5.5) {
      upsetFactors.push(`B1級でも勝率${topPickPlayer.winRate}は侮れない実力`);
    }
    if (grade === "B1" && localWinRate >= 6.5) {
      upsetFactors.push(
        `当地勝率${topPickPlayer.localWinRate}は格上選手に匹敵`,
      );
    }
    if (grade === "A2" && number >= 3 && motor2Rate >= 38) {
      upsetFactors.push("A2級×好モーターの組み合わせで高配当狙い");
    }

    // ボート・モーターの爆発力
    if (motor2Rate >= 45) {
      upsetFactors.push(
        `モーター2連率${topPickPlayer.motor2Rate}%は上位3%の好機、波乱の主役候補`,
      );
    }

    if (upsetFactors.length > 0) {
      reasons.push(`発掘要素: ${upsetFactors.join("。")}`);
    } else {
      reasons.push(
        "発掘要素: 独自の期待値計算により高配当時の回収効率が高いと判定",
      );
    }

    // 期待値の説明
    if (number >= 4) {
      reasons.push(`配当期待: ${number}号艇の1着時は高配当が見込める`);
    } else if (grade === "B1") {
      reasons.push("配当期待: B1級選手の1着は配当妙味あり");
    }

    reasons.push("→ 回収率最大化を目指す独自アルゴリズムにより選出");
  }

  return reasons;
}

/**
 * Supabase データサービス
 */
export const supabaseDataService = {
  /**
   * レースデータを取得（races.json形式で返す）
   * Phase 2: Edge API経由でCDNキャッシュを活用
   */
  async getRaces() {
    // 今日の日付（JST）
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`races-${today}`, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/races/today`);
        if (edgeResponse.ok) {
          const data = await edgeResponse.json();
          if (data.success && data.data) {
            console.log("[getRaces] Edge API success");
            // Edge APIはvenuesテーブルをjoinしないためvenueWinRateを別途取得
            const venueWinRateMap = await fetchVenueWinRateMap();
            return {
              success: true,
              data: data.data.map((venue) => ({
                placeCd: venue.place_cd || venue.placeCd,
                placeName:
                  venue.place_name ||
                  venue.placeName ||
                  VENUE_NAMES[venue.place_cd || venue.placeCd],
                races: (venue.races || []).map((race) => ({
                  ...race,
                  volatility: race.volatility
                    ? {
                        ...race.volatility,
                        venueWinRate: venueWinRateMap[race.placeCd] ?? null,
                      }
                    : null,
                })),
              })),
              scrapedAt: data.scrapedAt || new Date().toISOString(),
            };
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaces] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { success: false, data: [], scrapedAt: null };
      }

      // 今日のレースを取得
      const { data: races, error: racesError } = await supabase
        .from("races")
        .select(
          `
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
        race_grade,
        cancellation_status,
        race_conditions (
          series_day,
          is_final_day,
          race_title,
          race_stage
        ),
        race_entries (
          boat_number,
          player_name,
          grade,
          age,
          win_rate,
          local_win_rate,
          global_2rate,
          motor_number,
          motor_2rate,
          boat_number_id,
          boat_2rate
        )
      `,
        )
        .eq("race_date", today)
        .order("venue_code")
        .order("race_number");

      if (racesError) {
        console.error("Supabase getRaces error:", racesError.message);
        return { success: false, data: [], scrapedAt: null };
      }

      // 会場別1コース勝率（直近90日）を取得
      const venueWinRateMap = await fetchVenueWinRateMap();

      // イン崩れ指数はunifiedモデル（predictions.feature_contributions.
      // volatilityPercentile）基準に統一する（旧races.volatility_score/level は
      // generate-predictions.js（旧3モデル）由来で別ロジックのため不使用。2026-08-15）
      const { data: unifiedPreds } = await supabase
        .from("predictions")
        .select("race_id, feature_contributions")
        .eq("model_id", "unified")
        .in(
          "race_id",
          races.map((r) => r.race_id),
        );
      const volatilityByRaceId = new Map();
      // 展開予測（先頭パターンのみ）。get_today_races RPC（052マイグレーション）と
      // 同じ情報源・同じ抜き出し方に揃える
      const turnPredictionByRaceId = new Map();
      for (const pred of unifiedPreds || []) {
        const percentile = pred.feature_contributions?.volatilityPercentile;
        if (typeof percentile === "number") {
          volatilityByRaceId.set(pred.race_id, {
            percentile,
            isFallback:
              pred.feature_contributions?.volatilityPercentileIsFallback ??
              false,
            level: getVolatilityLevel(percentile),
          });
        }
        const topPattern =
          pred.feature_contributions?.turnPrediction?.patterns?.[0];
        if (topPattern) {
          turnPredictionByRaceId.set(pred.race_id, topPattern);
        }
      }

      // 会場ごとにグループ化
      const venueMap = new Map();

      for (const race of races) {
        const venueCode = race.venue_code;

        if (!venueMap.has(venueCode)) {
          venueMap.set(venueCode, {
            placeCd: venueCode,
            placeName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
            races: [],
          });
        }

        // レースデータを変換
        const raceData = {
          raceNo: race.race_number,
          startTime: race.start_time?.substring(0, 5) || "",
          cancellationStatus: race.cancellation_status ?? null,
          date: race.race_date,
          placeCd: race.venue_code,
          raceGrade: race.race_grade ?? null,
          raceTitle: race.race_conditions?.race_title ?? null,
          seriesDay: race.race_conditions?.series_day ?? null,
          isFinalDay: race.race_conditions?.is_final_day ?? null,
          raceStage: race.race_conditions?.race_stage ?? null,
          volatility: volatilityByRaceId.has(race.race_id)
            ? {
                ...volatilityByRaceId.get(race.race_id),
                venueWinRate: venueWinRateMap[race.venue_code] ?? null,
              }
            : null,
          turnPrediction: turnPredictionByRaceId.get(race.race_id) ?? null,
          racers: (race.race_entries || []).map((entry) => ({
            waku: entry.boat_number,
            name: (entry.player_name || "").replace(/\s+/g, ""),
            rank: entry.grade,
            age: entry.age,
            winRate: entry.win_rate,
            localWinRate: entry.local_win_rate,
            motorNo: entry.motor_number,
            motor2Rate: entry.motor_2rate,
            boatNo: entry.boat_number_id,
            boat2Rate: entry.boat_2rate,
          })),
        };

        venueMap.get(venueCode).races.push(raceData);
      }

      return {
        success: true,
        data: Array.from(venueMap.values()),
        scrapedAt: new Date().toISOString(),
      };
    }); // withCache end
  },

  /**
   * 予測データを取得（predictions/YYYY-MM-DD.json形式で返す）
   * Phase 2: Edge API経由でCDNキャッシュを活用
   */
  async getPredictions(date, { light = false } = {}) {
    const cacheKey = light
      ? `predictions-light-${date}`
      : `predictions-${date}`;
    return withCache(cacheKey, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      const lightParam = light ? "?light=true" : "";
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/predictions/${date}${lightParam}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.races && edgeData.races.length > 0) {
            console.log(
              `[getPredictions] Edge API success: ${edgeData.races.length} races${light ? " (light)" : ""}`,
            );
            // Edge APIはvenuesテーブルをjoinしないためvenueWinRateを別途取得
            const venueWinRateMap = await fetchVenueWinRateMap();
            return transformEdgeResponse(edgeData, date, venueWinRateMap);
          }
        }
      } catch (edgeError) {
        console.log(
          "[getPredictions] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { date, generatedAt: null, updatedAt: null, races: [] };
      }

      // レースと予測と結果を取得
      const { data: races, error: racesError } = await supabase
        .from("races")
        .select(
          `
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
        race_grade,
        cancellation_status,
        race_conditions (
          series_day,
          is_final_day,
          race_title,
          race_stage
        ),
        race_entries (
          boat_number,
          player_name,
          racer_id,
          grade,
          age,
          win_rate,
          local_win_rate,
          global_2rate,
          motor_number,
          motor_2rate,
          boat_number_id,
          boat_2rate,
          ai_score_standard,
          ai_score_safe_bet,
          ai_score_upset_focus
        ),
        predictions (
          model_id,
          top_pick,
          top_2nd,
          top_3rd,
          confidence,
          is_hit_win,
          is_hit_place,
          feature_contributions
        ),
        race_results (
          rank1,
          rank2,
          rank3,
          rank4,
          rank5,
          rank6,
          race_time_1,
          race_time_2,
          race_time_3,
          race_time_4,
          race_time_5,
          race_time_6,
          is_cancelled,
          is_no_race,
          payout_win,
          payout_place_1,
          payout_place_2,
          payout_trifecta,
          payout_trio,
          payout_exacta,
          payout_quinella,
          payout_wide_1,
          payout_wide_2,
          payout_wide_3,
          popularity_trifecta,
          popularity_trio,
          popularity_exacta,
          popularity_quinella,
          popularity_wide_1,
          popularity_wide_2,
          popularity_wide_3,
          winning_technique
        ),
        exhibition_data (
          boat_number,
          exhibition_time,
          start_timing
        ),
        prediction_odds (
          updated_at,
          trifecta_pred_standard,
          trifecta_odds_standard,
          trio_pred_standard,
          trio_odds_standard,
          trifecta_pred_safe_bet,
          trifecta_odds_safe_bet,
          trio_pred_safe_bet,
          trio_odds_safe_bet,
          trifecta_pred_upset_focus,
          trifecta_odds_upset_focus,
          trio_pred_upset_focus,
          trio_odds_upset_focus
        )
      `,
        )
        .eq("race_date", date)
        .order("venue_code")
        .order("race_number");

      if (racesError) {
        console.error("Supabase getPredictions error:", racesError.message);
        return { date, generatedAt: null, updatedAt: null, races: [] };
      }

      // JSON形式に変換
      const transformedRaces = races.map((race) => {
        const entries = race.race_entries || [];
        const predictions = race.predictions || [];
        const result = race.race_results?.[0] || race.race_results;

        // 予測データをモデル別に整理
        const standardPred = predictions.find((p) => p.model_id === "standard");
        const safeBetPred = predictions.find((p) => p.model_id === "safeBet");
        const upsetPred = predictions.find((p) => p.model_id === "upsetFocus");
        const unifiedPred = predictions.find((p) => p.model_id === "unified");

        // turnPredictionを取得（standardのfeature_contributionsに格納）
        const rawTurn =
          standardPred?.feature_contributions?.turnPrediction || null;
        const turnPrediction = rawTurn
          ? {
              ...rawTurn,
              patterns: rawTurn.patterns || [
                {
                  technique: rawTurn.technique,
                  winnerCourse: rawTurn.winnerCourse,
                  probability: rawTurn.probability,
                },
              ],
            }
          : null;

        // players配列を作成（aiScoreで降順ソート）
        const createPlayers = (pred, scoreField) =>
          entries
            .map((e) => ({
              number: e.boat_number,
              name: (e.player_name || "").replace(/\s+/g, ""),
              racerId: e.racer_id ?? null,
              grade: e.grade,
              age: e.age,
              winRate: String(e.win_rate || ""),
              localWinRate: String(e.local_win_rate || ""),
              global2Rate:
                e.global_2rate != null ? String(e.global_2rate) : null,
              motorNumber: e.motor_number,
              motor2Rate: String(e.motor_2rate || ""),
              boatNumber: e.boat_number_id,
              boat2Rate: String(e.boat_2rate || ""),
              aiScore: e[scoreField] || 0,
            }))
            .sort((a, b) => b.aiScore - a.aiScore);

        // prediction_odds（1行 or null）
        const po = race.prediction_odds ?? null;
        const predictionOdds = po
          ? {
              updatedAt: po.updated_at ?? null,
              trifectaPredStandard: po.trifecta_pred_standard ?? null,
              trifectaOddsStandard:
                po.trifecta_odds_standard != null
                  ? Number(po.trifecta_odds_standard)
                  : null,
              trioPredStandard: po.trio_pred_standard ?? null,
              trioOddsStandard:
                po.trio_odds_standard != null
                  ? Number(po.trio_odds_standard)
                  : null,
              trifectaPredSafeBet: po.trifecta_pred_safe_bet ?? null,
              trifectaOddsSafeBet:
                po.trifecta_odds_safe_bet != null
                  ? Number(po.trifecta_odds_safe_bet)
                  : null,
              trioPredSafeBet: po.trio_pred_safe_bet ?? null,
              trioOddsSafeBet:
                po.trio_odds_safe_bet != null
                  ? Number(po.trio_odds_safe_bet)
                  : null,
              trifectaPredUpsetFocus: po.trifecta_pred_upset_focus ?? null,
              trifectaOddsUpsetFocus:
                po.trifecta_odds_upset_focus != null
                  ? Number(po.trifecta_odds_upset_focus)
                  : null,
              trioPredUpsetFocus: po.trio_pred_upset_focus ?? null,
              trioOddsUpsetFocus:
                po.trio_odds_upset_focus != null
                  ? Number(po.trio_odds_upset_focus)
                  : null,
            }
          : null;

        const raceData = {
          raceId: race.race_id,
          venue: VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`,
          venueCode: race.venue_code,
          raceNumber: race.race_number,
          startTime: race.start_time?.substring(0, 5) || "",
          cancellationStatus: race.cancellation_status ?? null,
          raceGrade: race.race_grade ?? null,
          raceTitle: race.race_conditions?.race_title ?? null,
          seriesDay: race.race_conditions?.series_day ?? null,
          isFinalDay: race.race_conditions?.is_final_day ?? null,
          raceStage: race.race_conditions?.race_stage ?? null,
          // イン崩れ指数（旧「荒れ度」）はunifiedモデルのvolatilityPercentile
          // （raceData.unified.volatilityPercentile）に一本化済み。旧
          // races.volatility_score/level（generate-predictions.jsが今も書き込み
          // 続けているが読み手が無い値）は使用しない（2026-08-16、ユーザー指摘）
          turnPrediction: turnPrediction,
          racerStats: standardPred?.feature_contributions?.racerStats || null,
          exhibitionData: race.exhibition_data || null,
          predictionOdds,
          // モデル非依存の選手一覧（race_entriesから直接構築、DataRaceTable等がunifiedモデルの
          // predictions行が無い過去日付でも表示できるようにするため）
          players: createPlayers(null, null),
        };

        // 予測データ（新形式: predictions）
        if (standardPred || safeBetPred || upsetPred) {
          raceData.predictions = {};

          if (standardPred) {
            const players = createPlayers(standardPred, "ai_score_standard");
            const topPickPlayer = players.find(
              (p) => p.number === standardPred.top_pick,
            );
            raceData.predictions.standard = {
              topPick: standardPred.top_pick,
              top3: [
                standardPred.top_pick,
                standardPred.top_2nd,
                standardPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(standardPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "standard"),
            };
          }

          if (safeBetPred) {
            const players = createPlayers(safeBetPred, "ai_score_safe_bet");
            const topPickPlayer = players.find(
              (p) => p.number === safeBetPred.top_pick,
            );
            raceData.predictions.safeBet = {
              topPick: safeBetPred.top_pick,
              top3: [
                safeBetPred.top_pick,
                safeBetPred.top_2nd,
                safeBetPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(safeBetPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "safeBet"),
            };
          }

          if (upsetPred) {
            const players = createPlayers(upsetPred, "ai_score_upset_focus");
            const topPickPlayer = players.find(
              (p) => p.number === upsetPred.top_pick,
            );
            raceData.predictions.upsetFocus = {
              topPick: upsetPred.top_pick,
              top3: [
                upsetPred.top_pick,
                upsetPred.top_2nd,
                upsetPred.top_3rd,
              ].filter(Boolean),
              confidence: Number(upsetPred.confidence) || 0,
              players,
              reasoning: generateReasoning(topPickPlayer, "upsetFocus"),
            };
          }
        }

        // unifiedモデル（AI予想モデル大規模改修）。feature_contributions列を丸ごと取得しているため
        // Edge API経路と異なりマイグレーション適用を待たずvolatilityPercentile/volatilityReasonsを取得できる
        if (unifiedPred) {
          const fc = unifiedPred.feature_contributions || {};
          const rawUnifiedTurn = fc.turnPrediction || null;
          raceData.unified = {
            topPick: unifiedPred.top_pick,
            top2nd: unifiedPred.top_2nd,
            players: createPlayers(unifiedPred, "ai_score_standard"),
            turnPrediction: rawUnifiedTurn
              ? {
                  ...rawUnifiedTurn,
                  patterns: rawUnifiedTurn.patterns || [
                    {
                      technique: rawUnifiedTurn.technique,
                      winnerCourse: rawUnifiedTurn.winnerCourse,
                      probability: rawUnifiedTurn.probability,
                    },
                  ],
                }
              : null,
            volatilityPercentile: fc.volatilityPercentile ?? null,
            volatilityPercentileIsFallback:
              fc.volatilityPercentileIsFallback ?? null,
            volatilityReasons: fc.volatilityReasons || [],
          };
        }

        // 結果データ（直接クエリはsnake_caseのためbuildRaceResult()向けにcamelCaseへ変換）
        raceData.result = buildRaceResult(
          result && result.rank1
            ? {
                rank1: result.rank1,
                rank2: result.rank2,
                rank3: result.rank3,
                rank4: result.rank4,
                rank5: result.rank5,
                rank6: result.rank6,
                raceTime1: result.race_time_1,
                raceTime2: result.race_time_2,
                raceTime3: result.race_time_3,
                raceTime4: result.race_time_4,
                raceTime5: result.race_time_5,
                raceTime6: result.race_time_6,
                isCancelled: result.is_cancelled,
                isNoRace: result.is_no_race,
                winningTechnique: result.winning_technique,
                payoutWin: result.payout_win,
                payoutPlace1: result.payout_place_1,
                payoutPlace2: result.payout_place_2,
                payoutTrifecta: result.payout_trifecta,
                payoutTrio: result.payout_trio,
                payoutExacta: result.payout_exacta,
                payoutQuinella: result.payout_quinella,
                payoutWide1: result.payout_wide_1,
                payoutWide2: result.payout_wide_2,
                payoutWide3: result.payout_wide_3,
                popularityTrifecta: result.popularity_trifecta,
                popularityTrio: result.popularity_trio,
                popularityExacta: result.popularity_exacta,
                popularityQuinella: result.popularity_quinella,
                popularityWide1: result.popularity_wide_1,
                popularityWide2: result.popularity_wide_2,
                popularityWide3: result.popularity_wide_3,
              }
            : null,
        );

        return raceData;
      });

      return {
        date: date,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        races: transformedRaces,
      };
    }); // withCache end
  },

  /**
   * 精度統計データを取得（summary.json形式で返す）
   */
  async getAccuracy() {
    // 精度データは日1回更新のため24時間キャッシュ（Edge CDNと合わせる）
    const ACCURACY_TTL = 24 * 60 * 60 * 1000;
    return withCache(
      "accuracy",
      async () => {
        // Phase D: まずEdge APIを試行（CDNキャッシュ活用）
        try {
          const edgeResponse = await fetch(`${EDGE_API_BASE}/api/accuracy`);
          if (edgeResponse.ok) {
            const edgeData = await edgeResponse.json();
            if (edgeData.models) {
              console.log("[getAccuracy] Edge API success");
              return edgeData;
            }
          }
        } catch (edgeError) {
          console.log(
            "[getAccuracy] Edge API failed, falling back to direct query:",
            edgeError.message,
          );
        }

        // フォールバック: 従来のSupabase直接クエリ
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { lastUpdated: null, models: {} };
        }

        // 今月の日付範囲を計算
        const now = new Date();
        const jstOffset = 9 * 60;
        const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
        const thisYear = jstNow.getUTCFullYear();
        const thisMonth = jstNow.getUTCMonth() + 1;
        const thisMonthStart = `${thisYear}-${String(thisMonth).padStart(2, "0")}-01`;
        const thisMonthEnd = `${thisYear}-${String(thisMonth).padStart(2, "0")}-31`;

        // 過去30日の開始日を計算
        const thirtyDaysAgo = new Date(
          jstNow.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0];

        // モデル情報を取得
        const { data: models, error: modelsError } = await supabase
          .from("models")
          .select(
            "model_id, display_name, total_predictions, hit_rate_win, hit_rate_place, hit_rate_trifecta, hit_rate_trio, recovery_rate_win, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio",
          );

        if (modelsError) {
          console.error("Supabase getAccuracy error:", modelsError.message);
          return { lastUpdated: null, models: {} };
        }

        // ページネーション付きでデータを取得するヘルパー関数
        // race_id形式: YYYY-MM-DD-VV-RR なので、endDateには末尾を追加して正しく比較
        const fetchAllPredictions = async (startDate, endDate) => {
          let allData = [];
          let from = 0;
          const pageSize = 1000;

          // endDateをrace_id形式で比較できるよう調整（例: 2025-12-31 → 2025-12-31-99-99）
          const adjustedEndDate = endDate ? `${endDate}-99-99` : null;

          while (true) {
            let query = supabase
              .from("predictions")
              .select(
                "race_id, model_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
              )
              .gte("race_id", startDate)
              .not("is_hit_win", "is", null)
              .range(from, from + pageSize - 1);

            if (adjustedEndDate) {
              query = query.lte("race_id", adjustedEndDate);
            }

            const { data: page, error } = await query;

            if (error || !page || page.length === 0) break;
            allData = allData.concat(page);
            if (page.length < pageSize) break;
            from += pageSize;
          }

          return allData;
        };

        // 過去6ヶ月分の月別データを取得するためのヘルパー
        const getMonthRange = (year, month) => {
          const start = `${year}-${String(month).padStart(2, "0")}-01`;
          const end = `${year}-${String(month).padStart(2, "0")}-31`;
          return { start, end, year, month };
        };

        const getPreviousMonth = (year, month) => {
          if (month === 1) {
            return { year: year - 1, month: 12 };
          }
          return { year, month: month - 1 };
        };

        // 過去6ヶ月分の月情報を生成
        const monthsToFetch = [];
        let currentYear = thisYear;
        let currentMonth = thisMonth;

        for (let i = 0; i < 6; i++) {
          const prev = getPreviousMonth(currentYear, currentMonth);
          currentYear = prev.year;
          currentMonth = prev.month;
          monthsToFetch.push(getMonthRange(currentYear, currentMonth));
        }

        // 過去7日分・過去90日分の開始日
        const sevenDaysAgo = new Date(
          jstNow.getTime() - 7 * 24 * 60 * 60 * 1000,
        );
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

        const ninetyDaysAgo = new Date(
          jstNow.getTime() - 90 * 24 * 60 * 60 * 1000,
        );
        const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split("T")[0];

        // 2026-08-15修正（BOA-193）: 以下9件のfetchAllPredictions呼び出しは互いに
        // 独立したデータ取得なのに直列awaitされており、predictionsテーブルの
        // 行数増加に伴って/accuracyの応答が数十秒〜1分以上に悪化していた。
        // Promise.allで並列化し、体感速度を「合計時間」から「最長1件分の時間」に短縮する
        const [
          thisMonthPredictions,
          monthlyResults,
          recentPredictions,
          allPredictions,
        ] = await Promise.all([
          fetchAllPredictions(thisMonthStart, thisMonthEnd),
          Promise.all(
            monthsToFetch.map((monthInfo) =>
              fetchAllPredictions(monthInfo.start, monthInfo.end),
            ),
          ),
          fetchAllPredictions(sevenDaysAgoStr, null),
          fetchAllPredictions(ninetyDaysAgoStr, null),
        ]);

        // 各月の予測データをマップ化
        const monthlyPredictionsMap = {};
        monthsToFetch.forEach((monthInfo, i) => {
          const key = `${monthInfo.year}-${String(monthInfo.month).padStart(2, "0")}`;
          monthlyPredictionsMap[key] = {
            predictions: monthlyResults[i],
            year: monthInfo.year,
            month: monthInfo.month,
          };
        });

        // 先月のデータ（互換性のため）
        const lastMonthKey = `${monthsToFetch[0].year}-${String(monthsToFetch[0].month).padStart(2, "0")}`;
        const lastMonthPredictions =
          monthlyPredictionsMap[lastMonthKey]?.predictions || [];

        // race_idから日付を抽出するヘルパー関数
        const extractDate = (raceId) => raceId.substring(0, 10);

        // race_idから会場コードを抽出するヘルパー関数 (YYYY-MM-DD-VV-RR形式)
        const extractVenueCode = (raceId) =>
          parseInt(raceId.substring(11, 13), 10);

        // 統計を計算する関数
        const calculateStats = (predictions) => {
          if (!predictions || predictions.length === 0) {
            return {
              totalRaces: 0,
              topPickHitRate: 0,
              topPickPlaceRate: 0,
              top3HitRate: 0,
              top3IncludedRate: 0,
              actualRecovery: {
                win: { recoveryRate: 0 },
                place: { recoveryRate: 0 },
                trifecta: { recoveryRate: 0 },
                trio: { recoveryRate: 0 },
              },
            };
          }

          const total = predictions.length;
          const winHits = predictions.filter((p) => p.is_hit_win).length;
          const placeHits = predictions.filter((p) => p.is_hit_place).length;
          const trifectaHits = predictions.filter(
            (p) => p.is_hit_trifecta,
          ).length;
          const trioHits = predictions.filter((p) => p.is_hit_trio).length;

          const winPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_win || 0),
            0,
          );
          const placePayout = predictions.reduce(
            (sum, p) => sum + (p.payout_place || 0),
            0,
          );
          const trifectaPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_trifecta || 0),
            0,
          );
          const trioPayout = predictions.reduce(
            (sum, p) => sum + (p.payout_trio || 0),
            0,
          );

          return {
            totalRaces: total,
            topPickHitRate: winHits / total,
            topPickPlaceRate: placeHits / total,
            top3HitRate: trifectaHits / total,
            top3IncludedRate: trioHits / total,
            actualRecovery: {
              win: { recoveryRate: winPayout / (total * 100) },
              place: { recoveryRate: placePayout / (total * 100) },
              trifecta: { recoveryRate: trifectaPayout / (total * 100) },
              trio: { recoveryRate: trioPayout / (total * 100) },
            },
          };
        };

        // 日別履歴を計算する関数
        const calculateDailyHistory = (predictions, modelId) => {
          const modelPreds =
            predictions?.filter((p) => p.model_id === modelId) || [];
          const dateMap = new Map();

          for (const pred of modelPreds) {
            const date = extractDate(pred.race_id);
            if (!dateMap.has(date)) {
              dateMap.set(date, []);
            }
            dateMap.get(date).push(pred);
          }

          return Array.from(dateMap.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, preds]) => ({
              date,
              ...calculateStats(preds),
            }));
        };

        // 会場別統計を計算する関数
        const calculateByVenue = (predictions, modelId) => {
          const modelPreds =
            predictions?.filter((p) => p.model_id === modelId) || [];
          const venueMap = new Map();

          for (const pred of modelPreds) {
            const venueCode = extractVenueCode(pred.race_id);
            if (!venueMap.has(venueCode)) {
              venueMap.set(venueCode, []);
            }
            venueMap.get(venueCode).push(pred);
          }

          const byVenue = {};
          for (const [venueCode, preds] of venueMap) {
            byVenue[venueCode] = {
              overall: calculateStats(preds),
            };
          }

          return byVenue;
        };

        // 各モデルの統計を構築
        const modelStats = {};
        const modelIds = ["standard", "safeBet", "upsetFocus"];

        for (const modelId of modelIds) {
          const modelInfo = models?.find((m) => m.model_id === modelId);
          const thisMonthPreds =
            thisMonthPredictions?.filter((p) => p.model_id === modelId) || [];
          const thisMonthStats = calculateStats(thisMonthPreds);
          const lastMonthPreds =
            lastMonthPredictions?.filter((p) => p.model_id === modelId) || [];
          const lastMonthStats = calculateStats(lastMonthPreds);
          const dailyHistory = calculateDailyHistory(
            recentPredictions,
            modelId,
          );
          const byVenue = calculateByVenue(allPredictions, modelId);

          // 月別履歴を構築（過去6ヶ月分）
          const monthlyHistory = Object.entries(monthlyPredictionsMap)
            .map(([key, data]) => {
              const monthPreds =
                data.predictions?.filter((p) => p.model_id === modelId) || [];
              const stats = calculateStats(monthPreds);
              return {
                year: data.year,
                month: data.month,
                ...stats,
              };
            })
            .filter((m) => m.totalRaces > 0)
            .sort((a, b) => {
              if (a.year !== b.year) return b.year - a.year;
              return b.month - a.month;
            });

          modelStats[modelId] = {
            overall: {
              totalRaces: modelInfo?.total_predictions || 0,
              finishedRaces: modelInfo?.total_predictions || 0,
              topPickHitRate: modelInfo?.hit_rate_win || 0,
              topPickPlaceRate: modelInfo?.hit_rate_place || 0,
              top3HitRate: modelInfo?.hit_rate_trifecta || 0,
              top3ExactHitRate: modelInfo?.hit_rate_trio || 0,
              actualRecovery: {
                win: { recoveryRate: modelInfo?.recovery_rate_win || 0 },
                place: { recoveryRate: modelInfo?.recovery_rate_place || 0 },
                trifecta: {
                  recoveryRate: modelInfo?.recovery_rate_trifecta || 0,
                },
                trio: { recoveryRate: modelInfo?.recovery_rate_trio || 0 },
              },
            },
            thisMonth: {
              year: thisYear,
              month: thisMonth,
              ...thisMonthStats,
            },
            lastMonth: {
              year: monthsToFetch[0].year,
              month: monthsToFetch[0].month,
              ...lastMonthStats,
            },
            monthlyHistory,
            dailyHistory,
            byVenue,
          };
        }

        // accuracy_cache から volatilityStats を取得（フォールバックパスでも表示できるよう）
        let volatilityStats = null;
        try {
          const { data: cacheRow } = await supabase
            .from("accuracy_cache")
            .select("data")
            .eq("key", "accuracy_summary")
            .single();
          volatilityStats = cacheRow?.data?.volatilityStats ?? null;
        } catch {
          // 取得失敗時は非表示のまま
        }

        return {
          lastUpdated: new Date().toISOString(),
          volatilityStats,
          models: modelStats,
        };
      },
      ACCURACY_TTL,
    ); // withCache end
  },

  /**
   * 予想データが存在する日付リストを取得
   * @param {number} days - 過去何日分を取得するか
   */
  async getAvailableDates(days = 90) {
    return withCache(`availableDates-${days}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 日付範囲を計算
      const today = new Date();
      const jstOffset = 9 * 60;
      const jstToday = new Date(today.getTime() + jstOffset * 60 * 1000);
      const startDate = new Date(
        jstToday.getTime() - days * 24 * 60 * 60 * 1000,
      );
      const startDateStr = startDate.toISOString().split("T")[0];

      // 日付ごとのレースを取得（ページネーションで1000行制限を回避）
      const allData = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from("races")
          .select("race_date")
          .gte("race_date", startDateStr)
          .order("race_date", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (error) {
          console.error("Supabase getAvailableDates error:", error.message);
          break;
        }
        if (!data || data.length === 0) break;

        allData.push(...data);
        offset += pageSize;

        if (data.length < pageSize) break;
      }

      // ユニークな日付を抽出
      const uniqueDates = [...new Set(allData.map((r) => r.race_date))];
      return uniqueDates;
    }); // withCache end
  },

  /**
   * レース履歴サマリーを取得（日付ごとのモデル別的中統計）
   * /races ページ用。従来の N+1 フェッチを 1 リクエストに集約
   * @param {number} days - 過去何日分を取得するか（デフォルト 90）
   */
  async getRaceHistorySummary(days = 90) {
    return withCache(`raceHistorySummary-${days}`, async () => {
      // Phase 1: Edge API を試行
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/race-history/summary?days=${days}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.days) {
            console.log("[getRaceHistorySummary] Edge API success");
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaceHistorySummary] Edge API failed, falling back:",
          edgeError.message,
        );
      }

      // フォールバック: race_history_cache テーブルから直接取得（RPC廃止）
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { days: [] };
      }

      const { data: rows, error } = await supabase
        .from("race_history_cache")
        .select("data")
        .eq("key", "race_history_summary_90")
        .single();

      if (error) {
        console.error("Supabase race_history_cache error:", error.message);
        return { days: [] };
      }
      return rows?.data || { days: [] };
    });
  },

  /**
   * 会場固有の水面特性（水質・イン/アウト傾向のクラスタ分類）を取得する
   * venuesテーブルはモデル調整（softmax-temperature-calibration）用に
   * water_type/clusterを保持しているが、フロントエンドでは未使用だった
   * @param {number} venueCode - 会場コード（1-24）
   * @returns {Promise<{ waterType: string, cluster: string } | null>}
   */
  getVenueCharacteristics(venueCode) {
    return withCache(`venue-characteristics-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("venues")
        .select("water_type, cluster")
        .eq("code", venueCode)
        .maybeSingle();

      if (error) {
        console.error("venues取得エラー:", error.message);
        return null;
      }
      if (!data) return null;

      return { waterType: data.water_type, cluster: data.cluster };
    });
  },

  /**
   * 枠番別の1着率の全国平均（24会場プール値）を取得する
   * outcome_distributionは会場ごとの行を持つが、first_boatでgroup byして
   * count_90daysを合算すれば1クエリで全国平均が算出できる（24会場を
   * 個別に取得する必要はない）。会場を問わず同じ値のためracer_id等と
   * 違い引数を取らず、キャッシュキーも固定にする
   */
  getNationalAverageOutcomeDistribution() {
    return withCache("national-average-outcome-distribution", async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // outcome_distributionは2500行超あり、Supabaseのデフォルトlimit(1000行)を
      // 超えるため.range()でページネーションして全件取得する必要がある
      // （2026-09-07、ページネーション漏れで全国平均が偏っていたバグを発見・修正）
      const data = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: page, error } = await supabase
          .from("outcome_distribution")
          .select("first_boat, count_90days")
          .range(from, from + pageSize - 1);

        if (error) {
          console.error(
            "outcome_distribution(全国平均)取得エラー:",
            error.message,
          );
          return null;
        }
        if (!page || page.length === 0) break;
        data.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      if (data.length === 0) return null;

      const countByBoat = {};
      let total = 0;
      data.forEach((row) => {
        countByBoat[row.first_boat] =
          (countByBoat[row.first_boat] ?? 0) + (row.count_90days ?? 0);
        total += row.count_90days ?? 0;
      });
      if (total === 0) return null;

      const rateByBoat = {};
      Object.entries(countByBoat).forEach(([boat, count]) => {
        rateByBoat[boat] = (count / total) * 100;
      });
      return rateByBoat;
    });
  },

  /**
   * 出目分布データを取得（会場別の3連単パターン）
   * @param {number} venueCode - 会場コード（1-24）
   * @returns {Promise<Object>} - { venue_code, venue_name, total_races, last_updated, data: { first_boat: [...] } }
   */
  getOutcomeDistribution(venueCode) {
    return withCache(`outcome-distribution-${venueCode}`, async () => {
      // Phase 1: Edge API を試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/outcome-distribution?venue_code=${venueCode}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.venue_code) {
            console.log("[getOutcomeDistribution] Edge API success");
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log(
          "[getOutcomeDistribution] Edge API failed, falling back:",
          edgeError.message,
        );
      }

      // フォールバック: Supabase 直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (error) {
        console.error("Supabase getOutcomeDistribution error:", error.message);
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      // 1着別にグループ化
      const outcomesData = {};
      let totalRaces = 0;
      let lastUpdated = null;

      data.forEach((row) => {
        const firstBoat = row.first_boat;
        if (!outcomesData[firstBoat]) {
          outcomesData[firstBoat] = [];
        }

        outcomesData[firstBoat].push({
          second_boat: row.second_boat,
          third_boat: row.third_boat,
          count: row.count_90days,
          probability: row.probability,
          avg_payout: row.avg_payout,
        });

        if (!totalRaces) {
          totalRaces = row.total_races;
          lastUpdated = row.last_updated;
        }
      });

      // VENUE_NAMES マッピング
      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        total_races: totalRaces,
        last_updated: lastUpdated,
        data: outcomesData,
      };
    });
  },

  /**
   * 会場別・枠番別の決まり手（逃げ/差し/まくり等）出現割合を取得する（BOA-150）
   * v1ではEdge API連携は行わず、Supabase直接クエリのみ
   */
  getWinningTechniqueStats(venueCode) {
    return withCache(`winning-technique-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("winning_technique_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number")
        .order("percentage", { ascending: false });

      if (error) {
        console.error(
          "Supabase getWinningTechniqueStats error:",
          error.message,
        );
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      // 枠番別にグループ化
      const techniqueData = {};
      let lastUpdated = null;

      data.forEach((row) => {
        const boatNumber = row.boat_number;
        if (!techniqueData[boatNumber]) {
          techniqueData[boatNumber] = {
            total_races: row.total_races,
            techniques: [],
          };
        }

        techniqueData[boatNumber].techniques.push({
          technique: row.winning_technique,
          count: row.count_90days,
          percentage: row.percentage,
        });

        if (!lastUpdated) {
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        last_updated: lastUpdated,
        data: techniqueData,
      };
    });
  },

  /**
   * 本日レースが開催されている会場一覧を取得する（BOA-151）
   * races テーブルは当日分のカードしか保持していないため、モーター調子の
   * レース単位表示は「本日開催中の会場」に限定する
   */
  getVenuesWithTodaysRaces() {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`venues-with-races-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("races")
        .select("venue_code")
        .eq("race_date", today);

      if (error) {
        console.error("races取得エラー:", error.message);
        return [];
      }

      return [...new Set(data.map((r) => r.venue_code))].sort((a, b) => a - b);
    });
  },

  /**
   * 指定会場の本日のレース一覧を取得する（BOA-151）
   */
  getTodaysRacesForVenue(venueCode) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`todays-races-${venueCode}-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("races")
        .select("race_id, race_number, start_time")
        .eq("venue_code", venueCode)
        .eq("race_date", today)
        .order("race_number");

      if (error) {
        console.error("races取得エラー:", error.message);
        return [];
      }
      return data ?? [];
    });
  },

  /**
   * 指定レースの枠番別・公式集計済み成績（全国/当地の勝率・2連率・3連率）を
   * 取得する（BOA-306、レース詳細ページ「基本情報」タブ）。
   * これらはboatrace.jp側で既に算出済みの「今期」公式値であり、自社で
   * 期間集計をやり直す必要が無い最も正確な値のため、期間フィルタが
   * 「今期」かつグレード条件無し（=全レース）の場合はこの値をそのまま使う。
   * グレード・期間で絞り込む場合は別途getRacerScopedRaceStatsで自社集計する
   */
  getRaceEntryOfficialRatesBreakdown(raceId) {
    return withCache(`race-entry-official-rates-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("race_entries")
        .select(
          "boat_number, win_rate, local_win_rate, global_2rate, local_2rate, global_3rate, local_3rate",
        )
        .eq("race_id", raceId)
        .order("boat_number");

      if (error) {
        console.error(
          "race_entries(公式勝率/連対率)取得エラー:",
          error.message,
        );
        return [];
      }
      return data ?? [];
    });
  },

  /**
   * 指定レースの枠番別モーター調子（2連率/3連率）を取得する（BOA-151）
   * 「このレースのどの艇のモーターが調子いいか」を直接示す
   * venueCodeを渡すと各艇のモーターの機力指数（BOA-265）も合わせて取得する
   */
  getRaceMotorBreakdown(raceId, venueCode = null, days = 90) {
    return withCache(
      // raceIdを末尾に置く: inferTtlFromKey()は末尾の「YYYY-MM-DD-会場-レース番号」
      // パターンで過去レースを検知し7日キャッシュを付与する。venueCode/daysを
      // 末尾に付けるとこのパターンにマッチしなくなり、過去レースでも30分キャッシュに
      // 格下げされてしまうため、raceIdより前に置く。
      // v2: motor_2rate/3rateを選択期間に応じた値に差し替えるよう変更(BOA-283)。
      // v3: 優出回数・優勝回数・1着率を追加(BOA-264追加調査、日和比較)。
      // 旧キーのままだと古いキャッシュが新フィールド無しの形状のまま返る
      `race-motor-breakdown-v3-${venueCode}-${days}-${raceId}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const { data, error } = await supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, motor_number, motor_2rate, motor_3rate",
          )
          .eq("race_id", raceId)
          .order("boat_number");

        if (error) {
          console.error("race_entries取得エラー:", error.message);
          return [];
        }
        const rows = data ?? [];
        if (venueCode === null) return rows;

        const [powerIndexes, venueMotorStatsList] = await Promise.all([
          Promise.all(
            rows.map((row) =>
              this.getMotorPowerIndex(venueCode, row.motor_number, days),
            ),
          ),
          Promise.all(
            rows.map((row) =>
              this.getVenueMotorStats(venueCode, row.motor_number),
            ),
          ),
        ]);
        // 2連率/3連率も選択中の期間（過去90日/直近1ヶ月）に応じた値に差し替える。
        // race_entries.motor_2rate/3rateは公式サイトの「モーター抽選日からの通算」
        // 値でperiod非依存のため、そのまま使うと機力指数だけ期間が変わり
        // 2連率/3連率が変わらないという不整合が生じる（ユーザー指摘、2026-09-13）
        return rows.map((row, i) => ({
          ...row,
          motor_2rate: powerIndexes[i]?.actual_rate2 ?? row.motor_2rate,
          motor_3rate: powerIndexes[i]?.actual_rate3 ?? row.motor_3rate,
          power_index: powerIndexes[i]?.power_index ?? null,
          final_count: venueMotorStatsList[i]?.finalCount ?? null,
          championship_count: venueMotorStatsList[i]?.championshipCount ?? null,
          first_place_count: venueMotorStatsList[i]?.firstPlaceCount ?? null,
          race_count: venueMotorStatsList[i]?.raceCount ?? null,
        }));
      },
    );
  },

  /**
   * 指定会場・モーター番号の「機力指数」を算出する（BOA-265）
   * このモーターが過去90日に出走した全レースについて、
   * 「そのレースで実際に2着以内だったか（0/1）」−
   * 「その時このモーターに乗っていた選手自身の全国2連率」を計算し、
   * 全レース分を平均する。強い選手ばかりが使ってきたことによる
   * 見かけ上の高評価（交絡バイアス）を避けるための設計。
   * 単純に motor_2rate − 現在の選手のglobal_2rate を引き算するだけでは
   * 過去の使用選手の実力とモーター自体の性能を区別できないため、
   * この残差平均方式を採用している（ユーザー指摘を受けて修正、2026-09-12）。
   * daysで集計期間を指定できる（既定90日=「過去90日」、30日=「直近1ヶ月」、BOA-283）
   */
  getMotorPowerIndex(venueCode, motorNumber, days = 90) {
    return withCache(
      // v2: actual_rate3を追加(BOA-283)。旧キャッシュ形状には無いフィールドのため、
      // 旧キーのままだと古いキャッシュが2連率/3連率の期間切り替えに反映されない
      `motor-power-index-v2-${venueCode}-${motorNumber}-${days}`,
      async () => {
        const empty = {
          venue_code: venueCode,
          motor_number: motorNumber,
          sample_count: 0,
          actual_rate2: null,
          actual_rate3: null,
          avg_baseline_rate2: null,
          power_index: null,
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const races = await getRacesForVenue(venueCode, days);
        if (races.length === 0) return empty;

        const raceIds = races.map((r) => r.race_id);
        const entryChunks = chunkArray(raceIds, 500);

        const entryResults = await Promise.all(
          entryChunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, global_2rate")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return empty;

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select("race_id, rank1, rank2, rank3")
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_results取得エラー:", error.message);
            return;
          }
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const residuals = [];
        let actualHits2 = 0;
        let actualHits3 = 0;
        let baselineSum = 0;
        entries.forEach((e) => {
          const result = resultByRaceId.get(e.race_id);
          if (!result || e.global_2rate === null) return;
          const isTop2 =
            result.rank1 === e.boat_number || result.rank2 === e.boat_number;
          const isTop3 = isTop2 || result.rank3 === e.boat_number;
          if (isTop2) actualHits2 += 1;
          if (isTop3) actualHits3 += 1;
          residuals.push((isTop2 ? 100 : 0) - e.global_2rate);
          baselineSum += e.global_2rate;
        });
        if (residuals.length === 0) return empty;

        const powerIndex =
          residuals.reduce((sum, v) => sum + v, 0) / residuals.length;
        const avgBaseline = baselineSum / residuals.length;

        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          sample_count: residuals.length,
          actual_rate2: (actualHits2 / residuals.length) * 100,
          actual_rate3: (actualHits3 / residuals.length) * 100,
          avg_baseline_rate2: avgBaseline,
          power_index: powerIndex,
        };
      },
    );
  },

  /**
   * 指定会場・モーター番号を過去に使用した選手の履歴を、節ごとにグループ化して
   * 取得する（BOA-283）。「誰がこのモーターに乗っていたか」を辿れるようにする。
   * 節の境目は「同一選手が同一モーターに乗り続けた出走の間隔が2日以内か」で
   * 判定する（BOA-265のgetRacerCurrentMotorStatusと同じ考え方を一般化したもの）。
   * 各節の2連率/3連率はそのモーター・その選手のその節内の実績（機力指数のような
   * 選手実力の差し引きはしない、素の成績）を返す。選手の実力水準は級別バッジで
   * 別途示す（ユーザーフィードバック、2026-09-13: 機力指数を軸にすると選手間の
   * 比較がしづらいため、素の連対率＋級別表示に変更）
   */
  getMotorUsageHistory(venueCode, motorNumber) {
    return withCache(
      `motor-usage-history-${venueCode}-${motorNumber}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const races = await getRacesForVenue(venueCode);
        if (races.length === 0) return [];

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, racer_id, player_name, grade")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_entries取得エラー:", error.message);
            return;
          }
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return [];

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6")
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data, error }) => {
          if (error) {
            console.error("race_results取得エラー:", error.message);
            return;
          }
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const rankOf = (result, boatNumber) => {
          if (!result) return null;
          for (let rank = 1; rank <= 6; rank++) {
            if (result[`rank${rank}`] === boatNumber) return rank;
          }
          return null;
        };

        // race_id昇順に並べ、同一選手が2日以内の間隔で乗り続けている限り同じ節とみなす
        const sorted = [...entries].sort((a, b) =>
          a.race_id.localeCompare(b.race_id),
        );
        const meets = [];
        let current = null;
        sorted.forEach((e) => {
          const date = e.race_id.slice(0, 10);
          if (current && current.racerId === e.racer_id) {
            const gapDays =
              (new Date(date) - new Date(current.lastDate)) / 86400000;
            if (gapDays <= 2) {
              current.entries.push(e);
              current.lastDate = date;
              return;
            }
          }
          if (current) meets.push(current);
          current = {
            racerId: e.racer_id,
            playerName: e.player_name,
            grade: e.grade,
            entries: [e],
            firstDate: date,
            lastDate: date,
          };
        });
        if (current) meets.push(current);

        return meets
          .map((meet) => {
            let hits2 = 0;
            let hits3 = 0;
            let n = 0;
            const races = meet.entries.map((e) => {
              const result = resultByRaceId.get(e.race_id);
              const rank = rankOf(result, e.boat_number);
              if (rank !== null) {
                n += 1;
                if (rank <= 2) hits2 += 1;
                if (rank <= 3) hits3 += 1;
              }
              return { date: e.race_id.slice(0, 10), rank };
            });
            return {
              racerId: meet.racerId,
              playerName: meet.playerName,
              grade: meet.grade,
              firstDate: meet.firstDate,
              lastDate: meet.lastDate,
              races,
              sampleCount: n,
              rate2: n > 0 ? (hits2 / n) * 100 : null,
              rate3: n > 0 ? (hits3 / n) * 100 : null,
            };
          })
          .reverse();
      },
    );
  },

  /**
   * 指定会場・モーター番号の公式サイト発表モーター成績（節数・出走回数・
   * 優出回数・優勝回数等）の最新スナップショットを取得する（BOA-264）。
   * `venue_motor_stats`は日次で会場公式サイトをスクレイピングして書き込まれる
   * （scripts/daily/scrape-venue-motor-stats.js）。会場ごとに公式サイトの
   * 公開項目が異なるため、値が無い項目はnullのまま返す（戸田・平和島は
   * データ自体が無いため常にnull）。「機力指数+16.6だが抽選後8走しかしていない
   * ので信頼度低め」のように、他のモーター指標の信頼度を判断する材料として使う
   */
  getVenueMotorStats(venueCode, motorNumber) {
    return withCache(
      `venue-motor-stats-${venueCode}-${motorNumber}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }

        // このメソッドはRaceDetailの機力指数・モーター調子ドリルダウンの
        // Promise.allに同居させて呼ぶ想定のため、ネットワークレベルの例外
        // （supabase-jsが{data,error}を返さずreject自体する稀なケース）が
        // Promise.all全体を巻き込んで他の取得済みデータまで消さないよう、
        // 内部でtry/catchして安全側（null）にフォールバックする
        try {
          const { data, error } = await supabase
            .from("venue_motor_stats")
            .select("*")
            .eq("venue_code", venueCode)
            .eq("motor_number", motorNumber)
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            console.error("venue_motor_stats取得エラー:", error.message);
            return null;
          }
          if (!data) return null;

          return {
            scrapedDate: data.scraped_date,
            meetCount: data.meet_count,
            raceCount: data.race_count,
            finalCount: data.final_count,
            championshipCount: data.championship_count,
            firstPlaceCount: data.first_place_count,
            secondPlaceCount: data.second_place_count,
            thirdPlaceCount: data.third_place_count,
            winRate: data.win_rate,
            top2Rate: data.top2_rate,
            top3Rate: data.top3_rate,
            accidentRate: data.accident_rate,
            bestTime: data.best_time,
            avgExhibitionTime: data.avg_exhibition_time,
            statsPeriodStart: data.stats_period_start,
            statsPeriodEnd: data.stats_period_end,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return null;
        }
      },
    );
  },

  /**
   * 指定会場・モーター番号が「優勝戦」で実際に1着になった日付・選手を
   * 取得する（BOA-264追加調査、BOA-226のrace_stage列が前提）。
   * venue_motor_statsの優勝数は公式サイト側の集計期間内の合計回数のみで
   * 日付・選手の内訳が無いため、自社データ（race_conditions.race_stage=
   * 優勝戦を含む×race_entries×race_results）から逆算する。
   * race_stageはBOA-226実装後に取得したレースにしか入っていない
   * （過去レースへの遡及取得はしない方針）ため、実装直後は空になりうる
   */
  getVenueMotorChampionshipHistory(venueCode, motorNumber) {
    return withCache(
      `venue-motor-championship-history-${venueCode}-${motorNumber}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        try {
          const { data: stageRows, error: stageError } = await supabase
            .from("race_conditions")
            .select("race_id, races!inner(venue_code)")
            // 完全一致で絞る。ilikeの部分一致だと「準優勝戦」も「優勝戦」を
            // 部分文字列として含むため誤ってヒットしてしまう（実データで
            // race_stageが"優勝戦"/"準優勝戦"の2値のみ存在することを確認済み）
            .eq("race_stage", "優勝戦")
            .eq("races.venue_code", venueCode);
          if (stageError) {
            console.error("race_conditions取得エラー:", stageError.message);
            return [];
          }
          if (!stageRows || stageRows.length === 0) return [];

          const raceIds = stageRows.map((r) => r.race_id);
          const { data: entries, error: entriesError } = await supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name")
            .in("race_id", raceIds)
            .eq("motor_number", motorNumber);
          if (entriesError) {
            console.error("race_entries取得エラー:", entriesError.message);
            return [];
          }
          if (!entries || entries.length === 0) return [];

          const { data: results, error: resultsError } = await supabase
            .from("race_results")
            .select("race_id, rank1")
            .in(
              "race_id",
              entries.map((e) => e.race_id),
            );
          if (resultsError) {
            console.error("race_results取得エラー:", resultsError.message);
            return [];
          }
          const rank1ByRaceId = new Map(
            (results ?? []).map((r) => [r.race_id, r.rank1]),
          );

          return entries
            .filter((e) => rank1ByRaceId.get(e.race_id) === e.boat_number)
            .map((e) => ({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              racerId: e.racer_id,
              playerName: e.player_name,
            }))
            .sort((a, b) => b.date.localeCompare(a.date));
        } catch (err) {
          console.error("優勝履歴取得エラー(例外):", err.message);
          return [];
        }
      },
    );
  },

  /**
   * 指定レースの枠番別・選手の勝率上昇/下降を取得する（BOA-152）
   * 現在の全国勝率と約90日前時点の全国勝率を比較し、調子の変化を示す
   */
  getRaceRacerFormBreakdown(raceId) {
    return withCache(`race-racer-form-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data: current, error: curError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id, win_rate, local_win_rate")
        .eq("race_id", raceId)
        .order("boat_number");

      if (curError || !current || current.length === 0) {
        if (curError)
          console.error("race_entries取得エラー:", curError.message);
        return [];
      }

      const racerIds = [...new Set(current.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) return current;

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, win_rate")
        .in("racer_id", racerIds)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false });

      if (pastError) {
        console.error("過去データ取得エラー:", pastError.message);
      }

      // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
      const pastByRacer = new Map();
      (past ?? []).forEach((row) => {
        if (!pastByRacer.has(row.racer_id)) {
          pastByRacer.set(row.racer_id, row.win_rate);
        }
      });

      return current.map((row) => {
        const pastWinRate = pastByRacer.get(row.racer_id) ?? null;
        return {
          ...row,
          past_win_rate: pastWinRate,
          delta: pastWinRate !== null ? row.win_rate - pastWinRate : null,
        };
      });
    });
  },

  /**
   * 指定選手の全国勝率の節ごとの推移を取得する（BOA-152）
   * race_entries.win_rate/local_win_rate は節単位でのみ更新されるため、
   * モーター調子と同じく日付単位でdedupeして推移として扱う
   */
  getRacerFormTrend(racerId) {
    return withCache(`racer-form-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", cutoff)
        .order("race_id");

      if (error) {
        console.error("race_entries取得エラー:", error.message);
        return { racer_id: racerId, trend: [] };
      }

      // 日付単位でdedupe（同日の複数レースは同じ値のため最初の1件を採用）
      const byDate = new Map();
      (data ?? [])
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .forEach((e) => {
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, {
              date: e.race_date,
              win_rate: e.win_rate,
              local_win_rate: e.local_win_rate,
            });
          }
        });

      return { racer_id: racerId, trend: [...byDate.values()] };
    });
  },

  /**
   * 指定選手の現在の全国勝率と約90日前時点の全国勝率を比較する（選手個人ページ用）
   * getRaceRacerFormBreakdownと同じ比較ロジックをracer_id単体向けに転用したもの
   */
  getRacerFormSummary(racerId) {
    return withCache(`racer-form-summary-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data: current, error: curError } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (curError || !current) {
        if (curError)
          console.error("race_entries取得エラー:", curError.message);
        return null;
      }

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past, error: pastError } = await supabase
        .from("race_entries")
        .select("win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pastError) {
        console.error("過去データ取得エラー:", pastError.message);
      }

      const pastWinRate = past?.win_rate ?? null;
      return {
        racer_id: racerId,
        current_win_rate: current.win_rate,
        current_local_win_rate: current.local_win_rate,
        past_win_rate: pastWinRate,
        delta: pastWinRate !== null ? current.win_rate - pastWinRate : null,
      };
    });
  },

  /**
   * 指定選手が過去90日間で勝った時の決まり手構成比を取得する（選手個人ページ用）
   * getRaceTechniqueProfileBreakdownのクライアント集計ロジックをracer_id単体向けに
   * 転用したもの。対象が1選手のみのためRPC化は不要（egress負荷が小さい）
   */
  getRacerTechniqueProfile(racerId) {
    return withCache(`racer-technique-profile-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        raceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const counts = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
      const techniques = [...counts.entries()]
        .map(([technique, count]) => ({
          technique,
          count,
          percentage: winCount > 0 ? (count / winCount) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return { racer_id: racerId, win_count: winCount, techniques };
    });
  },

  /**
   * 指定選手の平均ST等の集計統計を取得する（選手個人ページ用）
   * scripts/analysis/aggregate-racer-stats.jsが日次で事前集計したracer_aggregated_stats
   * （venue_code=0は全会場合算のレコード）を参照する
   */
  getRacerAggregatedStats(racerId) {
    return withCache(`racer-aggregated-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("racer_aggregated_stats")
        .select(
          "avg_st, avg_st_last_30, st_stddev, flying_rate, total_races, course_race_counts",
        )
        .eq("racer_id", racerId)
        .eq("venue_code", 0)
        .maybeSingle();

      if (error) {
        console.error("racer_aggregated_stats取得エラー:", error.message);
        return null;
      }
      return data;
    });
  },

  /**
   * 選手検索UI向けに全選手の軽量一覧を取得する。
   * 対象約1,627件・数十KB程度のため都度クエリではなく一括取得し長期キャッシュする
   * （選手数の変動は月数件程度、egress削減のため24時間キャッシュ）。
   * 検索自体はこのデータをクライアント側でフィルタする（RacerSearchBox.jsx参照）。
   * racer_profilesは1,627件でSupabaseのデフォルトlimit(1000行)を超えるため、
   * .range()でページネーションして全件取得する必要がある
   * （2026-09-08、ページネーション漏れで約4割の選手が検索に出てこないバグを発見・修正）。
   * キャッシュキーは取得列を変更するたびにサフィックスを上げる（v2で列追加）。
   * 24時間TTLのため、キー名を変えずに列だけ増やすと、変更前にキャッシュ済みの
   * ブラウザが新しい列（登録期・出身地等）を含まない古いデータを最大24時間
   * 表示し続けてしまう（2026-09-08、実機確認で発覚）
   */
  getAllRacersLite() {
    return withCache(
      "all-racers-lite-v2",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const data = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data: page, error } = await supabase
            .from("racer_profiles")
            .select(
              "racer_id, name, name_kana, branch, height_cm, weight_kg, registration_period, hometown, birth_date",
            )
            .order("racer_id")
            .range(from, from + pageSize - 1);

          if (error) {
            // withCacheは成功時（.then）のみキャッシュするため、ここは[]を返さず
            // throwする。[]を返すと一時的なエラーが24時間キャッシュされ、
            // 取得済み分のデータも道連れで破棄されてしまう
            // （2026-09-08、コードレビューで発見）
            throw new Error(`racer_profiles取得エラー: ${error.message}`);
          }
          if (!page || page.length === 0) break;
          data.push(...page);
          if (page.length < pageSize) break;
          from += pageSize;
        }
        return data;
      },
      24 * 60 * 60 * 1000,
    );
  },

  /**
   * 選手ごとの最新級別・勝率（race_entriesの最新行、ADR-0023準拠）を
   * racer_grade_cache（scripts/daily/update-racer-grade-cache.jsが夜間更新）
   * から取得する（docs/adr/0043-racer-grade-win-rate-cache-strategy.md）
   */
  getRacerGradeCache() {
    return withCache(
      "racer-grade-cache",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const { data, error } = await supabase
          .from("racer_grade_cache")
          .select("data")
          .eq("key", "latest_grades")
          .single();

        if (error) {
          // withCacheは成功時（.then）のみキャッシュするため、ここは[]を返さず
          // throwする（getAllRacersLiteと同じ理由、2026-09-08コードレビューで発見）
          throw new Error(`racer_grade_cache取得エラー: ${error.message}`);
        }
        return data?.data ?? [];
      },
      24 * 60 * 60 * 1000,
    );
  },

  /**
   * 選手検索・一覧（RacerSearchBox・/racers）向けに、選手プロフィールと
   * 最新級別・勝率をマージした一覧を取得する
   * （docs/design/racer-search-and-list/plan.md参照）
   */
  async getAllRacersWithGrade() {
    const [racers, grades] = await Promise.all([
      this.getAllRacersLite(),
      this.getRacerGradeCache(),
    ]);
    const gradeByRacerId = new Map(grades.map((g) => [g.racer_id, g]));
    return racers.map((racer) => {
      const gradeInfo = gradeByRacerId.get(racer.racer_id);
      return {
        ...racer,
        grade: gradeInfo?.grade ?? null,
        winRate: gradeInfo?.win_rate ?? null,
      };
    });
  },

  /**
   * 指定選手の会場別（当地）成績を取得する（選手個人ページ用）
   * racer_aggregated_statsは本番では venue_code=0（全会場合算）の行しか
   * 存在せず（会場別集計は日次自動化に未組み込み、2026-09-06確認）、
   * 会場別行を前提にはできない。そのためgetRacerBoatReturnRate等と同じ
   * 「対象は1選手のみなのでその場でライブ集計する」方式で
   * race_entries×races×race_resultsから直接算出する
   */
  getRacerVenueStats(racerId) {
    return withCache(`racer-venue-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 過去2年分を対象（他のracer_id単体集計は90〜180日窓だが、
      // 会場別成績は会場ごとの出走機会自体が少ないため長めに取る）
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows] = await Promise.all([
        fetchAllByIn("races", "race_id, venue_code", "race_id", raceIds),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        ),
      ]);

      const venueByRaceId = new Map(
        raceRows.map((r) => [r.race_id, r.venue_code]),
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      const byVenue = new Map();
      entries.forEach((entry) => {
        const venueCode = venueByRaceId.get(entry.race_id);
        const result = resultByRaceId.get(entry.race_id);
        if (!venueCode || !isUsableRaceResult(result)) return;

        if (!byVenue.has(venueCode)) {
          byVenue.set(venueCode, { total: 0, wins: 0, top2: 0, top3: 0 });
        }
        const stat = byVenue.get(venueCode);
        stat.total += 1;
        if (result.rank1 === entry.boat_number) stat.wins += 1;
        if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
          stat.top2 += 1;
        }
        if (
          isShowHit(entry.boat_number, result.rank1, result.rank2, result.rank3)
        ) {
          stat.top3 += 1;
        }
      });

      return [...byVenue.entries()]
        .map(([venueCode, stat]) => ({
          venue_code: venueCode,
          total_races: stat.total,
          win_rate: stat.total > 0 ? stat.wins / stat.total : null,
          top2_rate: stat.total > 0 ? stat.top2 / stat.total : null,
          top3_rate: stat.total > 0 ? stat.top3 / stat.total : null,
        }))
        .filter((row) => row.total_races >= 5)
        .sort((a, b) => b.total_races - a.total_races);
    });
  },

  /**
   * 指定選手の過去2年分の出走履歴を、レース詳細ページ「基本情報」タブ
   * （BOA-306）の会場/グレード/期間フィルタ用にフラットな形で1回だけ取得する。
   * getRacerVenueStats/getRacerRaceHistoryと同じ「対象は1選手のみなのでその場で
   * ライブ集計する」方式（BOA-303が問題視する全選手×全会場の横断集計とは
   * スコープが異なる）。フィルタの絞り込み・集計自体はクライアント側の
   * aggregateBasicInfoStats（basicInfoStats.js）が担い、この関数はracerId単位で
   * キャッシュ可能な生データの取得のみ担当する
   */
  getRacerScopedRaceStats(racerId) {
    return withCache(`racer-scoped-race-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      // race_gradeはraces側のカラム（race_conditions側は017マイグレーションで
      // 削除済み。race_conditions.series_day/is_final_dayはgenerate-predictions.js
      // で常にnull書き込みが確定しており（実データでも33,411件全行がnull、
      // 2026-09-15確認）、この関数では取得しない
      const [raceRows, resultRows] = await Promise.all([
        fetchAllByIn(
          "races",
          "race_id, race_date, venue_code, race_grade",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        ),
      ]);

      const raceById = new Map(raceRows.map((r) => [r.race_id, r]));
      const resultById = new Map(resultRows.map((r) => [r.race_id, r]));

      return entries
        .map((entry) => {
          const race = raceById.get(entry.race_id);
          const result = resultById.get(entry.race_id);
          if (!race || !isUsableRaceResult(result)) return null;
          return {
            raceId: entry.race_id,
            date: race.race_date,
            venueCode: race.venue_code,
            boatNumber: entry.boat_number,
            // racesの約76%のみrace_grade取得済み（2026-09-15確認）。
            // 未取得レースはグレードフィルタ「全レース」時のみ集計対象に含める
            raceGrade: race.race_grade ?? null,
            rank1: result.rank1,
            rank2: result.rank2,
            rank3: result.rank3,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    });
  },

  /**
   * 指定選手の過去2年分の出走履歴を、会場×枠番クロス集計用にフラットな形で
   * 1回だけ取得する（選手個人ページの会場×枠番フィルタ用）。
   * venueCode/boatNumberによる絞り込みは行わない（=racerIdだけでキャッシュ
   * できる）。フィルタ変更のたびに毎回re-fetchするのではなく、この関数を
   * racerId単位で1回だけ呼び、絞り込み・集計はaggregateRacerVenueBoatStats
   * （同ファイル内のプレーン関数）でクライアント側メモリ上に行う設計にして
   * いる（フィルタ操作をネットワークI/O無しの即時計算にするため）。
   * 中止・不成立レース（is_cancelled/is_no_race）とrank1未確定行は
   * ここで除外し、以降の集計側では意識しなくて済むようにする
   */
  getRacerRaceHistory(racerId) {
    return withCache(`racer-race-history-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 730);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows, exhibitionRows] = await Promise.all([
        fetchAllByIn("races", "race_id, venue_code", "race_id", raceIds),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, winning_technique, payout_win, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time, start_timing",
          "race_id",
          raceIds,
        ),
      ]);

      const venueByRaceId = new Map(
        raceRows.map((r) => [r.race_id, r.venue_code]),
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));
      const exhibitionByKey = new Map(
        exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
      );

      return entries
        .map((entry) => {
          const venueCode = venueByRaceId.get(entry.race_id) ?? null;
          const result = resultByRaceId.get(entry.race_id);
          const exhibition = exhibitionByKey.get(
            `${entry.race_id}-${entry.boat_number}`,
          );
          if (!venueCode || !isUsableRaceResult(result)) return null;
          return {
            raceId: entry.race_id,
            venueCode,
            boatNumber: entry.boat_number,
            rank1: result.rank1,
            rank2: result.rank2,
            rank3: result.rank3,
            winningTechnique: result.winning_technique ?? null,
            payoutWin: result.payout_win ?? null,
            exhibitionTime: exhibition?.exhibition_time ?? null,
            startTiming: exhibition?.start_timing ?? null,
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.raceId.localeCompare(b.raceId));
    });
  },

  /**
   * 指定選手の過去180日間の枠番別回収率を取得する（選手個人ページ用）
   * getRaceRacerBoatReturnRateと同じ集計ロジック（racer_id+boat_numberキー）を
   * racer_id単体向けに転用したもの。対象が1選手のみのためRPC化は不要
   */
  getRacerBoatReturnRate(racerId) {
    return withCache(`racer-boat-return-rate-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
        "race_id",
        raceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // boat_numberごとに集計（同じ選手でも枠番が違えば別集計）
      const statsByBoat = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.is_cancelled || result.is_no_race) return;

        if (!statsByBoat.has(e.boat_number)) {
          statsByBoat.set(e.boat_number, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByBoat.get(e.boat_number);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return [...statsByBoat.entries()]
        .map(([boatNumber, stats]) => ({
          boat_number: boatNumber,
          sample_count: stats.sampleCount,
          win_return_rate:
            stats.sampleCount > 0
              ? (stats.winPayoutSum / (stats.sampleCount * 100)) * 100
              : null,
          place_return_rate:
            stats.sampleCount > 0
              ? (stats.placePayoutSum / (stats.sampleCount * 100)) * 100
              : null,
        }))
        .sort((a, b) => a.boat_number - b.boat_number);
    });
  },

  /**
   * 指定会場・モーター番号の2連率/3連率の節ごとの推移を取得する（BOA-151）
   * race_entries.motor_2rate/3rate は節単位でのみ更新されるため、
   * 日付単位でdedupeして推移として扱う
   */
  getMotorConditionTrend(venueCode, motorNumber, days = 90) {
    return withCache(
      // v2: 展示タイム(exhibition_time)を追加(BOA-265軸B)。旧キャッシュ形状には
      // 無いフィールドのため、旧キーのままだと古いキャッシュがしばらく残ってしまう。
      // daysも末尾以外に含める（BOA-283の期間切り替え）
      `motor-condition-v2-${venueCode}-${motorNumber}-${days}`,
      async () => {
        const series = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
        );
        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          trend: series.map((d) => ({
            date: d.date,
            motor_2rate: d.motor_2rate,
            motor_3rate: d.motor_3rate,
            exhibition_time: d.exhibitionTime,
          })),
        };
      },
    );
  },

  /**
   * 指定モーターのプロペラ交換・部品交換の履歴を取得する（BOA-221）
   * 単独では「機力低下のサイン」にも「整備直後の好転サイン」にもなり得るため
   * （チケット参照）、イベント前後の展示タイム平均を比較し、方向感の目安
   * （improved/declined/neutral）を自動判定して添える。展示タイムは日次の
   * 実測値で、motor_2rate（公式サイトの「モーター交換時からの累積」値）と違い
   * イベント前後で単純比較できるため、この目的にはこちらを使う
   */
  getMotorPartsHistory(venueCode, motorNumber, days = 90) {
    return withCache(
      `motor-parts-history-${venueCode}-${motorNumber}-${days}`,
      async () => {
        const dateSeries = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
        );

        const avgOf = (list) => {
          const values = list
            .map((d) => d.exhibitionTime)
            .filter((v) => v !== null);
          return values.length > 0
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : null;
        };

        const events = [];
        dateSeries.forEach((d, i) => {
          if (!d.propellerChanged && !(d.parts && d.parts.length > 0)) return;

          const before = avgOf(
            dateSeries.slice(Math.max(0, i - INTERPRETATION_WINDOW_DAYS), i),
          );
          const after = avgOf(
            dateSeries.slice(i + 1, i + 1 + INTERPRETATION_WINDOW_DAYS),
          );
          let interpretation = null;
          if (before !== null && after !== null) {
            // 展示タイムは速いほど良い（小さいほど良い）ため、after<beforeは好転
            const diff = before - after;
            if (Math.abs(diff) >= NEUTRAL_EXHIBITION_DIFF_SEC) {
              interpretation = diff > 0 ? "improved" : "declined";
            } else {
              interpretation = "neutral";
            }
          }
          events.push({
            date: d.date,
            propellerChanged: d.propellerChanged,
            parts: d.parts,
            interpretation,
          });
        });

        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          events,
        };
      },
    );
  },

  /**
   * 指定レースの枠番別・展示ST/本番STのズレ（安定度）を取得する（BOA-153）
   * 展示STが本番の参考になるか（ズレが小さいほど安定）を選手ごとの過去実績から示す
   */
  getRaceStPredictabilityBreakdown(raceId) {
    return withCache(`race-st-predictability-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_st_predictability",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_st_predictability RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const { data: todaysExhibition } = await supabase
        .from("exhibition_data")
        .select("boat_number, start_timing")
        .eq("race_id", raceId);
      const exhibitionByBoat = new Map(
        (todaysExhibition ?? []).map((e) => [e.boat_number, e.start_timing]),
      );

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: null,
          sample_count: 0,
        }));
      }

      // 過去90日、当該レースより前の出走を選手ごとに収集
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: null,
          sample_count: 0,
        }));
      }

      // race_id 1件につき最大6艇分の行があるため、in()のキー数だけでなく取得行数も
      // 1000行を超えうる。chunkArrayだけでは不十分なため.range()ページネーションで全件取得する
      const [actualRows, exhibitionRows] = await Promise.all([
        fetchAllByIn(
          "race_start_timings",
          "race_id, boat_number, start_timing, is_flying",
          "race_id",
          pastRaceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, start_timing",
          "race_id",
          pastRaceIds,
        ),
      ]);

      const actualByKey = new Map();
      actualRows.forEach((r) => {
        if (r.is_flying) return; // フライングは異常値のためズレ計算から除外
        actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
      });

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
      });

      // 選手ごとに過去の |本番ST - 展示ST| を集計
      const deviationsByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const key = `${e.race_id}-${e.boat_number}`;
        const actual = actualByKey.get(key);
        const exhibition = exhibitionByKey.get(key);
        if (actual === undefined || exhibition === undefined) return;

        const deviation = Math.abs(actual - exhibition);
        if (!deviationsByRacer.has(e.racer_id)) {
          deviationsByRacer.set(e.racer_id, []);
        }
        deviationsByRacer.get(e.racer_id).push(deviation);
      });

      return entries.map((row) => {
        const deviations = deviationsByRacer.get(row.racer_id) ?? [];
        const avgDeviation =
          deviations.length > 0
            ? deviations.reduce((sum, d) => sum + d, 0) / deviations.length
            : null;
        return {
          ...row,
          exhibition_st: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_deviation: avgDeviation,
          sample_count: deviations.length,
        };
      });
    });
  },

  /**
   * 指定選手の展示ST/本番STのズレの推移を取得する（BOA-153）
   * フライングは異常値のため除外。同日複数レースは平均してグラフ用に日付単位でまとめる
   */
  getStDeviationTrend(racerId) {
    return withCache(`st-deviation-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (entriesError || !pastEntries || pastEntries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      // race_id 1件につき最大6艇分の行があるため.range()ページネーションで全件取得する
      const [actualRows, exhibitionRows] = await Promise.all([
        fetchAllByIn(
          "race_start_timings",
          "race_id, boat_number, start_timing, is_flying",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, start_timing",
          "race_id",
          raceIds,
        ),
      ]);

      const actualByKey = new Map();
      actualRows.forEach((r) => {
        if (r.is_flying) return;
        actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
      });

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
      });

      // 日付単位で当日の平均ズレをまとめる
      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const actual = actualByKey.get(key);
          const exhibition = exhibitionByKey.get(key);
          if (actual === undefined || exhibition === undefined) return;

          const deviation = Math.abs(actual - exhibition);
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(deviation);
        });

      const trend = [...byDate.entries()].map(([date, deviations]) => ({
        date,
        avg_deviation:
          deviations.reduce((sum, d) => sum + d, 0) / deviations.length,
      }));

      return { racer_id: racerId, trend };
    });
  },

  /**
   * 本日開催中のレースの出走選手について、直近90日間の平均展示タイム（周回タイム）を取得する（BOA-164）
   */
  getRaceExhibitionTimeBreakdown(raceId) {
    return withCache(`race-exhibition-time-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_exhibition_trend",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_exhibition_trend RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const { data: todaysExhibition } = await supabase
        .from("exhibition_data")
        .select("boat_number, exhibition_time")
        .eq("race_id", raceId);
      const exhibitionByBoat = new Map(
        (todaysExhibition ?? []).map((e) => [e.boat_number, e.exhibition_time]),
      );

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
        }));
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
        }));
      }

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        pastRaceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const timesByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const key = `${e.race_id}-${e.boat_number}`;
        const time = exhibitionByKey.get(key);
        if (time === undefined || time === null) return;

        if (!timesByRacer.has(e.racer_id)) {
          timesByRacer.set(e.racer_id, []);
        }
        timesByRacer.get(e.racer_id).push(time);
      });

      return entries.map((row) => {
        const times = timesByRacer.get(row.racer_id) ?? [];
        const avgTime =
          times.length > 0
            ? times.reduce((sum, t) => sum + t, 0) / times.length
            : null;
        return {
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: avgTime,
          sample_count: times.length,
        };
      });
    });
  },

  /**
   * 指定レースのチルト・調整重量・当日体重・前走成績を取得する（BOA-221/BOA-289）
   * 展示タイムと同じ行(exhibition_data)の別列で、履歴平均を出す必要が無い
   * 「今回のレースでの設定値・直近の実績値」のため、getRaceExhibitionTimeBreakdownの
   * ような過去90日平均フォールバックは不要。単純に該当race_idの1回読み取りで足りる
   *
   * BOA-289の新列（today_weight/prev_race_no/prev_entry_course/prev_start_timing/
   * prev_finish_rank、マイグレーション059）は未適用環境がありうる。1回のselectに
   * 未適用の列を含めると「column does not exist」でクエリ全体が失敗し、既に動作している
   * tilt/adjustment_weight（BOA-221、マイグレーション056）まで巻き添えで表示できなくなる。
   * これを避けるため、失敗時は新列を除いた旧列のみで再取得する
   */
  getRaceMotorMaintenanceBreakdown(raceId) {
    return withCache(`race-motor-maintenance-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data, error } = await supabase
        .from("exhibition_data")
        .select(
          "boat_number, tilt, adjustment_weight, today_weight, prev_race_no, prev_entry_course, prev_start_timing, prev_finish_rank",
        )
        .eq("race_id", raceId);

      if (error) {
        if (/column .* does not exist/i.test(error.message)) {
          console.warn(
            "exhibition_data: BOA-289の新列が未適用のため旧列のみで再取得します（マイグレーション059未適用の可能性）:",
            error.message,
          );
          const { data: legacyData, error: legacyError } = await supabase
            .from("exhibition_data")
            .select("boat_number, tilt, adjustment_weight")
            .eq("race_id", raceId);
          if (legacyError) {
            console.error(
              "exhibition_data(チルト/調整重量)取得エラー:",
              legacyError.message,
            );
            return [];
          }
          return legacyData ?? [];
        }
        console.error(
          "exhibition_data(チルト/調整重量/当日体重/前走成績)取得エラー:",
          error.message,
        );
        return [];
      }

      return data ?? [];
    });
  },

  /**
   * 指定選手の展示タイム（周回タイム）の推移を取得する（BOA-164）
   * 同日複数レースは平均してグラフ用に日付単位でまとめる
   */
  getExhibitionTimeTrend(racerId) {
    return withCache(`exhibition-time-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: entriesError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (entriesError || !pastEntries || pastEntries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        raceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const time = exhibitionByKey.get(key);
          if (time === undefined || time === null) return;

          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(time);
        });

      const trend = [...byDate.entries()].map(([date, times]) => ({
        date,
        avg_exhibition_time:
          times.reduce((sum, t) => sum + t, 0) / times.length,
      }));

      return { racer_id: racerId, trend };
    });
  },

  /**
   * 指定レースの選手コース別統計（racerStats）を取得する（BOA-168）
   * predictions.feature_contributions.racerStats に日次バッチで保存済みの
   * 進入コース・平均ST・コース別勝敗・攻め手/守り手分布を返す。
   * 超展開データタブ・データ出走表の平均ST/枠番勝率行で使用する。
   * 注: 「コース」という名称だが、実際の進入コース変化（前づけ）は
   * BOA-257の制約により区別できず、実質的に枠番（艇番）基準の値である
   * （raceIndicators.jsxのcourseRateOf関数も参照）
   */
  getRaceRacerStats(raceId) {
    return withCache(`race-racer-stats-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // shadow予測が併存する可能性があるためmaybeSingleは使わず最新1件を取る
      const { data, error } = await supabase
        .from("predictions")
        .select("model_id, feature_contributions, predicted_at")
        .eq("race_id", raceId)
        .eq("model_id", "standard")
        .order("predicted_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("predictions取得エラー:", error.message);
        return null;
      }
      return data?.[0]?.feature_contributions?.racerStats ?? null;
    });
  },

  /**
   * 指定レースの複勝オッズ（最新スクレイプ分）を取得する（AI予想モデル大規模改修、複勝予想バッジ用）
   * 複勝オッズは下限-上限のレンジで提供される（race_odds.odds_place_{n}_low/high、マイグレーション032）。
   * 未適用環境・スクレイピング未実施のレースではlow/highともnullを返す
   */
  getRacePlaceOdds(raceId) {
    return withCache(`race-place-odds-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("race_odds")
        .select(
          "odds_place_1_low, odds_place_1_high, odds_place_2_low, odds_place_2_high, odds_place_3_low, odds_place_3_high, odds_place_4_low, odds_place_4_high, odds_place_5_low, odds_place_5_high, odds_place_6_low, odds_place_6_high",
        )
        .eq("race_id", raceId)
        .order("captured_at", { ascending: false })
        .limit(1);

      if (error) {
        console.error("race_odds（複勝）取得エラー:", error.message);
        return null;
      }
      const row = data?.[0];
      if (!row) return null;
      return [1, 2, 3, 4, 5, 6].map((n) => ({
        boat_number: n,
        odds_place_low: row[`odds_place_${n}_low`] ?? null,
        odds_place_high: row[`odds_place_${n}_high`] ?? null,
      }));
    });
  },

  /**
   * unifiedモデルの実測精度（複勝的中率・回収率、展開的中率）を取得する（BOA-179関連）
   * scripts/daily/calculate-unified-model-accuracy.js が日次で accuracy_cache に
   * 保存した集計値を読むだけなので軽量。AIデータ分析の複勝予想/展開予測カードで
   * 「過去の実測実績」を動的に表示するために使う
   */
  getUnifiedModelAccuracy() {
    return withCache(
      "unified-model-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data, error } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_model_accuracy")
          .single();

        if (error) {
          console.error("unified_model_accuracy取得エラー:", error.message);
          return null;
        }
        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000, // 6時間キャッシュ（日次バッチでしか更新されないため長め）
    );
  },

  /**
   * unifiedモデルのイン崩れ指数の実測精度（レベル別イン崩れ率）を取得する（BOA-177）
   * scripts/daily/calculate-unified-volatility-accuracy.js が日次で accuracy_cache に
   * 保存した集計値を読むだけ。既存のVolatilityAccuracySectionコンポーネントと
   * 同じshape（baseline/byLevel）で返す
   */
  getUnifiedVolatilityAccuracy() {
    return withCache(
      "unified-volatility-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data, error } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_volatility_accuracy")
          .single();

        if (error) {
          console.error(
            "unified_volatility_accuracy取得エラー:",
            error.message,
          );
          return null;
        }
        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000,
    );
  },

  /**
   * 指定レースの出走表詳細（race_entriesの全選手データ）を取得する（BOA-168）
   * 分析ツールの「出走表データ」タブで使用する。AIスコアは含めない
   */
  getRaceEntriesDetail(raceId) {
    return withCache(`race-entries-detail-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const [entriesRes, exhibitionRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, grade, age, win_rate, local_win_rate, global_2rate, motor_number, motor_2rate",
          )
          .eq("race_id", raceId)
          .order("boat_number"),
        supabase
          .from("exhibition_data")
          .select("boat_number, exhibition_time, start_timing")
          .eq("race_id", raceId),
      ]);

      if (entriesRes.error || !entriesRes.data) {
        if (entriesRes.error)
          console.error("race_entries取得エラー:", entriesRes.error.message);
        return [];
      }
      const exByBoat = new Map(
        (exhibitionRes.data ?? []).map((e) => [e.boat_number, e]),
      );
      return entriesRes.data.map((row) => ({
        ...row,
        exhibition_time: exByBoat.get(row.boat_number)?.exhibition_time ?? null,
        exhibition_st: exByBoat.get(row.boat_number)?.start_timing ?? null,
      }));
    });
  },

  /**
   * 指定レースの結果サマリー（着順・決まり手）を取得する（BOA-168）
   * Edge Function経由のpredictionデータにはwinning_techniqueが含まれないため、
   * 「データで振り返る」はこの関数で確実に決まり手を取得する
   */
  getRaceResultSummary(raceId) {
    return withCache(`race-result-summary-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data, error } = await supabase
        .from("race_results")
        .select(
          "race_id, rank1, rank2, rank3, winning_technique, is_cancelled, is_no_race",
        )
        .eq("race_id", raceId)
        .maybeSingle();

      if (error) {
        console.error("race_results取得エラー:", error.message);
        return null;
      }
      return data ?? null;
    });
  },

  /**
   * 本日開催中のレースの出走選手について、過去180日間・同じ艇番で出走した
   * レースでの単勝回収率・複勝回収率を取得する（BOA-167）
   * AI予想モデルの確率は使わず、race_results.payout_win/payout_place_1/2の
   * 過去の実績払戻金のみを集計する（期待値分析のようなモデル較正は不要）
   */
  getRaceRacerBoatReturnRate(raceId) {
    return withCache(`race-racer-boat-return-rate-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_return_rate",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_return_rate RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const relevantPastEntries = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("race_entries")
          .select("race_id, boat_number, racer_id")
          .in("racer_id", racerIds)
          .gte("race_id", cutoffStr)
          .lt("race_id", raceId)
          .range(from, from + pageSize - 1);
        if (error) {
          console.error("過去出走データ取得エラー:", error.message);
          break;
        }
        if (!data || data.length === 0) break;
        relevantPastEntries.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (relevantPastEntries.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const pastRaceIds = [
        ...new Set(relevantPastEntries.map((e) => e.race_id)),
      ];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, is_cancelled, is_no_race",
        "race_id",
        pastRaceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // racer_id + boat_number ごとに集計（同じ選手でも艇番が違えば別集計）
      const statsByRacerBoat = new Map();
      relevantPastEntries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.is_cancelled || result.is_no_race) return;

        const key = `${e.racer_id}-${e.boat_number}`;
        if (!statsByRacerBoat.has(key)) {
          statsByRacerBoat.set(key, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByRacerBoat.get(key);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return entries.map((row) => {
        const stats = statsByRacerBoat.get(
          `${row.racer_id}-${row.boat_number}`,
        );
        if (!stats || stats.sampleCount === 0) {
          return {
            ...row,
            sample_count: 0,
            win_return_rate: null,
            place_return_rate: null,
          };
        }
        return {
          ...row,
          sample_count: stats.sampleCount,
          win_return_rate:
            (stats.winPayoutSum / (stats.sampleCount * 100)) * 100,
          place_return_rate:
            (stats.placePayoutSum / (stats.sampleCount * 100)) * 100,
        };
      });
    });
  },

  /**
   * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
   * 急上昇/急下降ランキングを作成する（BOA-166）
   * 会場・レース単位の選手調子（BOA-152）とは異なり、レース選択前の発見導線として
   * 本日カード全体を横断する
   */
  getTodaysRacerFormRanking(limit = 10) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(
      `todays-racer-form-ranking-${today}-${limit}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { rising: [], falling: [] };
        }

        const { data: races, error: racesError } = await supabase
          .from("races")
          .select("race_id, venue_code, race_number")
          .eq("race_date", today);

        if (racesError || !races || races.length === 0) {
          if (racesError) console.error("races取得エラー:", racesError.message);
          return { rising: [], falling: [] };
        }

        const raceMetaByRaceId = new Map(races.map((r) => [r.race_id, r]));
        const raceIds = races.map((r) => r.race_id);

        const entries = await fetchAllByIn(
          "race_entries",
          "race_id, boat_number, player_name, racer_id, win_rate",
          "race_id",
          raceIds,
        );

        // 同じ選手が本日複数レースに出走することは無いはずだが、念のためracer_idごとに最初の1件のみ採用
        const currentByRacer = new Map();
        entries.forEach((e) => {
          if (e.racer_id === null || e.win_rate === null) return;
          if (!currentByRacer.has(e.racer_id))
            currentByRacer.set(e.racer_id, e);
        });

        if (currentByRacer.size === 0) return { rising: [], falling: [] };

        // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
        const windowStart = new Date(ninetyDaysAgo);
        windowStart.setDate(windowStart.getDate() - 14);
        const windowStartStr = windowStart.toISOString().split("T")[0];

        // racer_idのIN句が大きくなりうるため、race_id範囲（全会場横断・2週間分）で
        // まとめて取得しracer_idでフィルタする
        const pastRows = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("race_entries")
            .select("race_id, racer_id, win_rate")
            .gte("race_id", windowStartStr)
            .lte("race_id", cutoff)
            .order("race_id", { ascending: false })
            .range(from, from + pageSize - 1);
          if (error) {
            console.error("過去データ取得エラー:", error.message);
            break;
          }
          if (!data || data.length === 0) break;
          pastRows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
        const pastByRacer = new Map();
        pastRows.forEach((row) => {
          if (!currentByRacer.has(row.racer_id)) return;
          if (!pastByRacer.has(row.racer_id)) {
            pastByRacer.set(row.racer_id, row.win_rate);
          }
        });

        const withDelta = [...currentByRacer.values()]
          .map((entry) => {
            const pastWinRate = pastByRacer.get(entry.racer_id) ?? null;
            const meta = raceMetaByRaceId.get(entry.race_id);
            return {
              ...entry,
              venue_code: meta?.venue_code ?? null,
              race_number: meta?.race_number ?? null,
              past_win_rate: pastWinRate,
              delta: pastWinRate !== null ? entry.win_rate - pastWinRate : null,
            };
          })
          .filter((row) => row.delta !== null);

        const rising = [...withDelta]
          .sort((a, b) => b.delta - a.delta)
          .slice(0, limit);
        const falling = [...withDelta]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, limit);

        return { rising, falling };
      },
    );
  },

  /**
   * 本日の結果確定済みレースを会場別に横断集計し、4指標（固い場/荒れている場/
   * イン逃げ率/万舟率）でランキングする（BOA-171）
   * 消化レース数が少ない会場（minRaceCount未満）はサンプル不足のためランキング対象から除外する
   *
   * 注意: 3連単配当は race_results.payout_trio を使う（DB列名と実態が歴史的経緯で
   * 逆転しており、payout_trifecta は実態3連複のため使わない。scripts/lib/payoutCalculator.js参照）
   */
  getTodaysVenueRanking(limit = 5, minRaceCount = 3) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    const empty = { stable: [], rough: [], nigeRate: [], manshu: [] };

    // 本日限定のリアルタイム集計のため、グローバルの30分キャッシュ（inferTtlFromKey）
    // ではなく短めのTTLを明示指定する。特に「まだ結果確定レースが無い」空状態が
    // 30分間キャッシュされ続けると、レース確定後もリアルタイム性が損なわれるため
    const VENUE_RANKING_CACHE_TTL = 5 * 60 * 1000; // 5分

    return withCache(
      `todays-venue-ranking-${today}-${limit}-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const { data: races, error: racesError } = await supabase
          .from("races")
          .select("race_id, venue_code")
          .eq("race_date", today);

        if (racesError || !races || races.length === 0) {
          if (racesError) console.error("races取得エラー:", racesError.message);
          return empty;
        }

        const venueByRaceId = new Map(
          races.map((r) => [r.race_id, r.venue_code]),
        );
        const raceIds = races.map((r) => r.race_id);

        const results = await fetchAllByIn(
          "race_results",
          "race_id, rank1, payout_trio, winning_technique, is_cancelled, is_no_race",
          "race_id",
          raceIds,
        );

        const byVenue = new Map();
        results.forEach((r) => {
          if (r.is_cancelled || r.is_no_race || r.rank1 === null) return;
          const venueCode = venueByRaceId.get(r.race_id);
          if (venueCode === null || venueCode === undefined) return;
          if (!byVenue.has(venueCode)) {
            byVenue.set(venueCode, {
              venue_code: venueCode,
              raceCount: 0,
              payoutCount: 0,
              payoutSum: 0,
              nigeCount: 0,
              manshuCount: 0,
            });
          }
          const v = byVenue.get(venueCode);
          v.raceCount += 1;
          if (r.payout_trio !== null) {
            v.payoutCount += 1;
            v.payoutSum += r.payout_trio;
            if (r.payout_trio >= 10000) v.manshuCount += 1;
          }
          if (r.rank1 === 1 && r.winning_technique === "逃げ") v.nigeCount += 1;
        });

        // イン逃げ率は配当データに依存しないため、配当が1件も取れていない会場
        // （payoutCount=0）も対象に含める。固い場/荒れている場/万舟率は
        // payout_trioの平均・件数を使うためpayoutCount>0の会場のみ対象とする
        const qualifyingVenues = [...byVenue.values()].filter(
          (v) => v.raceCount >= minRaceCount,
        );

        const nigeRateVenues = qualifyingVenues.map((v) => ({
          venue_code: v.venue_code,
          race_count: v.raceCount,
          nige_rate: (v.nigeCount / v.raceCount) * 100,
        }));

        const payoutVenues = qualifyingVenues
          .filter((v) => v.payoutCount > 0)
          .map((v) => ({
            venue_code: v.venue_code,
            race_count: v.raceCount,
            avg_payout: v.payoutSum / v.payoutCount,
            manshu_rate: (v.manshuCount / v.payoutCount) * 100,
          }));

        const byAvgPayoutAsc = [...payoutVenues].sort(
          (a, b) => a.avg_payout - b.avg_payout,
        );
        const byAvgPayoutDesc = [...payoutVenues].sort(
          (a, b) => b.avg_payout - a.avg_payout,
        );

        return {
          stable: byAvgPayoutAsc.slice(0, limit),
          rough: byAvgPayoutDesc.slice(0, limit),
          nigeRate: [...nigeRateVenues]
            .sort((a, b) => b.nige_rate - a.nige_rate)
            .slice(0, limit),
          manshu: [...payoutVenues]
            .sort((a, b) => b.manshu_rate - a.manshu_rate)
            .slice(0, limit),
        };
      },
      VENUE_RANKING_CACHE_TTL,
    );
  },

  /**
   * 全24会場の1号艇勝率ランキングを取得する（BOA-267、venuerankingタブの追加指標）
   * venues.avg_first_win_rate（update-venue-stats.jsが日次バッチで更新するキャッシュ列）
   * には依存せず、直近days日のrace_results/racesから都度ライブ集計する。バッチの実行
   * タイミングに依存せず常に最新の値になり、消化レース数（race_count）も同時に得られる
   * （avg_first_win_rate列は値のみでレース数を保持していないため）。
   * 注: 90日全会場スキャンは軽くないため6時間キャッシュにしている（BOA-303で
   * update-venue-stats.js側にrace_count列を追加しavg_first_win_rateを読むだけの
   * 実装に置き換えることを検討、そちらはDBマイグレーションの手動適用が必要なため
   * 本チケットでは見送った）
   */
  getVenueFirstWinRateRanking(days = 90, minRaceCount = 3) {
    const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間（90日集計は変化が緩やか）
    return withCache(
      `venue-first-win-rate-ranking-${days}-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const jstOffset = 9 * 60;
        const jstNow = new Date(Date.now() + jstOffset * 60 * 1000);
        const since = new Date(jstNow);
        since.setDate(since.getDate() - days);
        const sinceStr = since.toISOString().split("T")[0];

        const races = [];
        const PAGE = 1000;
        let from = 0;
        while (true) {
          const { data, error } = await supabase
            .from("races")
            .select("venue_code, race_results(rank1, is_cancelled, is_no_race)")
            .gte("race_date", sinceStr)
            .order("race_id")
            .range(from, from + PAGE - 1);
          if (error) {
            // getAllRacersLiteと同じ教訓（2026-09-08）: ここで[]を返すとエラー時の
            // 結果が正常値としてキャッシュされ、取得済み分のデータも道連れで
            // 破棄されてしまう。エラーは必ずthrowしてwithCacheにキャッシュさせない
            throw new Error(`races取得エラー: ${error.message}`);
          }
          if (!data || data.length === 0) break;
          races.push(...data);
          if (data.length < PAGE) break;
          from += PAGE;
        }

        const byVenue = new Map();
        races.forEach((r) => {
          const result = Array.isArray(r.race_results)
            ? r.race_results[0]
            : r.race_results;
          if (!isUsableRaceResult(result)) return;
          const venueCode = r.venue_code;
          if (!byVenue.has(venueCode)) {
            byVenue.set(venueCode, {
              venue_code: venueCode,
              race_count: 0,
              firstWins: 0,
            });
          }
          const v = byVenue.get(venueCode);
          v.race_count += 1;
          if (result.rank1 === 1) v.firstWins += 1;
        });

        return [...byVenue.values()]
          .filter((v) => v.race_count >= minRaceCount)
          .map((v) => ({
            venue_code: v.venue_code,
            race_count: v.race_count,
            first_win_rate: (v.firstWins / v.race_count) * 100,
          }))
          .sort((a, b) => b.first_win_rate - a.first_win_rate);
      },
      CACHE_TTL,
    );
  },

  /**
   * 本日開催中のレースの出走選手について、過去90日間で勝った時の決まり手構成比を取得する（BOA-165）
   * 会場・枠番単位の決まり手データ分析（BOA-150）とは異なり、選手個人単位の勝ちパターンを見る機能
   */
  getRaceTechniqueProfileBreakdown(raceId) {
    return withCache(`race-technique-profile-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "get_race_technique_profile",
        { p_race_id: raceId },
      );
      if (!rpcError && Array.isArray(rpcData)) {
        return rpcData;
      }
      if (rpcError) {
        console.warn(
          "get_race_technique_profile RPC未適用のため旧ロジックで取得:",
          rpcError.message,
        );
      }

      const { data: entries, error: entriesError } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (entriesError || !entries || entries.length === 0) {
        if (entriesError)
          console.error("race_entries取得エラー:", entriesError.message);
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries, error: pastError } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      if (pastError) {
        console.error("過去出走データ取得エラー:", pastError.message);
      }

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        pastRaceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const techniqueCountsByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計

        if (!techniqueCountsByRacer.has(e.racer_id)) {
          techniqueCountsByRacer.set(e.racer_id, new Map());
        }
        const counts = techniqueCountsByRacer.get(e.racer_id);
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      return entries.map((row) => {
        const counts = techniqueCountsByRacer.get(row.racer_id) ?? new Map();
        const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
        const techniques = [...counts.entries()]
          .map(([technique, count]) => ({
            technique,
            count,
            percentage: winCount > 0 ? (count / winCount) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);
        return {
          ...row,
          win_count: winCount,
          techniques,
        };
      });
    });
  },

  /**
   * 会場別・枠番別のトップスタート実績（回数/確率、トップスタート時の1着率）を取得する（BOA-154）
   * 日次バッチ（scripts/daily/update-top-start-stats.js）で事前集計したテーブルを参照する
   */
  getTopStartStats(venueCode) {
    return withCache(`top-start-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data, error } = await supabase
        .from("top_start_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number");

      if (error) {
        console.error("Supabase getTopStartStats error:", error.message);
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      return {
        venue_code: venueCode,
        last_updated: data?.[0]?.last_updated ?? null,
        data: data ?? [],
      };
    });
  },

  /**
   * 会場別・枠番別の負け決まり手（1着を逃した際、勝者がどの決まり手で勝ったか）を取得する（BOA-157）
   * 既存のgetWinningTechniqueStatsと対になる。v1ではEdge API連携は行わず、Supabase直接クエリのみ
   */
  getLosingTechniqueStats(venueCode) {
    return withCache(`losing-technique-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("losing_technique_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number")
        .order("percentage", { ascending: false });

      if (error) {
        console.error("Supabase getLosingTechniqueStats error:", error.message);
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const techniqueData = {};
      let lastUpdated = null;

      data.forEach((row) => {
        const boatNumber = row.boat_number;
        if (!techniqueData[boatNumber]) {
          techniqueData[boatNumber] = {
            total_races: row.total_losses_90days,
            techniques: [],
          };
        }

        techniqueData[boatNumber].techniques.push({
          technique: row.losing_technique,
          count: row.count_90days,
          percentage: row.percentage,
        });

        if (!lastUpdated) {
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        last_updated: lastUpdated,
        data: techniqueData,
      };
    });
  },

  /**
   * 逃げ成功時（winning_technique='逃げ'）の複勝分布を取得する（BOA-158）
   * 既存のgetOutcomeDistributionと対になるが、テーブル・集計とも分離されている
   */
  getNigeOutcomeDistribution(venueCode) {
    return withCache(`nige-outcome-distribution-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const { data, error } = await supabase
        .from("nige_outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (error) {
        console.error(
          "Supabase getNigeOutcomeDistribution error:",
          error.message,
        );
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const outcomesData = {};
      let totalRaces = 0;
      let lastUpdated = null;

      data.forEach((row) => {
        const firstBoat = row.first_boat;
        if (!outcomesData[firstBoat]) {
          outcomesData[firstBoat] = [];
        }

        outcomesData[firstBoat].push({
          second_boat: row.second_boat,
          third_boat: row.third_boat,
          count: row.count_90days,
          probability: row.probability,
          avg_payout: row.avg_payout,
        });

        if (!totalRaces) {
          totalRaces = row.total_races;
          lastUpdated = row.last_updated;
        }
      });

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
        10: "三国",
        11: "びわこ",
        12: "住之江",
        13: "尼崎",
        14: "鳴門",
        15: "丸亀",
        16: "児島",
        17: "宮島",
        18: "徳山",
        19: "下関",
        20: "若松",
        21: "芦屋",
        22: "福岡",
        23: "唐津",
        24: "大村",
      };

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        total_races: totalRaces,
        last_updated: lastUpdated,
        data: outcomesData,
      };
    });
  },

  /**
   * 会場別・枠番別の展示タイム最速実績（回数/確率、最速時の1着率）を取得する（BOA-160）
   * 日次バッチ（scripts/daily/update-exhibition-time-top-stats.js）で事前集計したテーブルを参照する
   */
  getExhibitionTimeTopStats(venueCode) {
    return withCache(`exhibition-time-top-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data, error } = await supabase
        .from("exhibition_time_top_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number");

      if (error) {
        console.error(
          "Supabase getExhibitionTimeTopStats error:",
          error.message,
        );
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      return {
        venue_code: venueCode,
        last_updated: data?.[0]?.last_updated ?? null,
        data: data ?? [],
      };
    });
  },

  /**
   * unifiedモデルの3連単参考情報（FR4）を1レース分取得する（AI予想モデル大規模改修 Task11）。
   * scripts/daily/generate-unified-trifecta-reference.js（発走前バッチ）が書き込む。
   * 発走前バッチ未実行の時間帯はnullを返す（呼び出し側で非表示にする）
   */
  async getUnifiedTrifectaReference(raceId) {
    if (!supabase || !raceId) return null;
    const { data, error } = await supabase
      .from("bet_recommendations")
      .select(
        "recommendation, expected_value, expected_hit_rate, expected_payout, reasons",
      )
      .eq("model_id", "unified")
      .eq("race_id", raceId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      recommendation: data.recommendation,
      expectedValue: data.expected_value,
      expectedHitRate: data.expected_hit_rate,
      expectedPayout: data.expected_payout,
      combo: data.reasons?.combo ?? null,
      odds: data.reasons?.odds ?? null,
    };
  },

  /**
   * 1レース分の各艇スタートタイミングを取得する（BOA-238）。
   * race_start_timingsは1レースにつき最大6行の1対多テーブルのため、一覧表示用の
   * getPredictions()/RPCには含めず、レース詳細ページ表示時にRaceResult.jsxから
   * この関数で個別に軽量フェッチする
   */
  async getRaceStartTimings(raceId) {
    if (!supabase || !raceId) return [];
    const { data, error } = await supabase
      .from("race_start_timings")
      .select("boat_number, start_timing, is_flying, is_late_start")
      .eq("race_id", raceId)
      .order("boat_number");

    if (error || !data) return [];

    return data.map((row) => ({
      boatNumber: row.boat_number,
      startTiming: row.start_timing,
      isFlying: row.is_flying,
      isLateStart: row.is_late_start,
    }));
  },

  /**
   * 指定会場の「グレード×艇番」横断統計を取得する（BOA-263）
   * scripts/daily/calculate-venue-grade-stats.jsが日次バッチで事前集計した
   * venue_grade_boat_statsテーブルを読むだけ（全会場横断のためライブ集計はしない。
   * BOA-267のコードレビューで指摘された「全会場集計は必ずバッチ事前集計する」
   * という既存規約に最初から従っている）。boat_number=0はレース全体（艇番非依存）
   * の集計行を表すセンチネル値
   */
  getVenueGradeBoatStats(venueCode) {
    return withCache(`venue-grade-boat-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }
      const { data, error } = await supabase
        .from("venue_grade_boat_stats")
        .select(
          "race_grade, boat_number, race_count, wins, top2, top3, technique_breakdown, manshu_count, payout_count, payout_trio_sum",
        )
        .eq("venue_code", venueCode);
      if (error) {
        // withCacheは成功時（.then）のみキャッシュするため、ここで[]を返すと
        // 一時的なエラーが正常な「データなし」として30分キャッシュされてしまう
        // （getAllRacersLiteと同じ理由、2026-09-08のコードレビューで発見済みの
        // バグクラス）。必ずthrowしてキャッシュさせない
        throw new Error(`venue_grade_boat_stats取得エラー: ${error.message}`);
      }
      return data ?? [];
    });
  },

  /**
   * 会場×グレード統計データを保持する全会場のコード一覧を取得する（BOA-263）
   * venue_grade_boat_statsに1件でも行がある会場のみを選択肢として提示するため
   */
  getVenuesWithGradeStats() {
    return withCache("venues-with-grade-stats", async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("venue_grade_boat_stats")
        .select("venue_code");
      if (error) {
        throw new Error(`venue_grade_boat_stats取得エラー: ${error.message}`);
      }
      return [...new Set((data ?? []).map((r) => r.venue_code))].sort(
        (a, b) => a - b,
      );
    });
  },
};

/**
 * getRacerRaceHistory()が返すフラット履歴を「会場×枠番」で絞り込み集計する
 * 純粋関数（I/O無し）。venueCode/boatNumberはnullで絞り込みなしを表す。
 * 選手個人ページの会場×枠番フィルタが変更されるたびにこれを呼ぶことで、
 * ネットワークI/O無しで即座に再集計できる。
 * 注: 実際の進入コースはBOA-257の制約により取得できないため、発走前に
 * 決まる枠番（艇番）基準で集計する
 * @param {Array} history - getRacerRaceHistory()の戻り値
 * @param {number|null} venueCode
 * @param {number|null} boatNumber
 */
export function aggregateRacerVenueBoatStats(history, venueCode, boatNumber) {
  let n = 0,
    win = 0,
    top2 = 0,
    top3 = 0,
    returnSum = 0,
    stSum = 0,
    stN = 0;
  const tech = {};
  const series = [];

  for (const row of history ?? []) {
    if (venueCode && row.venueCode !== venueCode) continue;
    if (boatNumber && row.boatNumber !== boatNumber) continue;

    n += 1;
    const isWin = row.rank1 === row.boatNumber;
    if (isWin) {
      win += 1;
      if (row.winningTechnique) {
        tech[row.winningTechnique] = (tech[row.winningTechnique] ?? 0) + 1;
      }
      returnSum += row.payoutWin ?? 0;
    }
    if (isPlaceHit(row.boatNumber, row.rank1, row.rank2)) {
      top2 += 1;
    }
    if (isShowHit(row.boatNumber, row.rank1, row.rank2, row.rank3)) {
      top3 += 1;
    }

    const hasEx = row.exhibitionTime !== null;
    const hasSt = row.startTiming !== null;
    if (hasSt) {
      stSum += Number(row.startTiming);
      stN += 1;
    }
    if (hasEx || hasSt) {
      // historyは既にrace_id（YYYY-MM-DD-会場-レース番号）昇順でソート済みの
      // ため点の並び順は正しいが、対象期間が最大2年に及ぶため月日だけを表示
      // すると異なる年の同じ月日が同一ラベルに見えてしまう。年下2桁を含めて
      // 曖昧さを避ける（例: "25-05-12"）
      series.push({
        date: row.raceId.slice(2, 10),
        avg_exhibition_time: hasEx ? Number(row.exhibitionTime) : null,
        start_timing: hasSt ? Number(row.startTiming) : null,
      });
    }
  }

  return {
    n,
    win,
    top2,
    top3,
    winRate: n > 0 ? win / n : null,
    top2Rate: n > 0 ? top2 / n : null,
    top3Rate: n > 0 ? top3 / n : null,
    tech,
    avgSt: stN > 0 ? stSum / stN : null,
    stN,
    returnRate: n > 0 ? (returnSum / (n * 100)) * 100 : null,
    series,
  };
}
