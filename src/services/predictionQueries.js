// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: prediction）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { PAYOUT_BET_TYPES } from "../utils/raceOutcome.js";

/**
 * getPredictions()の取得失敗を表す空レスポンス。
 * races: [] は既存の呼び出し側（HitRaces等、`data.races || []`で読むもの）を壊さない
 * ための互換値で、「取得に成功したが開催なし（fetchFailedなし）」との区別は
 * fetchFailed: true で行う。withCache()はこの値をキャッシュしない
 */
export function buildFetchFailedPredictions(date) {
  return {
    date,
    generatedAt: null,
    updatedAt: null,
    races: [],
    fetchFailed: true,
  };
}

/**
 * 会場コード→会場名のマッピング
 */
export const VENUE_NAMES = {
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
/**
 * RPC の payoutRows（race_payouts の行の配列）を、結果タブの払戻表の行へ変換する（BOA-543）。
 * status: paid=通常 / special=特払 / no_amount=組番のみ（払戻金が空欄）/ no_race=不成立（返還）。
 * combination は「1-2-5」（079）。配列でなければ null（旧列へのフォールバック）
 */
function buildPayoutRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const order = new Map(PAYOUT_BET_TYPES.map((b, i) => [b.betType, i]));
  const known = rows.filter((row) => order.has(row?.betType));
  // 知らない勝式しか無い（将来の追加等）ときは、空の払戻表を出さず旧列にフォールバックさせる
  if (known.length === 0) return null;
  return known
    .map((row) => {
      const meta = PAYOUT_BET_TYPES[order.get(row.betType)];
      return {
        betType: row.betType,
        typeKey: meta.typeKey,
        separator: meta.separator,
        seq: Number(row.seq) || 1,
        boats: row.combination
          ? String(row.combination)
              .split("-")
              .map(Number)
              .filter((n) => Number.isInteger(n))
          : [],
        amount: typeof row.payout === "number" ? row.payout : null,
        status: row.payoutStatus ?? null,
        popularity: row.popularity ?? null,
      };
    })
    .sort(
      (a, b) => order.get(a.betType) - order.get(b.betType) || a.seq - b.seq,
    );
}

