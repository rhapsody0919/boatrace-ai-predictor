/**
 * verify-bot-race-function.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { cases, renderBot, reportErrors, checkPage, getSeriesOfDate, KOJIMA_G1 } from "./bot-race-function-scenes-4.js";
import { tJa } from "./bot-race-function-scenes-1.js";
import { fake, RealDate } from "./bot-race-function-scenes-3.js";

let FAKE_KEY, spy, failures, check, clearCache, renderPage;
let kojima, kiryu, hama, heading, meta, crumbs, listLink, noNeed, need, meetStart, rows, covered;

// 9b. 共有の関数の戻り値を差し替えると、人の画面とサービス層がそれに従う（同じ値の写しでは通らない）
const withOverride = async (overrides, fn) => {
  spy.overrides = overrides;
  try {
    return await fn();
  } finally {
    spy.reset();
  }
};

const SPY_HEADING = {
  gradeConfig: { label: "SPY-G", color: "#000" },
  seriesTitle: "SPY-節",
  stageChip: { variant: "plain", label: "SPY-種別", isOfficial: false },
  seriesDayLabel: "SPY-日目",
};

// サービス層の節の取得（公開の入口 getSeriesOfDate を偽の supabase の上で呼ぶ。殻が持つのも同じ関数）
const seriesOf = async (date) => {
  clearCache();
  return getSeriesOfDate(16, date);
};

const SENTINEL = { start_date: "2099-01-01", end_date: "2099-01-01" };

async function scene1() {
  for (const c of cases) {
    const before = failures.length;
    const page = await renderPage(c);
    const bot = await renderBot(c);
    check(
      `人とボット ${c.label}: 帯と出走6艇が描かれた`,
      [(page.view.strip ?? []).length > 1, page.view.entrants.length],
      [true, 6],
    );
    for (const key of Object.keys(bot))
      check(`人とボット ${c.label}: ${key}`, page.view[key], bot[key]);
    check(
      `人 ${c.label}: 節を引くのは G1 だけ（会場・日で）`,
      page.seriesCalls,
      c.seriesCalls ? [[16, c.id.slice(0, 10)]] : [],
    );
    reportErrors(c.label, page, before);
  }
  // 比べた値が空振りしていない（節のリンク・節タイトル・種別・日目）
  kojima = await renderPage(cases[0]);
  checkPage(
    kojima,
    "人 児島12R: 節のリンクは /venue/16/meet/2026-09-28",
    kojima.view.meet,
    [["/venue/16/meet/2026-09-28", tJa("raceStrip.meetLink")]],
  );
  kiryu = await renderPage(cases[3]);
  checkPage(
    kiryu,
    "人 桐生12R: 節タイトルと優勝戦",
    [kiryu.view.kicker.includes("第8回日本一しょうゆ杯"), kiryu.view.h1],
    [true, "🚤 桐生 12R 🏆 優勝戦"],
  );
  hama = await renderPage(cases[4]);
  checkPage(
    hama,
    "人 浜名湖: 日目を補う",
    hama.view.h1?.endsWith("3日目"),
    true,
  );
  heading = await withOverride(
    { getRaceDetailHeading: () => SPY_HEADING },
    () => renderPage(cases[0]),
  );
  checkPage(
    heading,
    "人: 見出しは getRaceDetailHeading の値",
    [heading.view.kicker, heading.view.h1],
    [["SPY-G", "SPY-節"], "🚤 児島 12R SPY-種別 SPY-日目"],
  );
  meta = await withOverride(
    {
      getRaceDetailMeta: () => ({
        title: "SPY-title",
        description: "SPY-description",
        canonical: "https://example.invalid/spy",
      }),
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    meta,
    "人: title・description・canonical は getRaceDetailMeta の値",
    [meta.view.title, meta.view.description, meta.view.canonical],
    ["SPY-title", "SPY-description", "https://example.invalid/spy"],
  );
  crumbs = await withOverride(
    {
      getRaceDetailBreadcrumbItems: () => [
        { name: "SPY-1", url: "/spy-1" },
        { name: "SPY-2", url: "/spy-2" },
      ],
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    crumbs,
    "人: パンくずは getRaceDetailBreadcrumbItems の値",
    crumbs.view.crumbs,
    [
      ["SPY-1", "/spy-1"],
      ["SPY-2", null],
    ],
  );
  listLink = await withOverride(
    { getRaceListLink: () => "/spy-list" },
    () => renderPage(cases[0]),
  );
}

async function scene2() {
  checkPage(
    listLink,
    "人: レース一覧へのリンクは getRaceListLink の値",
    listLink.view.backLink,
    "/spy-list",
  );
  noNeed = await withOverride({ needsMeetSeries: () => false }, () =>
    renderPage({ ...cases[0], seriesCalls: 0 }),
  );
  checkPage(
    noNeed,
    "人: needsMeetSeries が false なら G1 でも節を引かずリンクも無い",
    [noNeed.seriesCalls.length, noNeed.view.meet],
    [0, []],
  );
  need = await withOverride({ needsMeetSeries: () => true }, () =>
    renderPage({ ...cases[2], seriesCalls: 1 }),
  );
  checkPage(
    need,
    "人: needsMeetSeries が true なら一般戦でも節を引く",
    need.seriesCalls.length > 0,
    true,
  );
  meetStart = await withOverride(
    { meetLinkStartDateOf: () => "2099-01-01" },
    () => renderPage(cases[0]),
  );
  checkPage(
    meetStart,
    "人: 節のリンクの初日は meetLinkStartDateOf の値",
    meetStart.view.meet.map(([href]) => href),
    ["/venue/16/meet/2099-01-01"],
  );
  rows = await withOverride(
    {
      entrantRowsOf: (real, players) =>
        real(players)
          .slice(0, 2)
          .map((r) => ({ ...r, name: `SPY${r.number}`, grade: "Z9" })),
    },
    () => renderPage(cases[0]),
  );
  checkPage(
    rows,
    "人: 出走6艇の行は entrantRowsOf の値",
    rows.view.entrants.map(([n, name, , grade]) => [n, name, grade]),
    [
      ["1", "SPY1", "Z9"],
      ["2", "SPY2", "Z9"],
    ],
  );
  fake.tables = {
    race_series: [
      { ...KOJIMA_G1, start_date: "2026-09-14", end_date: "2026-09-19" },
      KOJIMA_G1,
      { ...KOJIMA_G1, venue_code: 4, start_date: "2026-10-01" },
    ],
  };
  check(
    "サービス層: その日を含む節・順延の3日以内は同じ節・4日後は null・前の節の範囲外は null",
    [
      (await seriesOf("2026-09-29"))?.start_date,
      (await seriesOf("2026-10-06"))?.start_date,
      await seriesOf("2026-10-07"),
      await seriesOf("2026-09-24"),
    ],
    ["2026-09-28", "2026-09-28", null, null],
  );
  covered = await withOverride(
    {
      seriesCoveringDate: (real, latest, date) =>
        latest?.start_date === "2026-09-28" && date === "2026-10-07"
          ? SENTINEL
          : real(latest, date),
    },
    () => seriesOf("2026-10-07"),
  );
  check(
    "サービス層: 節の範囲の判定は seriesCoveringDate（その日以前のいちばん新しい節とその日を渡す）",
    covered,
    SENTINEL,
  );
  check(
    "偽の supabase に無い関数を呼んでいない",
    [...new Set(fake.unknown)],
    [],
  );
  delete globalThis[FAKE_KEY];
  globalThis.Date = RealDate;
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・spy・failures・check・clearCache・renderPage） */
export async function runBotRaceFunctionScenes12(env) {
  ({ FAKE_KEY, spy, failures, check, clearCache, renderPage } = env);
  await scene1();
  await scene2();
}
