/**
 * 共通定数
 * アプリケーション全体で使用する定数を一元管理
 */

// レース場名マッピング
export const STADIUM_NAMES = {
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

// モデル名マッピング
export const MODEL_NAMES = {
  unified: "AI予想",
  standard: "スタンダード",
  safeBet: "本命狙い",
  upsetFocus: "穴狙い",
  "safe-bet": "本命狙い",
  "upset-focus": "穴狙い",
};

// モデルキー配列（イテレーション用）
export const MODEL_KEYS = ["standard", "safeBet", "upsetFocus"];

// 曜日名（日本語）
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

// モデルのAPI形式からUI形式へのマッピング
export const MODEL_KEY_MAP = {
  "safe-bet": "safeBet",
  "upset-focus": "upsetFocus",
  standard: "standard",
};

// UI形式からAPI形式へのマッピング
export const MODEL_KEY_REVERSE_MAP = {
  safeBet: "safe-bet",
  upsetFocus: "upset-focus",
  standard: "standard",
};