export function buildRaceResult(r) {
  if (!r || !r.rank1) return null;

  const sortAsc = (nums) => [...nums].sort((a, b) => a - b);
  const wideEntry = (amount, popularity, boats) =>
    amount
      ? { boats: sortAsc(boats), amount, popularity: popularity ?? null }
      : null;

  return {
    finished: true,
    isCancelled: r.isCancelled || false,
    // レースの成立状態と返還艇（078。109でRPCに追加）。判定は src/utils/raceOutcome.js を通す。
    // 旧フラグ isNoRace（is_no_race）は全行 false で機能していないため持たない（BOA-543）。
    // RPC未適用・078以前の行は null（＝未判定。今までどおり通常のレースとして扱う）
    raceStatus: r.raceStatus ?? null,
    refundBoats: Array.isArray(r.refundBoats) ? r.refundBoats : null,
    remark: r.remark ?? null,
    // 払戻明細（race_payouts、109でRPCに追加）。無ければ null で、結果タブは旧 payout_* 列の
    // payouts にフォールバックする（RPC未適用・過去データ・直接クエリのフォールバック経路）
    payoutRows: buildPayoutRows(r.payoutRows),
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
 * 予想根拠を生成する関数
 * 各モデルの特性に基づいた詳細な分析結果を生成
 */
export function generateReasoning(topPickPlayer, modelType) {
  if (!topPickPlayer) return ["予想データなし"];

  const c = {
    number: topPickPlayer.number,
    name: topPickPlayer.name,
    grade: topPickPlayer.grade || "",
    winRate: parseFloat(topPickPlayer.winRate) || 0,
    localWinRate: parseFloat(topPickPlayer.localWinRate) || 0,
    motor2Rate: parseFloat(topPickPlayer.motor2Rate) || 0,
    boat2Rate: parseFloat(topPickPlayer.boat2Rate) || 0,
  };

  if (modelType === "standard") return reasonsStandard(topPickPlayer, c);
  if (modelType === "safeBet") return reasonsSafeBet(topPickPlayer, c);
  if (modelType === "upsetFocus") return reasonsUpsetFocus(topPickPlayer, c);
  return [];
}

// 「見出し: a、b」形式の行を足す（要素が空なら足さない）
function pushJoined(reasons, label, parts, sep) {
  if (parts.length > 0) reasons.push(`${label}: ${parts.join(sep)}`);
}

// standard: 選手力（級別・全国勝率）
function standardPlayerParts(t, c) {
  const parts = [];
  if (c.grade === "A1") parts.push("最高峰A1級の実力");
  else if (c.grade === "A2") parts.push("上位A2級の安定感");
  else if (c.grade === "B1") parts.push("B1級");

  if (c.winRate >= 7.0) parts.push(`全国勝率${t.winRate}はトップクラス`);
  else if (c.winRate >= 6.0) parts.push(`全国勝率${t.winRate}の高水準`);
  else if (c.winRate >= 5.0) parts.push(`全国勝率${t.winRate}`);
  return parts;
}

// standard: 機材力（モーター・ボート）
function standardEquipParts(t, c) {
  const parts = [];
  if (c.motor2Rate >= 45) parts.push(`モーター2連率${t.motor2Rate}%は上位機`);
  else if (c.motor2Rate >= 35)
    parts.push(`モーター2連率${t.motor2Rate}%で安定`);
  if (c.boat2Rate >= 40) parts.push(`ボート2連率${t.boat2Rate}%の好艇`);
  return parts;
}

// standard: 展開（コース・当地勝率）
function standardCourseParts(t, c) {
  const parts = [];
  if (c.number === 1) parts.push("1コースの圧倒的有利を活かせる位置");
  else if (c.number <= 3)
    parts.push(`${c.number}コースからのスタート展開に期待`);

  if (c.localWinRate >= 7.0)
    parts.push(`当地勝率${t.localWinRate}と抜群の相性`);
  else if (c.localWinRate >= 5.5)
    parts.push(`当地勝率${t.localWinRate}で水面適性あり`);
  return parts;
}

// スタンダードモデル: 選手実力・機材・コース・当地相性を総合評価
function reasonsStandard(t, c) {
  const reasons = [`【総合分析】${c.number}号艇 ${c.name}選手を本命に選定`];
  pushJoined(reasons, "選手力", standardPlayerParts(t, c), "、");
  pushJoined(reasons, "機材力", standardEquipParts(t, c), "、");
  pushJoined(reasons, "展開", standardCourseParts(t, c), "、");
  reasons.push("→ 独自の重み付けアルゴリズムにより総合スコア最高と判定");
  return reasons;
}

// safeBet: コース優位性の一行
function safeBetCourseLine(number) {
  if (number === 1) {
    return `コース: 1号艇は統計上55%以上の1着率、最も信頼できるコース`;
  }
  if (number === 2) return `コース: 2号艇から差し・まくりの展開を想定`;
  if (number === 3) return `コース: 3号艇からまくり展開の可能性を評価`;
  return `コース: ${number}号艇ながら他要素で高評価`;
}

// safeBet: 選手の安定性
function safeBetStabilityParts(t, c) {
  const parts = [];
  if (c.grade === "A1") {
    parts.push("A1級選手は安定した成績を残す傾向が強い");
    if (c.winRate >= 7.0) parts.push(`勝率${t.winRate}は信頼度◎`);
  } else if (c.grade === "A2") {
    parts.push("A2級選手として堅実なレース運び");
    if (c.winRate >= 6.0) parts.push(`勝率${t.winRate}で期待十分`);
  } else if (c.grade === "B1" && c.winRate >= 5.5) {
    parts.push(`B1級ながら勝率${t.winRate}と実力上位`);
  }
  return parts;
}

// safeBet: 機材の信頼性（該当なしなら null）
function safeBetEquipLine(t, c) {
  if (!(c.motor2Rate >= 40 || c.boat2Rate >= 40)) return null;
  const parts = [];
  if (c.motor2Rate >= 40) parts.push(`モーター${t.motor2Rate}%`);
  if (c.boat2Rate >= 40) parts.push(`ボート${t.boat2Rate}%`);
  return `機材信頼度: ${parts.join("・")}で堅実`;
}

// 本命狙いモデル: 的中率重視、1コース・A級選手・安定性を重視
function reasonsSafeBet(t, c) {
  const reasons = [`【堅実分析】${c.number}号艇 ${c.name}選手を本命に選定`];
  reasons.push(safeBetCourseLine(c.number));
  pushJoined(reasons, "安定性", safeBetStabilityParts(t, c), "、");
  const equipLine = safeBetEquipLine(t, c);
  if (equipLine) reasons.push(equipLine);
  reasons.push("→ 的中率を最大化する独自ロジックにより選出");
  return reasons;
}

// upsetFocus: コース別の逆転要素（4号艇以上はモーター、2-3号艇は当地適性）
function upsetCourseFactors(t, c) {
  const { number, motor2Rate } = c;
  if (number >= 4) {
    if (motor2Rate >= 40) {
      return [
        `${number}号艇ながらモーター2連率${t.motor2Rate}%の上位機で逆転機会あり`,
      ];
    }
    if (motor2Rate >= 33) {
      return [`${number}号艇でもモーター${t.motor2Rate}%でまくり展開を狙える`];
    }
  } else if (number >= 2 && number <= 3) {
    if (c.localWinRate > c.winRate + 0.5) {
      return [`当地勝率${t.localWinRate}が全国勝率を上回る隠れた適性`];
    }
  }
  return [];
}

// upsetFocus: 過小評価されがちな要素と、モーターの爆発力
function upsetUnderratedFactors(t, c) {
  const factors = [];
  if (c.grade === "B1" && c.winRate >= 5.5) {
    factors.push(`B1級でも勝率${t.winRate}は侮れない実力`);
  }
  if (c.grade === "B1" && c.localWinRate >= 6.5) {
    factors.push(`当地勝率${t.localWinRate}は格上選手に匹敵`);
  }
  if (c.grade === "A2" && c.number >= 3 && c.motor2Rate >= 38) {
    factors.push("A2級×好モーターの組み合わせで高配当狙い");
  }
  if (c.motor2Rate >= 45) {
    factors.push(
      `モーター2連率${t.motor2Rate}%は上位3%の好機、波乱の主役候補`,
    );
  }
  return factors;
}

// upsetFocus: 配当期待の一行（該当なしなら null）
function upsetPayoutLine(c) {
  if (c.number >= 4) {
    return `配当期待: ${c.number}号艇の1着時は高配当が見込める`;
  }
  if (c.grade === "B1") return "配当期待: B1級選手の1着は配当妙味あり";
  return null;
}

// 穴狙いモデル: 期待値・回収率重視、過小評価されている要素を発掘
function reasonsUpsetFocus(t, c) {
  const reasons = [`【穴馬分析】${c.number}号艇 ${c.name}選手を本命に選定`];
  const factors = [
    ...upsetCourseFactors(t, c),
    ...upsetUnderratedFactors(t, c),
  ];
  if (factors.length > 0) {
    reasons.push(`発掘要素: ${factors.join("。")}`);
  } else {
    reasons.push(
      "発掘要素: 独自の期待値計算により高配当時の回収効率が高いと判定",
    );
  }
  const payoutLine = upsetPayoutLine(c);
  if (payoutLine) reasons.push(payoutLine);
  reasons.push("→ 回収率最大化を目指す独自アルゴリズムにより選出");
  return reasons;
}
