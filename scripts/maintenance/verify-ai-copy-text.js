#!/usr/bin/env node
/**
 * 「AI用にコピー」の文面（src/utils/aiCopyText.js、BOA-770）の回帰テスト。DB 接続は不要。
 * 実際の locale（ja / en / ko / zh-TW）で文面を組み立てて、次を確かめる。
 *
 *   - 末尾に出典1行（表示言語のブランド名＋そのレース詳細ページの表示言語の URL）がある
 *   - 先頭（見出しの直後）にレースの前提の行（日付・締切・グレード／節・水面の条件）があり、
 *     取れない項目は「未発表」と書く
 *   - データの時点（JST）があり、展示前なら展示系が未発表である旨がある
 *   - 項目の注記が表にある行のぶんだけ入る（調子・ST安定度・展示タイムの括弧・集計期間・「—」）
 *   - 1マーク展開予測が券種にかかわらず入る
 *   - 「競艇」や、的中・回収を示唆する語が追加した文言に無い（BOA-617）
 *   - 訳し漏れ（キーがそのまま出る・{{}} が残る・undefined / NaN）が無い
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiCopyPageUrl, buildAiCopyText } from "../../src/utils/aiCopyText.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const LANGS = ["ja", "en", "ko", "zh-TW"];

const loadLocale = (lang) =>
  JSON.parse(
    fs.readFileSync(path.join(ROOT, `src/locales/${lang}/common.json`), "utf8"),
  );

const lookup = (dict, key) =>
  key
    .split(".")
    .reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), dict);

/** i18next の t の、この文面で使う範囲だけを再現する（既定値・{{}} の差し込み） */
const makeT = (dict) => (key, arg) => {
  const found = lookup(dict, key);
  const template =
    typeof found === "string" ? found : typeof arg === "string" ? arg : key;
  const params = arg && typeof arg === "object" ? arg : {};
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    params[name] === undefined ? `{{${name}}}` : String(params[name]),
  );
};

const RACE_ID = "2026-10-05-01-05";
// 2026-10-05 14:58 JST
const NOW = new Date("2026-10-05T05:58:00Z");

const players = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: n,
  name: `選手${n}`,
}));
const row = (key, label) => ({ key, label, values: players.map(() => "—") });
const ROWS = [
  row("name", "name"),
  row("form", "form"),
  row("avgSt", "avgSt"),
  row("st", "st"),
  row("exSt", "exSt"),
  row("exhibition", "exhibition"),
  row("partsChanged", "partsChanged"),
  row("courseRate", "courseRate"),
  row("returnRate", "returnRate"),
];
const TURN = {
  patterns: [
    {
      technique: "nige",
      winnerCourse: 1,
      probability: 0.52,
      secondPlace: { 2: 0.4 },
      thirdPlace: { 3: 0.3 },
    },
  ],
  distribution: { nige: 0.52, sashi: 0.2 },
  boatStrengths: [0.9, 0.5, 0.4, 0.3, 0.2, 0.1],
};
const WEATHER = {
  weather: "晴",
  temperature: 22,
  windSpeed: 3,
  windDirection: "北西",
  waterTemperature: 21,
  waveHeight: 3,
  observedAt: "2026-10-05T05:52:00Z",
};

const build = (lang, overrides = {}) => {
  const dict = loadLocale(lang);
  const t = makeT(dict);
  return {
    dict,
    text: buildAiCopyText({
      t,
      lang,
      heading: t("aiCopy.markdownHeading", { venue: "V", race: 5 }),
      context: {
        date: RACE_ID.slice(0, 10),
        startTime: "15:23",
        raceGrade: "G1",
        seriesTitle: "周年記念",
        seriesDayLabel: t("raceDetailPage.seriesDayNth", { day: 3 }),
        raceStage: null,
        weather: WEATHER,
        ...overrides.context,
      },
      players,
      rows: overrides.rows ?? ROWS,
      turnPrediction: TURN,
      prompt: t("aiCopy.promptWin"),
      pageUrl: aiCopyPageUrl(RACE_ID, lang),
      now: NOW,
      exhibitionPublished:
        "exhibitionPublished" in overrides ? overrides.exhibitionPublished : false,
    }),
  };
};

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

