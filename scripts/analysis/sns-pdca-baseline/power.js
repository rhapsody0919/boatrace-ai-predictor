/**
 * SNS PDCA ループの必要件数: ga4-sns-inflow.js と youtube-shorts-metrics.js の結果から、
 * 主な指標が +20% / +50% / +100% 上がったことを見分けるのに版ごとに要る件数（検出力0.8・両側α=0.05）を出す。
 *
 * 使い方:
 *   node scripts/analysis/sns-pdca-baseline/power.js \
 *     --ga4=data/analysis/sns-pdca-baseline/ga4-2026-08-15_2026-10-11.json \
 *     --youtube=data/analysis/sns-pdca-baseline/youtube-2026-08-01_2026-10-11.json [--sonar-per-day=0.25]
 * 結果は data/analysis/sns-pdca-baseline/power-{今日}.json。
 * 日替わりで版を交互に出すなら、合計の日数は版ごとの件数の2倍になる。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  nForRate,
  nForLogLift,
  nForMeanDiff,
  nForProportion,
  round,
} from "./stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;
const ga4 = JSON.parse(fs.readFileSync(arg("ga4"), "utf8"));
const yt = JSON.parse(fs.readFileSync(arg("youtube"), "utf8"));
// ソナーの計測は 2026-10-08 から。SNS 由来は4日で1人しかなく、仮置き値を引数で渡す
const SONAR_PER_DAY = Number(arg("sonar-per-day") ?? 0.25);
const LIFTS = [1.2, 1.5, 2.0];

const x = ga4.periods.posting.x;
const phi = round(x.sd ** 2 / x.mean); // 過分散（分散÷平均）
const er = yt.engagedRatio30plus;
const avp = yt.averageViewPercentage30plus;
const feed = yt.feedRate100In2Days;

const byLift = (f) =>
  Object.fromEntries(
    LIFTS.map((l) => [`+${Math.round((l - 1) * 100)}%`, f(l)]),
  );
const result = {
  generatedAt: new Date().toISOString(),
  inputs: {
    ga4: arg("ga4"),
    youtube: arg("youtube"),
    sonarPerDay: SONAR_PER_DAY,
  },
  baseline: {
    xUsersPerDayPosting: x.mean,
    xSd: x.sd,
    overdispersion: phi,
    engagedRatio: er.mean,
    engagedRatioSd: er.sd,
    averageViewPercentage: avp.mean,
    averageViewPercentageSd: avp.sd,
    feedRate: feed,
    ratedShareOfUploads: yt.ratedShareOfUploads,
    viewsLogSd: yt.distribution.views.logSd,
    engagedViewsLogSd: yt.distribution.engagedViews.logSd,
  },
  perArm: {
    xUsersDays: byLift((l) => nForRate(x.mean, l, phi)),
    xUsersWeeks: byLift((l) => nForRate(x.mean * 7, l, phi)),
    // ソナーの日別のばらつきはまだ測れない（4日で1人）ので過分散を置かず、ポアソンのまま（下限の見積もり）
    snsSonarUsersDays: byLift((l) => nForRate(SONAR_PER_DAY, l)),
    youtubeViewsVideos: byLift((l) =>
      nForLogLift(yt.distribution.views.logSd, l),
    ),
    youtubeEngagedViewsVideos: byLift((l) =>
      nForLogLift(yt.distribution.engagedViews.logSd, l),
    ),
    engagedRatioVideos: byLift((l) => nForMeanDiff(er.sd, er.mean * (l - 1))),
    // 率の指標は「2日で30回以上の本数」での件数。投稿本数に換算した値も出す（÷ ratedShareOfUploads）
    engagedRatioUploads: byLift((l) => Math.ceil(nForMeanDiff(er.sd, er.mean * (l - 1)) / yt.ratedShareOfUploads)),
    averageViewPercentageUploads: { "+5pt": Math.ceil(nForMeanDiff(avp.sd, 5) / yt.ratedShareOfUploads), "+10pt": Math.ceil(nForMeanDiff(avp.sd, 10) / yt.ratedShareOfUploads) },
    averageViewPercentageVideos: {
      "+5pt": nForMeanDiff(avp.sd, 5),
      "+10pt": nForMeanDiff(avp.sd, 10),
    },
    feedRateVideos: {
      ...byLift((l) => (feed * l < 1 ? nForProportion(feed, feed * l) : null)),
      "to90%": nForProportion(feed, 0.9),
    },
  },
};

const outDir = path.join(__dirname, "../../../data/analysis/sns-pdca-baseline");
const outPath = path.join(
  outDir,
  `power-${new Date().toISOString().slice(0, 10)}.json`,
);
fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`書き出し: ${path.relative(process.cwd(), outPath)}`);
