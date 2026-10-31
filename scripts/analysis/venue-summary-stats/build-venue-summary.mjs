/**
 * 会場ページ（/venue/N）の常設の要約と「この会場の特徴」カードに出す数字を、
 * count-venue-techniques.mjs の出力（data/analysis/venue-summary-stats/venue-techniques.json）から作る（BOA-1189 GS02-b）。
 *
 * 出力は src/data/venueSummaryStats.js（JS の定数）。JSON にしないのは、同じ値を Vite（人の画面）・Node（verify）・
 * Vercel 関数（ボット向け HTML、api/_lib/botPage.js）の3つから import するため（src/constants/inCautionConfig.js と同じ理由）。
 *
 * - 期間は12か月の窓だけ（docs/reference/venue-summary-stats.md「言える範囲」）
 * - 割合は件数÷母数を1回だけ丸める（小数1桁の %。docs/knowledge/number-wording.md）
 * - 全国との比較は、その会場を除く全国との z が Bonferroni（24会場）の |z|>3.08 を超えたときだけ向きを入れる。
 *   対象は1コース1着率・まくり・まくり差し（読み物で「全国との比較」まで言ってよい数字）
 *
 * 使い方（月1回。手順は docs/reference/venue-summary-stats.md「画面の数字の更新」）:
 *   node --env-file=.env.local scripts/analysis/venue-summary-stats/count-venue-techniques.mjs --to=YYYY-MM-DD
 *   node scripts/analysis/venue-summary-stats/build-venue-summary.mjs
 * 検証: scripts/maintenance/verify-venue-summary.js（生成物がこの関数の出力と一致するか）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SOURCE_PATH = "data/analysis/venue-summary-stats/venue-techniques.json";
export const OUTPUT_PATH = "src/data/venueSummaryStats.js";

/** Bonferroni（24会場）の閾値。count-venue-techniques.mjs の definition.vs_national と同じ */
export const BONFERRONI_Z = 3.08;

const TECHNIQUES = [
  ["逃げ", "nige"],
  ["差し", "sashi"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
  ["抜き", "nuki"],
  ["恵まれ", "megumare"],
];
// 全国との向きを入れてよい数字（読み物「言える範囲」で「全国との比較」まであるもの）
const COMPARED = [
  ["course1", "course1"],
  ["まくり", "makuri"],
  ["まくり差し", "makurizashi"],
];

const pct = (count, total) => Math.round((count / total) * 1000) / 10;

function block(entry) {
  const courseTotal = entry.races_with_winner_course;
  return {
    races: entry.races,
    courseRaces: courseTotal,
    courses: entry.by_course.map((c) => ({
      course: c.course,
      wins: c.wins,
      rate: pct(c.wins, courseTotal),
    })),
    techniques: Object.fromEntries(
      TECHNIQUES.map(([ja, slug]) => {
        const count = entry.techniques[ja]?.count ?? 0;
        return [slug, { count, rate: pct(count, entry.races) }];
      }),
    ),
  };
}

/** venue-techniques.json の中身 → 画面用の値 */
export function buildVenueSummaryStats(source) {
  const w = source.windows_detail?.["12m"];
  if (!w?.all || !w?.venues) throw new Error("12か月の窓（windows_detail.12m）が無い");
  const venues = {};
  for (let code = 1; code <= 24; code += 1) {
    const entry = w.venues[String(code).padStart(2, "0")];
    if (!entry) throw new Error(`会場 ${code} の12か月の値が無い`);
    const vsNational = {};
    for (const [key, slug] of COMPARED) {
      const row = source.venue_difference[key].vs_national.find((r) => r.venue === entry.name);
      if (!row) throw new Error(`会場 ${entry.name} の ${key} の全国との比較が無い`);
      vsNational[slug] = Math.abs(row.z) > BONFERRONI_Z ? (row.z > 0 ? "higher" : "lower") : null;
    }
    venues[code] = { ...block(entry), vsNational };
  }
  return {
    from: w.from,
    to: w.to,
    sourceSha256: source.content_sha256,
    national: block(w.all),
    venues,
  };
}

export function renderModule(stats) {
  return `/**
 * 会場ページ（/venue/N）の常設の要約と「この会場の特徴」カードの数字（BOA-1189 GS02-b）。
 * 生成物。手で直さない。scripts/analysis/venue-summary-stats/build-venue-summary.mjs が
 * ${SOURCE_PATH}（sha256 ${stats.sourceSha256}）から作る。
 * 定義・言える範囲: docs/reference/venue-summary-stats.md。検証: scripts/maintenance/verify-venue-summary.js
 *
 * - courses: 進入コース別の1着率（枠番ではない）。rate は wins ÷ courseRaces の %（小数1桁、1回だけ丸める）
 * - techniques: 全レースのうちの決まり手の割合。rate は count ÷ races の %
 * - vsNational: その会場を除く全国との差が Bonferroni（24会場、|z|>3.08）を超えたときだけ "higher" / "lower"、それ以外は null
 */
export const VENUE_SUMMARY_STATS = ${JSON.stringify(stats, null, 2)};
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, SOURCE_PATH), "utf8"));
  const stats = buildVenueSummaryStats(source);
  fs.writeFileSync(path.join(ROOT, OUTPUT_PATH), renderModule(stats));
  console.log(`${OUTPUT_PATH} を書いた（${stats.from}〜${stats.to}、全国 ${stats.national.races} レース）`);
}
