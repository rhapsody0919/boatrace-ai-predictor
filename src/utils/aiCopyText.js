/**
 * 「AI用にコピー」（BOA-194）の文面を組み立てる純関数（BOA-770）。
 * DB・DOM・i18next に依存しない（t と値を受け取るだけ）ので、
 * scripts/maintenance/verify-ai-copy-text.js から実際の locale で検証できる。
 *
 * 並び: 見出し → レースの前提（日付・締切・グレード／節・天候風波・データの時点・展示の有無）
 *       → 出走表 → 項目の注記 → 1マーク展開予測 → 質問文 → 出典1行
 */
import { TECHNIQUE_NAMES } from "./turnPrediction.js";
import {
  formatObservedTime,
  translateWeather,
  translateWindDirection,
} from "../components/race/weatherInfo.js";
import { getRaceStageCategory } from "../constants/raceStageConfig.js";
import { localizePath } from "../config/languages.js";

const DASH = "—";

// 一般（ippan）以外は公式の表記がそのまま各言語で通じる
const GRADE_LABELS = { SG: "SG", G1: "G1", G2: "G2", G3: "G3" };

// 注記の対象（表の行の順に並べる）。「—」の注記は常に末尾に付ける
export const AI_COPY_NOTE_KEYS = [
  "winRate",
  "motor",
  "form",
  "avgSt",
  "st",
  "exSt",
  "exhibition",
  "exhibitionCourse",
  "partsChanged",
  "courseRate",
  "technique",
  "returnRate",
];

