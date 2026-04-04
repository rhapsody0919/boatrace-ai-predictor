/**
 * Supabase データサービス
 *
 * Supabaseからデータを取得し、既存のJSON形式に変換して返す
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */

import { supabase } from './supabaseClient';

// Edge API のベースURL（本番環境では同一オリジン）
const EDGE_API_BASE = '';

/**
 * 2層キャッシュ機構（メモリ + localStorage）
 * - メモリ: 最速、セッション中のみ有効
 * - localStorage: ページリロード後も有効
 * スクレイピングは1時間に1回なので、30分間キャッシュを保持
 */
const CACHE_TTL = 30 * 60 * 1000; // 30分
const CACHE_PREFIX = 'boatai:';

const cache = {
  memory: new Map(),

  /**
   * キャッシュからデータを取得
   * 1. メモリキャッシュ（最速）
   * 2. localStorageキャッシュ（リロード後も有効）
   */
  get(key) {
    // 1. メモリから
    const memCached = this.memory.get(key);
    if (memCached && Date.now() - memCached.timestamp < CACHE_TTL) {
      const remaining = Math.round((CACHE_TTL - (Date.now() - memCached.timestamp)) / 1000);
      console.log(`[Cache HIT] Memory: ${key} (${remaining}s remaining)`);
      return memCached.data;
    }

    // 2. localStorageから
    try {
      const stored = localStorage.getItem(CACHE_PREFIX + key);
      if (stored) {
        const { data, timestamp } = JSON.parse(stored);
        if (Date.now() - timestamp < CACHE_TTL) {
          const remaining = Math.round((CACHE_TTL - (Date.now() - timestamp)) / 1000);
          console.log(`[Cache HIT] localStorage: ${key} (${remaining}s remaining)`);
          // メモリにも復元
          this.memory.set(key, { data, timestamp });
          return data;
        } else {
          // 期限切れは削除
          localStorage.removeItem(CACHE_PREFIX + key);
        }
      }
    } catch (e) {
      console.warn('[Cache] localStorage read error:', e);
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
        console.log(`[Cache SET] ${key} (memory only, ${sizeKB.toFixed(0)}KB exceeds localStorage limit)`);
        return;
      }

      localStorage.setItem(CACHE_PREFIX + key, serialized);
      console.log(`[Cache SET] ${key} (${sizeKB.toFixed(0)}KB)`);
    } catch (e) {
      // localStorage容量超過時は古いキャッシュを削除して再試行
      if (e.name === 'QuotaExceededError') {
        this._cleanupOldCache();
        try {
          localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, timestamp }));
        } catch (e2) {
          console.log(`[Cache SET] ${key} (memory only, localStorage full)`);
        }
      } else {
        console.warn('[Cache] localStorage write error:', e);
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
      console.log('[Cache CLEAR] All');
    }
  },

  /**
   * localStorage内のBoatAIキャッシュを全削除
   */
  _clearAllLocalStorage() {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
      keys.forEach(k => localStorage.removeItem(k));
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
      toDelete.forEach(e => localStorage.removeItem(e.key));
      console.log(`[Cache CLEANUP] Removed ${toDelete.length} old entries`);
    } catch (e) {}
  }
};

/**
 * キャッシュ付きデータ取得
 */
function withCache(key, fetcher) {
  const cached = cache.get(key);
  if (cached !== null) {
    return Promise.resolve(cached);
  }

  console.log(`[Cache MISS] ${key}`);
  return fetcher().then(data => {
    cache.set(key, data);
    return data;
  });
}

// キャッシュクリア（手動更新時に使用）
export function clearCache(key = null) {
  cache.clear(key);
}

/**
 * 会場コード→会場名のマッピング
 */
const VENUE_NAMES = {
  1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
  7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
  13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
  19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
};

/**
 * Edge APIレスポンスをフロント期待形式に変換
 * Edge API(RPC)とSupabase直接クエリの構造差異を吸収する
 */
