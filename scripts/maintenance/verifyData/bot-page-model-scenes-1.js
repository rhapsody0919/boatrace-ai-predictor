/**
 * verify-bot-page-model.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import i18next from "i18next";

let read, failures, check, i18nAll, tOf, fresh, TODAY, buildTopModel, buildVenueModel;
let locales, i18n, top, kiryu;
export let ja, t;

// ---- t は ja の i18next（人の画面と同じ common.json・同じ補間の設定） ----
// i18next 自身は罠を立てる前に読み込む（検査するのは src/ の木だけ）
const LANGS = ["ja", "en", "ko", "zh-TW"];

async function scene1() {
  locales = Object.fromEntries(
    LANGS.map((lang) => [
      lang,
      JSON.parse(read(`src/locales/${lang}/common.json`)),
    ]),
  );
  ja = locales.ja;
  i18n = i18next.createInstance();
  await i18n.init({
    lng: "ja",
    resources: { ja: { common: ja } },
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
  });
  t = i18n.t.bind(i18n);
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・failures・check） */
export async function runBotPageModelScenes1(env) {
  ({ read, failures, check } = env);
  await scene1();
}

async function scene2() {
  await i18nAll.init({
    lng: "ja",
    resources: Object.fromEntries(
      LANGS.map((lang) => [lang, { common: locales[lang] }]),
    ),
    fallbackLng: { zh: ["zh-TW", "ja"], default: ["ja"] },
    supportedLngs: LANGS,
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・failures・check・i18nAll） */
export async function runBotPageModelScenes2(env) {
  ({ read, failures, check, i18nAll } = env);
  await scene2();
}

function scene3() {
  // 2〜4 と全言語のモデルも罠の中で組む（呼んだときに触る依存も落とす）
  for (const lang of LANGS) {
    const tl = tOf(lang);
    try {
      for (const nowHHMM of [undefined, "12:00", "23:59"]) {
        buildTopModel(fresh(), { t: tl, today: TODAY, nowHHMM, lang });
      }
      for (let code = 1; code <= 24; code += 1) {
        buildVenueModel(fresh(), code, { t: tl, lang, today: TODAY });
      }
    } catch (e) {
      failures.push(`${lang}: モデルを組めない: ${e?.message}`);
    }
  }
  // ---- 2. フィクスチャからトップ ----
  top = buildTopModel(fresh(), { t, today: TODAY, nowHHMM: "12:00" });
  check("トップ: 開催中の会場数", top.openVenueCount, 13);
  check("トップ: 会場は24件（人のグリッドと同じ）", top.venues.length, 24);
  check(
    "トップ: 開催中の会場コード",
    top.venues.filter((v) => v.isOpen).map((v) => v.venueCode),
    [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23],
  );
  check(
    "トップ: 見出し（UTC で動かしても JST の日付）",
    top.heading,
    "🏁 本日開催中のレース 10/11(日)",
  );
  check(
    "トップ: 最終更新（JST）",
    top.updatedText,
    "レースデータ更新: 10/11 21:26",
  );
  check("トップ: title", top.meta.title, ja.meta.title);
  check("トップ: description", top.meta.description, ja.meta.description);
  check("トップ: canonical", top.meta.canonical, "https://www.boat-ai.jp/");
  check("トップ: 桐生のカード", top.venues[0], {
    venueCode: 1,
    name: "桐生",
    isOpen: true,
    href: "/venue/1",
    gradeLabel: null,
    raceTitle: "第８回日本一しょうゆ杯",
    seriesDayLabel: "5日目",
  });
  check("トップ: 江戸川は G3", top.venues[2].gradeLabel, "G3");
  check("トップ: 非開催の会場は名前だけ", top.venues[3], {
    venueCode: 4,
    name: "平和島",
    isOpen: false,
  });
  // BOA-1220: 人の会場カードと同じ日目・表示条件。時計は JST の HH:MM。
  {
    const labelOf = (json, nowHHMM, code = 1) =>
      buildTopModel(json, { t, today: TODAY, nowHHMM }).venues
        .find((v) => v.venueCode === code).seriesDayLabel;
    check("日目: 下関は初日", labelOf(fresh(), "12:00", 19), "初日");
    check("日目: 唐津は全レース終了で非表示", labelOf(fresh(), "23:00", 23), null);
    check("日目: 時計なしは人のカード同様非表示", labelOf(fresh(), undefined), null);
    const json = fresh();
    const races = json.data.find((v) => v.place_cd === 1).races;
    races.forEach((r) => { r.isFinalDay = false; });
    races.at(-1).isFinalDay = true;
    check("日目: 後続レースだけ最終日の印", labelOf(json, "12:00"), "最終日");
    races.forEach((r) => { r.seriesDay = 1; });
    check("日目: 初日と最終日の印が重なれば初日", labelOf(json, "12:00"), "初日");
    races.forEach((r) => { r.seriesDay = null; r.isFinalDay = null; });
    check("日目: 値なし", labelOf(json, "12:00"), null);
    races.at(-1).seriesDay = 5;
    check("日目: 後続レースの値で補完", labelOf(json, "12:00"), "5日目");
    races.forEach((r) => { r.startTime = "12:00"; });
    check("日目: 締切と同時刻は次レースに含めない", labelOf(json, "12:00"), null);
    races.at(-1).startTime = null;
    check("日目: 時刻欠損は次レースに含める", labelOf(json, "12:00"), "5日目");
    races.forEach((r) => { r.cancellationStatus = "confirmed"; r.result = null; });
    check("日目: 丸一日中止は時刻欠損でも非表示", labelOf(json, "12:00"), null);
  }
  // ---- 2. フィクスチャから会場ページ ----
  kiryu = buildVenueModel(fresh(), 1, { t });
  check("桐生: レース数", kiryu.races.length, 12);
  check("桐生: 見出し", kiryu.heading, "🏁 桐生 本日のレース・AI予想");
  check("桐生: 開催ありなので emptyText は null", kiryu.emptyText, null);
  check(
    "桐生: title（一般戦は節タイトルなし）",
    kiryu.meta.title,
    ja.venueRaceList.metaTitle.replace("{{venue}}", "桐生"),
  );
  check(
    "桐生: canonical",
    kiryu.meta.canonical,
    "https://www.boat-ai.jp/venue/1",
  );
}

async function scene4() {
  // ---- 2. 会場ページの title（予想・出走表）と常設の要約2行（BOA-1189 GS02-b）。24場すべて ----
  {
    const { venueSummaryLines } = await import("../../../src/utils/venueSummary.js");
    // 数字は月1回作り直すので、期待の文は静的な値から組む（文の形と、高い・はっきりしないの出し分けを見る）
    const { VENUE_SUMMARY_STATS: S } =
      await import("../../../src/data/venueSummaryStats.js");
    const c1 = (b) => b.courses[0].rate.toFixed(1);
    const n = (x) => x.toLocaleString("en-US");
    const nat = `全国（${n(S.national.races)}レース）の${c1(S.national)}%`;
    const to = S.to.replaceAll("-", "/");
    for (let code = 1; code <= 24; code += 1) {
      const model = buildVenueModel(fresh(), code, { t });
      const name = ja.venues[code];
      check(
        `会場${code}: title は「{会場}競艇の予想・出走表」で始まる`,
        model.meta.title.startsWith(`${name}競艇の予想・出走表`),
        true,
      );
      const lines = venueSummaryLines(t, code);
      check(
        `会場${code}: 要約2行は人の画面と同じ関数の文（開催なしの日も出す）`,
        model.summaryLines,
        [lines.course, lines.techniques],
      );
      check(
        `会場${code}: 要約の1行目は会場名と直近1年で始まる`,
        model.summaryLines[0].startsWith(`${name}の直近1年（`),
        true,
      );
    }
    check(
      "若松: 要約の1行目（全国より高い会場）",
      buildVenueModel(fresh(), 20, { t }).summaryLines[0],
      `若松の直近1年（${to}まで、${n(S.venues[20].races)}レース）、1コースの1着率は${c1(S.venues[20])}%で、${nat}より高い`,
    );
    check(
      "多摩川: 要約の1行目（全国との差が確かめられない会場）",
      buildVenueModel(fresh(), 5, { t }).summaryLines[0],
      `多摩川の直近1年（${to}まで、${n(S.venues[5].races)}レース）、1コースの1着率は${c1(S.venues[5])}%。${nat}との差ははっきりしない`,
    );
  }
  check("桐生: 1R", kiryu.races[0], {
    raceNumber: 1,
    venueName: "桐生",
    raceLabel: "1R",
    gradeLabel: null,
    cancelledLabel: null,
    deadline: { label: "締切予定時刻", value: "15:19" },
    href: "/race/2026-10-11-01-01",
  });
  check(
    "桐生: 締切時刻（レース番号順）",
    kiryu.races.map((r) => r.deadline?.value),
    [
      "15:19",
      "15:47",
      "16:17",
      "16:47",
      "17:17",
      "17:48",
      "18:17",
      "18:48",
      "19:16",
      "19:48",
      "20:17",
      "20:45",
    ],
  );
  check(
    "江戸川: グレード",
    buildVenueModel(fresh(), 3, { t }).races[0].gradeLabel,
    "G3",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・failures・check・i18nAll・tOf・fresh・TODAY・buildTopModel・buildVenueModel） */
export async function runBotPageModelScenes3(env) {
  ({ read, failures, check, i18nAll, tOf, fresh, TODAY, buildTopModel, buildVenueModel } = env);
  scene3();
  await scene4();
}
