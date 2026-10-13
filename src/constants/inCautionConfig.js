/**
 * BOA-822 イン崩れ注意度の定義（閾値・帯・期間・定義の版）。JS の正はこのファイル。
 *
 * Python（scripts/ml/analogy/in_caution_bands.py）は同じ値を src/data/inCautionConfig.json から読む。
 * 2つが同じ値かは scripts/maintenance/verify-in-caution.js（CI）が検査する。値を変えるときは両方を直し、
 * 閾値・帯・期間を変えたら def を上げる（/accuracy の公開後の実績は同じ def の行だけを数える）。
 *
 * JSON を JS から import しない理由（plan §1・design-reviewer 指摘10）: `import … with { type: "json" }` は
 * Node 20.10+・22 と Vite では動くが、この repo の src に Node・Vite・Vercel 関数の3つから JSON を import する
 * 前例が無く、Vercel 関数のバンドルで動くかを本番と同じ形で確かめる手段が無い。生成（races-init）は Vercel 関数で
 * 動くので、どこからでも読める JS の定数を正にした。
 *
 * - thresholds: 段の境目（pct < 35 → low、pct < 55 → mid、それ以外 → high）
 * - bandWidthCents・bandMin・bandMax: 帯 = clamp(floor(勝率差の 1/100 の整数 / 50), -8, 6)。-8 は「−3.5未満」、6 は「+3.0以上」
 * - from: 率を数える期間の始まり（2019-04-01〜前日）
 * - minTotalN: 表が欠けていないとみなす合計の件数の下限。2019-04-01〜2026-10-10 の完全レースは 410,994
 *   （design-reviewer が races.pkl から出した年ごとの件数の合計。勝率差が出せないレースを除くと少し減る）。
 *   直近14日だけの表（約1万）や full の途中の表で、もっともらしいが違う率を書かないための下限なので、
 *   約97%の 400,000 にした（以後は日に約150件ずつ増えるので、下限に近づくことは無い）
 * - minCellN・lowSampleN: (ラウンド, 帯) の件数が 100 未満なら出さない、100〜299 なら「件数少なめ」（2026-10-13 ユーザー決定）
 * - prelaunch: /accuracy の「公開前の検証」の期間（ユーザー承認）
 * - launchDate: 公開の PR で入れる（それまで null）
 */
export const IN_CAUTION_CONFIG = Object.freeze({
  def: "gapband-r-v1",
  thresholds: Object.freeze([35, 55]),
  bandWidthCents: 50,
  bandMin: -8,
  bandMax: 6,
  from: "2019-04-01",
  minTotalN: 400000,
  minCellN: 100,
  lowSampleN: 300,
  prelaunch: Object.freeze({ from: "2025-06-01", to: "2026-10-10" }),
  launchDate: null,
});