const JST_DATE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Date を JST の「YYYY-MM-DD HH:MM」にする */
export function formatJstDateTime(date) {
  const parts = Object.fromEntries(
    JST_DATE_TIME.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// 出典の URL の基点。プレビュー環境・開発機からコピーしても本番のページを指す
// （share.js の SITE_ORIGIN と同じ。share.js は Node から読み込めないため検証できるここに置く）
const SITE_ORIGIN = "https://www.boat-ai.jp";

/** そのレース詳細ページの、表示言語の URL（例: https://www.boat-ai.jp/en/race/2026-10-05-01-05） */
export const aiCopyPageUrl = (raceId, lang) =>
  `${SITE_ORIGIN}${localizePath(`/race/${raceId}`, lang)}`;

const toLine = (cells) => `| ${cells.join(" | ")} |`;

/**
 * @param {Function} t
 * @param {Array<{number:number,name?:string}>} players 枠番順
 * @param {Array<{label:string, values:string[]}>} rows
 */
export function toMarkdownTable(t, players, rows) {
  const header = [
    t("aiCopy.tableItemHeader"),
    ...players.map((p) => t("analysis.boatN", { n: p.number })),
  ];
  return [
    toLine(header),
    toLine(header.map(() => "---")),
    ...rows.map((row) => toLine([row.label, ...row.values])),
  ].join("\n");
}

function boatLabel(t, boatNumber, playerByBoat) {
  const name = playerByBoat.get(boatNumber)?.name;
  const n = t("analysis.boatN", { n: boatNumber });
  return name ? `${n} ${name}` : n;
}

// {course: probability}形式の分布から最有力の艇番を1つ選ぶ（無ければnull）
function topCandidate(dist) {
  const entries = Object.entries(dist ?? {});
  if (entries.length === 0) return null;
  const [course, prob] = entries.reduce((best, cur) =>
    cur[1] > best[1] ? cur : best,
  );
  return { boatNumber: Number(course), probability: prob };
}

const techniqueLabel = (t, technique) =>
  t(`techniques.${technique}`, TECHNIQUE_NAMES[technique] ?? technique);

/**
 * 1マーク展開予測（決まり手×コース別の勝利確率・2着3着分布）を Markdown にする。
 * boatStrengths（総合力順位）は画面に出ておらず、表の1着候補と食い違って読めるため入れない（BOA-770 ファン評価）。
 * generate-predictions.js が日次で保存済みのデータなので、追加の取得は無い。
 * 以前は「イン崩れ狙い」のときだけ入れていたが、券種にかかわらず入れる（BOA-770 推奨6）
 */
export function buildTurnPredictionSection(t, players, turnPrediction) {
  if (!turnPrediction?.patterns?.length) return "";

  const playerByBoat = new Map(players.map((p) => [p.number, p]));
  const header = [
    t("aiCopy.turnPredictionColTechnique"),
    t("aiCopy.turnPredictionColWinner"),
    t("aiCopy.turnPredictionColProbability"),
    t("aiCopy.turnPredictionColSecond"),
    t("aiCopy.turnPredictionColThird"),
  ];
  const candidate = (c) =>
    c
      ? `${boatLabel(t, c.boatNumber, playerByBoat)}（${Math.round(c.probability * 100)}%）`
      : DASH;
  const rows = turnPrediction.patterns.map((p) =>
    toLine([
      techniqueLabel(t, p.technique),
      boatLabel(t, p.winnerCourse, playerByBoat),
      `${Math.round(p.probability * 100)}%`,
      candidate(topCandidate(p.secondPlace)),
      candidate(topCandidate(p.thirdPlace)),
    ]),
  );

  const distributionLine = Object.entries(turnPrediction.distribution ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(
      ([technique, prob]) =>
        `${techniqueLabel(t, technique)} ${Math.round(prob * 100)}%`,
    )
    .join(" / ");

  const lines = [
    `### ${t("aiCopy.turnPredictionHeading")}`,
    "",
    [toLine(header), toLine(header.map(() => "---")), ...rows].join("\n"),
  ];
  // 2着・3着の列は「その着に入る確率が最も高い艇」なので同じ艇が並ぶことがある。
  // 説明が無いと読み違えるため、表の直後に1行添える（BOA-770 ファン評価）
  lines.push("", t("aiCopy.turnPredictionCandidateNote"));
  if (distributionLine) {
    lines.push(
      "",
      `${t("aiCopy.turnPredictionDistributionLabel")}: ${distributionLine}`,
    );
  }
  return lines.join("\n");
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** 天候・風・波・気温・水温の1行。取れない項目は「未取得」と書く（公式は発表済みでも、このレースの値をまだ取得していないことがあるため「未発表」とは書かない） */
function weatherLine(t, weather, venueCode) {
  const unpublished = t("aiCopy.unpublished");
  const w = weather ?? {};
  const wind = [
    w.windDirection
      ? translateWindDirection(t, w.windDirection, venueCode)
      : null,
    isNum(w.windSpeed) ? `${w.windSpeed.toFixed(1)}m` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const items = [
    [
      t("beforeInfo.weatherLabel"),
      w.weather ? translateWeather(t, w.weather) : null,
    ],
    [t("aiCopy.premiseWind"), wind || null],
    [
      t("beforeInfo.waveHeightLabel"),
      isNum(w.waveHeight) ? `${w.waveHeight}cm` : null,
    ],
    [
      t("beforeInfo.temperatureLabel"),
      isNum(w.temperature) ? `${w.temperature.toFixed(1)}℃` : null,
    ],
    [
      t("beforeInfo.waterTemperatureLabel"),
      isNum(w.waterTemperature) ? `${w.waterTemperature.toFixed(1)}℃` : null,
    ],
  ];
  const body = items
    .map(([label, value]) => `${label} ${value ?? unpublished}`)
    .join(" / ");
  const observed = formatObservedTime(w.observedAt);
  return observed
    ? `${body}（${t("aiCopy.premiseObservedAt", { time: observed })}）`
    : body;
}

/**
 * レースの前提の行（箇条書き）
 * @param {object} context
 * @param {string} context.date "YYYY-MM-DD"
 * @param {string|null} context.startTime "HH:MM"
 * @param {string|null} context.raceGrade SG/G1/G2/G3/ippan
 * @param {string|null} context.seriesTitle 節のタイトル（公式表記）
 * @param {string|null} context.seriesDayLabel 「3日目」等（画面の見出しと同じもの）
 * @param {string|null} context.raceStage race_conditions.race_stage（公式表記）
 * @param {number|null} context.venueCode 会場コード（風向を本当の方位に直す。BOA-819）
 * @param {object|null} context.weather prediction.weather
 * @param {Date} now
 * @param {boolean|null} exhibitionPublished 展示タイム・展示STのどれかが出ているか（取得失敗で不明なら null）
 */
export function buildPremiseLines(t, context, { now, exhibitionPublished }) {
  const unpublished = t("aiCopy.unpublished");
  const grade = context.raceGrade
    ? (GRADE_LABELS[context.raceGrade] ?? t("aiCopy.gradeIppan"))
    : null;
  // 種別はページの見出しのチップと同じ出し方（分類できれば分類名、できなければ公式表記）
  const category = getRaceStageCategory(context.raceStage);
  const stage = category
    ? t(category.i18nKey)
    : (context.raceStage?.normalize("NFKC") ?? null);
  const meet = [
    grade,
    context.seriesTitle,
    context.seriesDayLabel,
    stage,
  ].filter(Boolean);

  const lines = [
    `${t("aiCopy.premiseDate")}: ${context.date || unpublished}`,
    `${t("aiCopy.premiseDeadline")}: ${context.startTime || unpublished}`,
  ];
  if (meet.length > 0)
    lines.push(`${t("aiCopy.premiseMeet")}: ${meet.join(" / ")}`);
  lines.push(
    `${t("aiCopy.premiseConditions")}: ${weatherLine(t, context.weather, context.venueCode)}`,
  );
  lines.push(
    `${t("aiCopy.premiseAsOf")}: ${t("aiCopy.premiseAsOfValue", { time: formatJstDateTime(now) })}`,
  );
  // null（取得失敗で分からない）のときは書かない
  if (exhibitionPublished === false)
    lines.push(t("aiCopy.premiseExhibitionUnpublished"));
  return lines.map((line) => `- ${line}`);
}

/**
 * 項目の注記（1項目1行）。表に無い行の注記は出さない。
 * 行名は表の行と同じ文字列を使う（注記を行名で引けるように。訳語のずれを作らない）
 * @param {Array<{key:string,label:string}>} rows
 */
export function buildNotes(t, rows) {
  const labelByKey = new Map(rows.map((r) => [r.key, r.label]));
  const lines = AI_COPY_NOTE_KEYS.filter((key) => labelByKey.has(key)).map(
    (key) => `- ${labelByKey.get(key)}: ${t(`aiCopy.note.${key}`)}`,
  );
  return [
    `${t("aiCopy.notesHeading")}:`,
    ...lines,
    `- ${t("aiCopy.note.dash")}`,
  ].join("\n");
}

/**
 * 文面全体
 * @param {object} args
 * @param {Function} args.t
 * @param {string} args.heading 見出し（会場・R入り）
 * @param {object} args.context buildPremiseLines の context
 * @param {Array} args.players 枠番順
 * @param {Array<{key:string,label:string,values:string[]}>} args.rows
 * @param {object|null} args.turnPrediction
 * @param {string} args.prompt 質問文（空なら入れない）
 * @param {string} args.pageUrl そのレース詳細ページの表示言語の URL
 * @param {Date} args.now
 * @param {boolean|null} args.exhibitionPublished
 */
export function buildAiCopyText({
  t,
  heading,
  context,
  players,
  rows,
  turnPrediction,
  prompt,
  pageUrl,
  now,
  exhibitionPublished,
}) {
  if (players.length === 0) return "";
  return [
    `## ${heading}`,
    buildPremiseLines(t, context, { now, exhibitionPublished }).join("\n"),
    toMarkdownTable(t, players, rows),
    buildNotes(t, rows),
    buildTurnPredictionSection(t, players, turnPrediction),
    prompt,
    t("aiCopy.sourceLine", { url: pageUrl }),
  ]
    .filter(Boolean)
    .join("\n\n");
}
