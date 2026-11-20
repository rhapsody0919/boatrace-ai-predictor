const WIND_BIN_KEYS = [
  "head_strong",
  "head",
  "calm_cross",
  "tail",
  "tail_strong",
];
const RANKING_KEYS = ["tail_strong", "head_strong"];
const TECHNIQUES = [
  ["逃げ", "nige"],
  ["差し", "sashi"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
  ["抜き", "nuki"],
  ["恵まれ", "megumare"],
];

const REFERENCE_MIN_N = 300;

// バーの目盛り（1コース1着率 %）。全会場・会場別とも同じ尺度で描く
const SCALE_MIN = 30;
const SCALE_MAX = 75;
const toPos = (rate) =>
  Math.max(
    0,
    Math.min(100, ((rate - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100),
  );

const formatDiff = (d) =>
  d > 0 ? `+${d.toFixed(1)}` : d < 0 ? `−${Math.abs(d).toFixed(1)}` : "±0.0";
const diffTone = (d) => (d <= -0.5 ? "is-down" : d >= 0.5 ? "is-up" : "");

export {
  WIND_BIN_KEYS,
  RANKING_KEYS,
  TECHNIQUES,
  REFERENCE_MIN_N,
  toPos,
  formatDiff,
  diffTone,
};