function transformEdgeResponse(edgeData, date) {
  const transformedRaces = (edgeData.races || []).map(race => {
    const entries = race.entries || [];
    const predictions = race.predictions || {};

    // players配列を作成（entriesからaiScoreでソート）
    const createPlayers = (modelPred, scoreField) =>
      entries.map(e => ({
        number: e.number,
        name: e.name,
        grade: e.grade,
        age: e.age,
        winRate: String(e.winRate || ''),
        localWinRate: String(e.localWinRate || ''),
        global2Rate: e.global2Rate != null ? String(e.global2Rate) : null,
        motorNumber: e.motorNumber,
        motor2Rate: String(e.motor2Rate || ''),
        boatNumber: e.boatNumber,
        boat2Rate: String(e.boat2Rate || ''),
        aiScore: e[scoreField] || 0
      })).sort((a, b) => b.aiScore - a.aiScore);

    // turnPrediction を取得（standardの予測に含まれる）
    const stdPred = predictions.standard;
    const rawTurn = stdPred?.turnPrediction || null;
    const turnPrediction = rawTurn ? {
      ...rawTurn,
      patterns: rawTurn.patterns || [
        { technique: rawTurn.technique, winnerCourse: rawTurn.winnerCourse, probability: rawTurn.probability }
      ],
    } : null;

    const raceData = {
      raceId: race.raceId,
      venue: race.venue || VENUE_NAMES[race.venueCode] || `会場${race.venueCode}`,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime || '',
      volatility: race.volatility || null,
      turnPrediction,
      racerStats: stdPred?.racerStats || null,
      exhibitionData: race.exhibitionData?.map(ed => ({
        boat_number: ed.boatNumber,
        exhibition_time: ed.exhibitionTime,
        start_timing: ed.startTiming,
      })) || null,
    };

    // 予測データ（モデル別）
    raceData.predictions = {};
    for (const [modelId, pred] of Object.entries(predictions)) {
      if (!pred) continue;
      const scoreField = modelId === 'standard' ? 'aiScoreStandard'
        : modelId === 'safeBet' ? 'aiScoreSafeBet' : 'aiScoreUpsetFocus';
      const players = createPlayers(pred, scoreField);
      const topPickPlayer = players.find(p => p.number === pred.topPick);
      raceData.predictions[modelId] = {
        topPick: pred.topPick,
        top3: pred.top3 || [pred.topPick],
        confidence: Number(pred.confidence) || 0,
        players,
        reasoning: generateReasoning(topPickPlayer, modelId)
      };
    }

    // 結果データ
    if (race.result && race.result.rank1) {
      const r = race.result;
      const trifectaKey = [r.rank1, r.rank2, r.rank3].sort((a, b) => a - b).join('-');
      const trioKey = `${r.rank1}-${r.rank2}-${r.rank3}`;

      raceData.result = {
        finished: true,
        rank1: r.rank1,
        rank2: r.rank2,
        rank3: r.rank3,
        payouts: {
          win: r.payoutWin ? { [r.rank1]: r.payoutWin } : {},
          place: {},
          trifecta: r.payoutTrifecta ? { [trifectaKey]: r.payoutTrifecta } : {},
          trio: r.payoutTrio ? { [trioKey]: r.payoutTrio } : {}
        }
      };
      if (r.payoutPlace1) raceData.result.payouts.place[r.rank1] = r.payoutPlace1;
      if (r.payoutPlace2) raceData.result.payouts.place[r.rank2] = r.payoutPlace2;

      // 的中情報
      const stdHit = predictions.standard;
      if (stdHit) {
        raceData.accuracy = {
          standard: {
            isHitWin: stdHit.isHitWin,
            isHitPlace: stdHit.isHitPlace
          }
        };
      }
    }

    return raceData;
  });

  return {
    date,
    generatedAt: edgeData.generatedAt || new Date().toISOString(),
    updatedAt: edgeData.updatedAt || new Date().toISOString(),
    races: transformedRaces
  };
}

/**
 * 予想根拠を生成する関数
 * 各モデルの特性に基づいた詳細な分析結果を生成
 */