for (const lang of LANGS) {
  const { dict, text } = build(lang);
  const a = dict.aiCopy;
  const lines = text.split("\n");
  const url =
    lang === "ja"
      ? `https://www.boat-ai.jp/race/${RACE_ID}`
      : `https://www.boat-ai.jp/${lang}/race/${RACE_ID}`;

  // 出典1行
  const last = lines[lines.length - 1];
  check(
    `[${lang}] 末尾が出典1行`,
    last.includes(dict.nav.logoText) && last.endsWith(url),
    last,
  );
  check(
    `[${lang}] 出典は1回だけ`,
    text.split(dict.nav.logoText).length === 2,
  );

  // 前提の行が見出しの直後にある
  check(`[${lang}] 1行目が見出し`, lines[0].startsWith("## "), lines[0]);
  check(
    `[${lang}] 見出しの直後に日付`,
    lines[2] === `- ${a.premiseDate}: 2026-10-05`,
    lines[2],
  );
  check(`[${lang}] 締切`, text.includes(`- ${a.premiseDeadline}: 15:23`));
  check(
    `[${lang}] グレード・節・日目`,
    text.includes(
      `- ${a.premiseMeet}: G1 / 周年記念 / ${dict.raceDetailPage.seriesDayNth.replace("{{day}}", "3")}`,
    ),
  );
  check(
    `[${lang}] 風速・波高・観測時刻`,
    text.includes("3.0m") && text.includes("3cm") && text.includes("14:52"),
  );
  check(
    `[${lang}] データの時点（JST）`,
    text.includes(`- ${a.premiseAsOf}: `) && text.includes("2026-10-05 14:58"),
  );
  check(
    `[${lang}] 展示前の断り`,
    text.includes(a.premiseExhibitionUnpublished),
  );

  // 注記
  for (const key of [
    "form",
    "avgSt",
    "st",
    "exSt",
    "exhibition",
    "partsChanged",
    "courseRate",
    "returnRate",
    "dash",
  ]) {
    check(`[${lang}] 注記 ${key}`, text.includes(`- ${a.note[key]}`));
  }
  // 表の後ろに注記、注記の後ろに展開予測
  const tableEnd = text.lastIndexOf("| returnRate |");
  const notesAt = text.indexOf(a.notesHeading);
  const turnAt = text.indexOf(a.turnPredictionHeading);
  check(
    `[${lang}] 表 → 注記 → 展開予測 の順`,
    tableEnd < notesAt && notesAt < turnAt,
    `${tableEnd} ${notesAt} ${turnAt}`,
  );
  check(`[${lang}] 単勝でも展開予測が入る`, turnAt > 0);

  // 訳し漏れ
  check(
    `[${lang}] キーがそのまま出ていない`,
    !/aiCopy\.|beforeInfo\.|raceDetailPage\./.test(text),
  );
  check(`[${lang}] {{}} が残っていない`, !text.includes("{{"));
  check(`[${lang}] undefined / NaN が無い`, !/undefined|NaN/.test(text));
  check(`[${lang}] 「競艇」が無い`, !text.includes("競艇"));

  // 気象が無い・展示後
  const { text: noWeather } = build(lang, {
    context: { weather: null, startTime: null },
    exhibitionPublished: true,
  });
  check(
    `[${lang}] 気象が無いと各項目が未発表`,
    noWeather.includes(`${dict.beforeInfo.waveHeightLabel} ${a.unpublished}`) &&
      noWeather.includes(`${a.premiseWind} ${a.unpublished}`),
  );
  check(
    `[${lang}] 締切が無いと未発表`,
    noWeather.includes(`- ${a.premiseDeadline}: ${a.unpublished}`),
  );
  check(
    `[${lang}] 展示後は展示前の断りが無い`,
    !noWeather.includes(a.premiseExhibitionUnpublished),
  );

  // 取得失敗で展示の有無が分からないときは「未反映」と言い切らない
  const { text: unknownEx } = build(lang, { exhibitionPublished: null });
  check(`[${lang}] 展示の有無が不明なら未反映の行を出さない`, !unknownEx.includes(a.premiseExhibitionUnpublished));

  // 表に無い行の注記は出さない
  const { text: fewRows } = build(lang, {
    rows: [row("name", "name"), row("form", "form")],
  });
  check(
    `[${lang}] 表に無い行の注記は出さない`,
    !fewRows.includes(a.note.partsChanged) &&
      fewRows.includes(a.note.form) &&
      fewRows.includes(a.note.dash),
  );

  // 追加した文言に「競艇」が無い
  const added = [
    ...Object.values(a.note),
    a.followUp1,
    a.followUp2,
    a.followUp3,
    a.followUpHeading,
    a.promptTurn,
    a.promptDataOnly,
    a.promptSelectorTurn,
    a.promptSelectorDataOnly,
    a.premiseExhibitionUnpublished,
    a.sourceLine,
    a.previewToggleLabel,
  ];
  check(
    `[${lang}] 追加文言に「競艇」が無い`,
    added.every((s) => !s.includes("競艇")),
  );
  if (lang === "ja") {
    // 的中・回収を示唆する表現（BOA-617）。単勝回収率の注記は既存の指標名なので「回収率」だけ許す
    const hint = /的中|当た|勝てる|儲|稼|狙い目/;
    const bad = added.filter((s) => hint.test(s) || /回収(?!率)/.test(s));
    check(
      "[ja] 追加文言に的中・回収を示唆する語が無い",
      bad.length === 0,
      bad.join(" / "),
    );
  }
}

if (failures.length > 0) {
  console.error(`❌ verify-ai-copy-text: ${failures.length}件失敗`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`✅ verify-ai-copy-text: ${LANGS.length}言語で文面の検証に合格`);
