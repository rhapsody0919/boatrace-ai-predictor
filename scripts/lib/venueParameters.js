/**
 * 会場別パラメータ
 * DB実測値ベースの会場別1コース1着率（全国平均: 約53%）
 */

// prettier-ignore
export const VENUE_1COURSE_WIN_RATE = {
  "01": 0.52, "02": 0.43, "03": 0.44, "04": 0.45, "05": 0.53, "06": 0.54,
  "07": 0.52, "08": 0.55, "09": 0.54, "10": 0.50, "11": 0.49, "12": 0.54,
  "13": 0.56, "14": 0.55, "15": 0.56, "16": 0.52, "17": 0.54, "18": 0.59,
  "19": 0.55, "20": 0.53, "21": 0.57, "22": 0.51, "23": 0.54, "24": 0.62,
};

export const VENUE_1COURSE_AVG = 0.53;

/**
 * 会場別イン崩れ指数 high 閾値（動的計算）
 * 根拠：1コース勝率の差分ベースで調整
 * 公式：threshold = 60 + (全国平均 - 会場勝率) × 40
 *
 * 分析：verify-threshold-logic.js (2026-05-09)
 * 相関係数: +0.194（正の相関あり）
 * 平均乖離: 5.6pt
 */
export function getVolatilityThreshold(venueCode) {
  const rate = VENUE_1COURSE_WIN_RATE[venueCode];
  if (!rate) return VENUE_VOLATILITY_THRESHOLD_DEFAULT;

  const baseThr = 60;
  const weight = 40;
  const calculated = baseThr + (VENUE_1COURSE_AVG - rate) * weight;

  // 合理的な範囲に制限（45-75）
  return Math.round(Math.max(45, Math.min(75, calculated)));
}

// 旧仕様: 参照用（レガシーコード対応）
// prettier-ignore
export const VENUE_VOLATILITY_THRESHOLD = {
  "01": 60,  // 桐生
  "02": 55,  // 戸田
  "03": 70,  // 江戸川
  "04": 70,  // 平和島
  "05": 75,  // 多摩川
  "06": 50,  // 浜名湖
  "07": 60,  // 蒲郡
  "08": 60,  // 常滑
  "09": 45,  // 津
  "10": 60,  // 三国
  "11": 65,  // びわこ
  "12": 70,  // 住之江
  "13": 55,  // 尼崎
  "14": 55,  // 鳴門
  "15": 60,  // 丸亀
  "16": 55,  // 児島
  "17": 65,  // 宮島
  "18": 60,  // 徳山
  "19": 60,  // 下関
  "20": 50,  // 若松
  "21": 60,  // 芦屋
  "22": 65,  // 福岡
  "23": 50,  // 唐津
  "24": 65,  // 大村
};

export const VENUE_VOLATILITY_THRESHOLD_DEFAULT = 65;

/**
 * 会場別 展開予測グループ分類（Phase2, ADR0011）
 * 根拠：docs/design/turn-prediction-improvement-roadmap.md の1コース勝率ベース分類は
 * 実際の展開予測的中率（data/analysis/turn-prediction-venue-analysis.json、
 * 2026-05-17時点・1000レース分析、20会場分）と食い違う会場があったため、
 * 的中率データを優先して再分類した（2026-08-12）。
 * 的中率データが無い4会場（津・住之江・丸亀・唐津）はVENUE_1COURSE_WIN_RATEの
 * 閾値（55%+=stable、45-55%=volatile、45%未満=extreme）でフォールバック分類。
 *
 * stable   (的中率79%+):  芦屋79.2 大村81.3 浜名湖81.7 徳山83.3 下関95.5 + 丸亀(フォールバック)
 * volatile (的中率65-79%): 児島70.0 三国70.8 宮島70.8 江戸川72.2 尼崎72.9 多摩川75.0
 *                          蒲郡75.0 びわこ75.0 若松75.0 福岡75.0 + 津/住之江/唐津(フォールバック)
 * extreme  (的中率65%未満): 桐生56.3 平和島56.7 鳴門60.4 戸田61.1 常滑61.9
 */
// prettier-ignore
export const VENUE_TYPE = {
  "18": "stable", "19": "stable", "06": "stable", "21": "stable", "24": "stable", "15": "stable",
  "16": "volatile", "10": "volatile", "17": "volatile", "03": "volatile", "13": "volatile",
  "05": "volatile", "07": "volatile", "11": "volatile", "20": "volatile", "22": "volatile",
  "09": "volatile", "12": "volatile", "23": "volatile",
  "01": "extreme", "04": "extreme", "14": "extreme", "02": "extreme", "08": "extreme",
};

export function getVenueType(venueCode) {
  return VENUE_TYPE[venueCode] || "volatile";
}