function generateReasoning(topPickPlayer, modelType) {
  if (!topPickPlayer) return ['予想データなし'];

  const reasons = [];
  const number = topPickPlayer.number;
  const name = topPickPlayer.name;
  const grade = topPickPlayer.grade || '';
  const winRate = parseFloat(topPickPlayer.winRate) || 0;
  const localWinRate = parseFloat(topPickPlayer.localWinRate) || 0;
  const motor2Rate = parseFloat(topPickPlayer.motor2Rate) || 0;
  const boat2Rate = parseFloat(topPickPlayer.boat2Rate) || 0;

  if (modelType === 'standard') {
    // スタンダードモデル: 選手実力・機材・コース・当地相性を総合評価
    reasons.push(`【総合分析】${number}号艇 ${name}選手を本命に選定`);

    // 選手評価
    const playerAnalysis = [];
    if (grade === 'A1') playerAnalysis.push('最高峰A1級の実力');
    else if (grade === 'A2') playerAnalysis.push('上位A2級の安定感');
    else if (grade === 'B1') playerAnalysis.push('B1級');

    if (winRate >= 7.0) playerAnalysis.push(`全国勝率${topPickPlayer.winRate}はトップクラス`);
    else if (winRate >= 6.0) playerAnalysis.push(`全国勝率${topPickPlayer.winRate}の高水準`);
    else if (winRate >= 5.0) playerAnalysis.push(`全国勝率${topPickPlayer.winRate}`);

    if (playerAnalysis.length > 0) {
      reasons.push(`選手力: ${playerAnalysis.join('、')}`);
    }

    // 機材評価
    const equipAnalysis = [];
    if (motor2Rate >= 45) equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%は上位機`);
    else if (motor2Rate >= 35) equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%で安定`);
    if (boat2Rate >= 40) equipAnalysis.push(`ボート2連率${topPickPlayer.boat2Rate}%の好艇`);

    if (equipAnalysis.length > 0) {
      reasons.push(`機材力: ${equipAnalysis.join('、')}`);
    }

    // 当地・コース評価
    const courseAnalysis = [];
    if (number === 1) courseAnalysis.push('1コースの圧倒的有利を活かせる位置');
    else if (number <= 3) courseAnalysis.push(`${number}コースからのスタート展開に期待`);

    if (localWinRate >= 7.0) courseAnalysis.push(`当地勝率${topPickPlayer.localWinRate}と抜群の相性`);
    else if (localWinRate >= 5.5) courseAnalysis.push(`当地勝率${topPickPlayer.localWinRate}で水面適性あり`);

    if (courseAnalysis.length > 0) {
      reasons.push(`展開: ${courseAnalysis.join('、')}`);
    }

    reasons.push('→ 独自の重み付けアルゴリズムにより総合スコア最高と判定');

  } else if (modelType === 'safeBet') {
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
    if (grade === 'A1') {
      stabilityAnalysis.push('A1級選手は安定した成績を残す傾向が強い');
      if (winRate >= 7.0) stabilityAnalysis.push(`勝率${topPickPlayer.winRate}は信頼度◎`);
    } else if (grade === 'A2') {
      stabilityAnalysis.push('A2級選手として堅実なレース運び');
      if (winRate >= 6.0) stabilityAnalysis.push(`勝率${topPickPlayer.winRate}で期待十分`);
    } else if (grade === 'B1' && winRate >= 5.5) {
      stabilityAnalysis.push(`B1級ながら勝率${topPickPlayer.winRate}と実力上位`);
    }

    if (stabilityAnalysis.length > 0) {
      reasons.push(`安定性: ${stabilityAnalysis.join('、')}`);
    }

    // 機材の信頼性
    if (motor2Rate >= 40 || boat2Rate >= 40) {
      const equipParts = [];
      if (motor2Rate >= 40) equipParts.push(`モーター${topPickPlayer.motor2Rate}%`);
      if (boat2Rate >= 40) equipParts.push(`ボート${topPickPlayer.boat2Rate}%`);
      reasons.push(`機材信頼度: ${equipParts.join('・')}で堅実`);
    }

    reasons.push('→ 的中率を最大化する独自ロジックにより選出');

  } else if (modelType === 'upsetFocus') {
    // 穴狙いモデル: 期待値・回収率重視、過小評価されている要素を発掘
    reasons.push(`【穴馬分析】${number}号艇 ${name}選手を本命に選定`);

    // 穴要素の分析
    const upsetFactors = [];

    // アウトコースからの逆転要素
    if (number >= 4) {
      if (motor2Rate >= 40) {
        upsetFactors.push(`${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の上位機で逆転機会あり`);
      } else if (motor2Rate >= 33) {
        upsetFactors.push(`${number}号艇でもモーター${topPickPlayer.motor2Rate}%でまくり展開を狙える`);
      }
    } else if (number >= 2 && number <= 3) {
      if (localWinRate > winRate + 0.5) {
        upsetFactors.push(`当地勝率${topPickPlayer.localWinRate}が全国勝率を上回る隠れた適性`);
      }
    }

    // 過小評価されがちな要素
    if (grade === 'B1' && winRate >= 5.5) {
      upsetFactors.push(`B1級でも勝率${topPickPlayer.winRate}は侮れない実力`);
    }
    if (grade === 'B1' && localWinRate >= 6.5) {
      upsetFactors.push(`当地勝率${topPickPlayer.localWinRate}は格上選手に匹敵`);
    }
    if (grade === 'A2' && number >= 3 && motor2Rate >= 38) {
      upsetFactors.push('A2級×好モーターの組み合わせで高配当狙い');
    }

    // ボート・モーターの爆発力
    if (motor2Rate >= 45) {
      upsetFactors.push(`モーター2連率${topPickPlayer.motor2Rate}%は上位3%の好機、波乱の主役候補`);
    }

    if (upsetFactors.length > 0) {
      reasons.push(`発掘要素: ${upsetFactors.join('。')}`);
    } else {
      reasons.push('発掘要素: 独自の期待値計算により高配当時の回収効率が高いと判定');
    }

    // 期待値の説明
    if (number >= 4) {
      reasons.push(`配当期待: ${number}号艇の1着時は高配当が見込める`);
    } else if (grade === 'B1') {
      reasons.push('配当期待: B1級選手の1着は配当妙味あり');
    }

    reasons.push('→ 回収率最大化を目指す独自アルゴリズムにより選出');
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
    const today = jstNow.toISOString().split('T')[0];

    return withCache(`races-${today}`, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/races/today`);
        if (edgeResponse.ok) {
          const data = await edgeResponse.json();
          if (data.success && data.data) {
            console.log('[getRaces] Edge API success');
            // Edge APIのレスポンスを既存形式に変換
            return {
              success: true,
              data: data.data.map(venue => ({
                placeCd: venue.place_cd || venue.placeCd,
                placeName: venue.place_name || venue.placeName || VENUE_NAMES[venue.place_cd || venue.placeCd],
                races: venue.races
              })),
              scrapedAt: data.scrapedAt || new Date().toISOString()
            };
          }
        }
      } catch (edgeError) {
        console.log('[getRaces] Edge API failed, falling back to direct query:', edgeError.message);
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error('Supabase client not initialized');
        return { success: false, data: [], scrapedAt: null };
      }

    // 今日のレースを取得
    const { data: races, error: racesError } = await supabase
      .from('races')
      .select(`
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
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
      `)
      .eq('race_date', today)
      .order('venue_code')
      .order('race_number');

    if (racesError) {
      console.error('Supabase getRaces error:', racesError.message);
      return { success: false, data: [], scrapedAt: null };
    }

    // 会場ごとにグループ化
    const venueMap = new Map();

    for (const race of races) {
      const venueCode = race.venue_code;

      if (!venueMap.has(venueCode)) {
        venueMap.set(venueCode, {
          placeCd: venueCode,
          placeName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
          races: []
        });
      }

      // レースデータを変換
      const raceData = {
        raceNo: race.race_number,
        startTime: race.start_time?.substring(0, 5) || '',
        date: race.race_date,
        placeCd: race.venue_code,
        racers: (race.race_entries || []).map(entry => ({
          waku: entry.boat_number,
          name: entry.player_name,
          rank: entry.grade,
          age: entry.age,
          winRate: entry.win_rate,
          localWinRate: entry.local_win_rate,
          motorNo: entry.motor_number,
          motor2Rate: entry.motor_2rate,
          boatNo: entry.boat_number_id,
          boat2Rate: entry.boat_2rate
        }))
      };

      venueMap.get(venueCode).races.push(raceData);
    }

      return {
        success: true,
        data: Array.from(venueMap.values()),
        scrapedAt: new Date().toISOString()
      };
    }); // withCache end
  },

  /**
   * 予測データを取得（predictions/YYYY-MM-DD.json形式で返す）
   * Phase 2: Edge API経由でCDNキャッシュを活用
   */
  async getPredictions(date, { light = false } = {}) {
    const cacheKey = light ? `predictions-light-${date}` : `predictions-${date}`;
    return withCache(cacheKey, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      const lightParam = light ? '?light=true' : '';
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/predictions/${date}${lightParam}`);
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.races && edgeData.races.length > 0) {
            console.log(`[getPredictions] Edge API success: ${edgeData.races.length} races${light ? ' (light)' : ''}`);
            return transformEdgeResponse(edgeData, date);
          }
        }
      } catch (edgeError) {
        console.log('[getPredictions] Edge API failed, falling back to direct query:', edgeError.message);
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error('Supabase client not initialized');
        return { date, generatedAt: null, updatedAt: null, races: [] };
      }

    // レースと予測と結果を取得
    const { data: races, error: racesError } = await supabase
      .from('races')
      .select(`
        race_id,
        race_date,
        venue_code,
        race_number,
        start_time,
        volatility_score,
        volatility_level,
        recommended_model,
        volatility_reasons,
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
          payout_win,
          payout_place_1,
          payout_place_2,
          payout_trifecta,
          payout_trio
        ),
        exhibition_data (
          boat_number,
          exhibition_time,
          start_timing
        )
      `)
      .eq('race_date', date)
      .order('venue_code')
      .order('race_number');

    if (racesError) {
      console.error('Supabase getPredictions error:', racesError.message);
      return { date, generatedAt: null, updatedAt: null, races: [] };
    }

    // JSON形式に変換
    const transformedRaces = races.map(race => {
      const entries = race.race_entries || [];
      const predictions = race.predictions || [];
      const result = race.race_results?.[0] || race.race_results;

      // 予測データをモデル別に整理
      const standardPred = predictions.find(p => p.model_id === 'standard');
      const safeBetPred = predictions.find(p => p.model_id === 'safeBet');
      const upsetPred = predictions.find(p => p.model_id === 'upsetFocus');

      // turnPredictionを取得（standardのfeature_contributionsに格納）
      const rawTurn = standardPred?.feature_contributions?.turnPrediction || null;
      const turnPrediction = rawTurn ? {
        ...rawTurn,
        patterns: rawTurn.patterns || [
          { technique: rawTurn.technique, winnerCourse: rawTurn.winnerCourse, probability: rawTurn.probability }
        ],
      } : null;

      // players配列を作成（aiScoreで降順ソート）
      const createPlayers = (pred, scoreField) => entries.map(e => ({
        number: e.boat_number,
        name: e.player_name,
        grade: e.grade,
        age: e.age,
        winRate: String(e.win_rate || ''),
        localWinRate: String(e.local_win_rate || ''),
        global2Rate: e.global_2rate != null ? String(e.global_2rate) : null,
        motorNumber: e.motor_number,
        motor2Rate: String(e.motor_2rate || ''),
        boatNumber: e.boat_number_id,
        boat2Rate: String(e.boat_2rate || ''),
        aiScore: e[scoreField] || 0
      })).sort((a, b) => b.aiScore - a.aiScore);

      const raceData = {
        raceId: race.race_id,
        venue: VENUE_NAMES[race.venue_code] || `会場${race.venue_code}`,
        venueCode: race.venue_code,
        raceNumber: race.race_number,
        startTime: race.start_time?.substring(0, 5) || '',
        volatility: race.volatility_score ? {
          score: race.volatility_score,
          level: race.volatility_level,
          recommendedModel: race.recommended_model,
          reasons: race.volatility_reasons || []
        } : null,
        turnPrediction: turnPrediction,
        racerStats: standardPred?.feature_contributions?.racerStats || null,
        exhibitionData: race.exhibition_data || null,
      };

      // 予測データ（新形式: predictions）
      if (standardPred || safeBetPred || upsetPred) {
        raceData.predictions = {};

        if (standardPred) {
          const players = createPlayers(standardPred, 'ai_score_standard');
          const topPickPlayer = players.find(p => p.number === standardPred.top_pick);
          raceData.predictions.standard = {
            topPick: standardPred.top_pick,
            top3: [standardPred.top_pick, standardPred.top_2nd, standardPred.top_3rd].filter(Boolean),
            confidence: Number(standardPred.confidence) || 0,
            players,
            reasoning: generateReasoning(topPickPlayer, 'standard')
          };
        }

        if (safeBetPred) {
          const players = createPlayers(safeBetPred, 'ai_score_safe_bet');
          const topPickPlayer = players.find(p => p.number === safeBetPred.top_pick);
          raceData.predictions.safeBet = {
            topPick: safeBetPred.top_pick,
            top3: [safeBetPred.top_pick, safeBetPred.top_2nd, safeBetPred.top_3rd].filter(Boolean),
            confidence: Number(safeBetPred.confidence) || 0,
            players,
            reasoning: generateReasoning(topPickPlayer, 'safeBet')
          };
        }

        if (upsetPred) {
          const players = createPlayers(upsetPred, 'ai_score_upset_focus');
          const topPickPlayer = players.find(p => p.number === upsetPred.top_pick);
          raceData.predictions.upsetFocus = {
            topPick: upsetPred.top_pick,
            top3: [upsetPred.top_pick, upsetPred.top_2nd, upsetPred.top_3rd].filter(Boolean),
            confidence: Number(upsetPred.confidence) || 0,
            players,
            reasoning: generateReasoning(topPickPlayer, 'upsetFocus')
          };
        }
      }

      // 結果データ
      if (result && result.rank1) {
        // 3連複用のソート済みキー（順不同なのでソートが必要）
        const trifectaKey = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b).join('-');
        // 3連単用のキー（順序が重要なのでソートしない）
        const trioKey = `${result.rank1}-${result.rank2}-${result.rank3}`;

        raceData.result = {
          finished: true,
          rank1: result.rank1,
          rank2: result.rank2,
          rank3: result.rank3,
          payouts: {
            win: result.payout_win ? { [result.rank1]: result.payout_win } : {},
            place: {},
            trifecta: result.payout_trifecta ? { [trifectaKey]: result.payout_trifecta } : {},
            trio: result.payout_trio ? { [trioKey]: result.payout_trio } : {}
          }
        };

        if (result.payout_place_1) {
          raceData.result.payouts.place[result.rank1] = result.payout_place_1;
        }
        if (result.payout_place_2) {
          raceData.result.payouts.place[result.rank2] = result.payout_place_2;
        }

        // 的中情報
        if (standardPred) {
          raceData.accuracy = {
            standard: {
              isHitWin: standardPred.is_hit_win,
              isHitPlace: standardPred.is_hit_place
            }
          };
        }
      }

      return raceData;
    });

      return {
        date: date,
        generatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        races: transformedRaces
      };
    }); // withCache end
  },

  /**
   * 精度統計データを取得（summary.json形式で返す）
   */
  async getAccuracy() {
    return withCache('accuracy', async () => {
      // Phase D: まずEdge APIを試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/accuracy`);
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.models) {
            console.log('[getAccuracy] Edge API success');
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log('[getAccuracy] Edge API failed, falling back to direct query:', edgeError.message);
      }

      // フォールバック: 従来のSupabase直接クエリ
      if (!supabase) {
        console.error('Supabase client not initialized');
        return { lastUpdated: null, models: {} };
      }

    // 今月の日付範囲を計算
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const thisYear = jstNow.getUTCFullYear();
    const thisMonth = jstNow.getUTCMonth() + 1;
    const thisMonthStart = `${thisYear}-${String(thisMonth).padStart(2, '0')}-01`;
    const thisMonthEnd = `${thisYear}-${String(thisMonth).padStart(2, '0')}-31`;

    // 過去30日の開始日を計算
    const thirtyDaysAgo = new Date(jstNow.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // モデル情報を取得
    const { data: models, error: modelsError } = await supabase
      .from('models')
      .select('model_id, display_name, total_predictions, hit_rate_win, hit_rate_place, hit_rate_trifecta, hit_rate_trio, recovery_rate_win, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio');

    if (modelsError) {
      console.error('Supabase getAccuracy error:', modelsError.message);
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
          .from('predictions')
          .select('race_id, model_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio')
          .gte('race_id', startDate)
          .not('is_hit_win', 'is', null)
          .range(from, from + pageSize - 1);

        if (adjustedEndDate) {
          query = query.lte('race_id', adjustedEndDate);
        }

        const { data: page, error } = await query;

        if (error || !page || page.length === 0) break;
        allData = allData.concat(page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      return allData;
    };

    // 今月の予測データを取得（is_hit_winがセットされているもの = 結果が出ているもの）
    const thisMonthPredictions = await fetchAllPredictions(thisMonthStart, thisMonthEnd);

    // 過去6ヶ月分の月別データを取得するためのヘルパー
    const getMonthRange = (year, month) => {
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const end = `${year}-${String(month).padStart(2, '0')}-31`;
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

    // 各月の予測データを取得
    const monthlyPredictionsMap = {};
    for (const monthInfo of monthsToFetch) {
      const predictions = await fetchAllPredictions(monthInfo.start, monthInfo.end);
      const key = `${monthInfo.year}-${String(monthInfo.month).padStart(2, '0')}`;
      monthlyPredictionsMap[key] = {
        predictions,
        year: monthInfo.year,
        month: monthInfo.month
      };
    }

    // 先月のデータ（互換性のため）
    const lastMonthKey = `${monthsToFetch[0].year}-${String(monthsToFetch[0].month).padStart(2, '0')}`;
    const lastMonthPredictions = monthlyPredictionsMap[lastMonthKey]?.predictions || [];

    // 過去7日分の日別データ取得
    const sevenDaysAgo = new Date(jstNow.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const recentPredictions = await fetchAllPredictions(sevenDaysAgoStr, null);

    // 全期間のデータを取得（会場別統計用）- 過去90日分
    const ninetyDaysAgo = new Date(jstNow.getTime() - 90 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];
    const allPredictions = await fetchAllPredictions(ninetyDaysAgoStr, null);

    // race_idから日付を抽出するヘルパー関数
    const extractDate = (raceId) => raceId.substring(0, 10);

    // race_idから会場コードを抽出するヘルパー関数 (YYYY-MM-DD-VV-RR形式)
    const extractVenueCode = (raceId) => parseInt(raceId.substring(11, 13), 10);

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
            trio: { recoveryRate: 0 }
          }
        };
      }

      const total = predictions.length;
      const winHits = predictions.filter(p => p.is_hit_win).length;
      const placeHits = predictions.filter(p => p.is_hit_place).length;
      const trifectaHits = predictions.filter(p => p.is_hit_trifecta).length;
      const trioHits = predictions.filter(p => p.is_hit_trio).length;

      const winPayout = predictions.reduce((sum, p) => sum + (p.payout_win || 0), 0);
      const placePayout = predictions.reduce((sum, p) => sum + (p.payout_place || 0), 0);
      const trifectaPayout = predictions.reduce((sum, p) => sum + (p.payout_trifecta || 0), 0);
      const trioPayout = predictions.reduce((sum, p) => sum + (p.payout_trio || 0), 0);

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
          trio: { recoveryRate: trioPayout / (total * 100) }
        }
      };
    };

    // 日別履歴を計算する関数
    const calculateDailyHistory = (predictions, modelId) => {
      const modelPreds = predictions?.filter(p => p.model_id === modelId) || [];
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
          ...calculateStats(preds)
        }));
    };

    // 会場別統計を計算する関数
    const calculateByVenue = (predictions, modelId) => {
      const modelPreds = predictions?.filter(p => p.model_id === modelId) || [];
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
          overall: calculateStats(preds)
        };
      }

      return byVenue;
    };

    // 各モデルの統計を構築
    const modelStats = {};
    const modelIds = ['standard', 'safeBet', 'upsetFocus'];

    for (const modelId of modelIds) {
      const modelInfo = models?.find(m => m.model_id === modelId);
      const thisMonthPreds = thisMonthPredictions?.filter(p => p.model_id === modelId) || [];
      const thisMonthStats = calculateStats(thisMonthPreds);
      const lastMonthPreds = lastMonthPredictions?.filter(p => p.model_id === modelId) || [];
      const lastMonthStats = calculateStats(lastMonthPreds);
      const dailyHistory = calculateDailyHistory(recentPredictions, modelId);
      const byVenue = calculateByVenue(allPredictions, modelId);

      // 月別履歴を構築（過去6ヶ月分）
      const monthlyHistory = Object.entries(monthlyPredictionsMap)
        .map(([key, data]) => {
          const monthPreds = data.predictions?.filter(p => p.model_id === modelId) || [];
          const stats = calculateStats(monthPreds);
          return {
            year: data.year,
            month: data.month,
            ...stats
          };
        })
        .filter(m => m.totalRaces > 0)
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
            trifecta: { recoveryRate: modelInfo?.recovery_rate_trifecta || 0 },
            trio: { recoveryRate: modelInfo?.recovery_rate_trio || 0 },
          }
        },
        thisMonth: {
          year: thisYear,
          month: thisMonth,
          ...thisMonthStats
        },
        lastMonth: {
          year: monthsToFetch[0].year,
          month: monthsToFetch[0].month,
          ...lastMonthStats
        },
        monthlyHistory,
        dailyHistory,
        byVenue
      };
    }

      return {
        lastUpdated: new Date().toISOString(),
        models: modelStats
      };
    }); // withCache end
  },

  /**
   * 予想データが存在する日付リストを取得
   * @param {number} days - 過去何日分を取得するか
   */
  async getAvailableDates(days = 90) {
    return withCache(`availableDates-${days}`, async () => {
      if (!supabase) {
        console.error('Supabase client not initialized');
        return [];
      }

    // 日付範囲を計算
    const today = new Date();
    const jstOffset = 9 * 60;
    const jstToday = new Date(today.getTime() + jstOffset * 60 * 1000);
    const startDate = new Date(jstToday.getTime() - days * 24 * 60 * 60 * 1000);
    const startDateStr = startDate.toISOString().split('T')[0];

    // 日付ごとのレースを取得（ページネーションで1000行制限を回避）
    const allData = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('races')
        .select('race_date')
        .gte('race_date', startDateStr)
        .order('race_date', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) {
        console.error('Supabase getAvailableDates error:', error.message);
        break;
      }
      if (!data || data.length === 0) break;

      allData.push(...data);
      offset += pageSize;

      if (data.length < pageSize) break;
    }

      // ユニークな日付を抽出
      const uniqueDates = [...new Set(allData.map(r => r.race_date))];
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
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/race-history/summary?days=${days}`);
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.days) {
            console.log('[getRaceHistorySummary] Edge API success');
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log('[getRaceHistorySummary] Edge API failed, falling back:', edgeError.message);
      }

      // フォールバック: Supabase RPC を直接呼び出し
      if (!supabase) {
        console.error('Supabase client not initialized');
        return { days: [] };
      }

      const { data, error } = await supabase.rpc('get_race_history_summary', { days_back: days });
      if (error) {
        console.error('Supabase getRaceHistorySummary error:', error.message);
        return { days: [] };
      }
      return data || { days: [] };
    });
  }
};
