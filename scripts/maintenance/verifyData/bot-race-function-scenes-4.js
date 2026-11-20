/**
 * verify-bot-race-function.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { fake, KNOWN_OPS, unknownOp } from "./bot-race-function-scenes-3.js";
import { call } from "./bot-race-function-scenes-1.js";

let FAKE_KEY, read, failures, check, JSDOM, i18next;
let initReactI18next, json29, json22, json12, hamaNoDay;
export let getSeriesOfDate, cases;

// 1つの絞り込み・並べ替え（runQuery の for の本体をそのまま。塊を外したので、関数の複雑さの線の内に割った）
const applyQueryOp = (rows, [op, col, val]) => {
  if (op === "eq") rows = rows.filter((r) => r[col] === val);
  else if (op === "lte") rows = rows.filter((r) => r[col] <= val);
  else if (op === "gte") rows = rows.filter((r) => r[col] >= val);
  else if (op === "lt") rows = rows.filter((r) => r[col] < val);
  else if (op === "gt") rows = rows.filter((r) => r[col] > val);
  else if (op === "in") rows = rows.filter((r) => val.includes(r[col]));
  else if (op === "order") {
    const dir = val?.ascending === false ? -1 : 1;
    rows.sort((a, b) =>
      a[col] < b[col] ? -dir : a[col] > b[col] ? dir : 0,
    );
  } else if (op === "limit") rows = rows.slice(0, col);
  else if (op === "range") rows = rows.slice(col, val + 1);
  return rows;
};

const runQuery = (q, single) => {
  let rows = (fake.tables[q.table] ?? []).map((r) => ({ ...r }));
  for (const o of q.ops) rows = applyQueryOp(rows, o);
  return { data: single ? (rows[0] ?? null) : rows, error: null };
};

const chainOf = (q) => {
  const chain = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "then")
          return (res, rej) =>
            Promise.resolve()
              .then(() => runQuery(q, false))
              .then(res, rej);
        if (prop === "single" || prop === "maybeSingle")
          return () => Promise.resolve().then(() => runQuery(q, true));
        if (!KNOWN_OPS.has(prop))
          return unknownOp(`${q.table}.${String(prop)}`);
        return (...args) => {
          q.ops.push([prop, ...args]);
          return chain;
        };
      },
    },
  );
  return chain;
};

// 画面の /api/predictions は差し替えた fetch で、ボットと同じフィクスチャを返す。他の URL は 404（通信しない）
export const pagePredictions = {};

const LANGS = ["ja", "en", "zh-TW", "ko"];

// 帯が節を引いたかは、公開の入口 getSeriesOfDate の呼び出しで見る（race_series は他の部品も引くので表では見分けない）。
// 殻の性質の差し替えでなく module hook の包み（SPIED）で見るので、部品が殻を経ずに名前つきで import しても数える
export const seriesOfDateCalls = [];

export const KOJIMA_G1 = {
  venue_code: 16,
  start_date: "2026-09-28",
  end_date: "2026-10-03",
  title: "児島キングカップ開設７４周年記念競走",
  grade: "G1",
  total_days: 6, class_code: "G1", kind: "g1", // makeMeet の必須の列（getSeriesOfDate が select に足した）
};

const fixtureOf = (d) =>
  JSON.parse(
    read(
      `scripts/lib/__fixtures__/predictions-light/predictions-light-${d}.json`,
    ),
  );

// 描いた後の待ちの上限（5ms の回数）。目安（根拠なし）。手元では10回前後で揃う
export const MAX_TICKS = 400;

export const text = (el) => el?.textContent.replace(/\s+/g, " ").trim() ?? null;

export const hrefOf = (el) => el?.getAttribute("href") ?? null;

/** ボットの HTML から同じ形の値を取り出す */
function extractBot(html) {
  const doc = new JSDOM(html).window.document;
  const body = doc.body;
  const nav = [...body.querySelectorAll("nav")];
  const crumbNav = nav.find((n) => n.querySelector("ol"));
  const stripNav = nav.find((n) => n.hasAttribute("aria-label"));
  const h1 = body.querySelector("h1");
  const entrants = body.querySelector("ul[aria-label]");
  const kicker = body.querySelector("p");
  return {
    title: doc.querySelector("title")?.textContent ?? null,
    description:
      doc
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") ?? null,
    canonical: hrefOf(doc.querySelector('link[rel="canonical"]')),
    crumbs: [...crumbNav.querySelectorAll("li")].map((li) => [
      text(li),
      hrefOf(li.querySelector("a")),
    ]),
    kicker:
      kicker && kicker.compareDocumentPosition(h1) & 4
        ? [...kicker.querySelectorAll("span")].map(text)
        : [],
    h1: text(h1),
    backLink: hrefOf(h1.nextElementSibling),
    strip: [...stripNav.querySelectorAll("ul a")].map((a) => [
      hrefOf(a),
      text(a),
      a.getAttribute("aria-current"),
    ]),
    meet: [...stripNav.querySelectorAll(":scope > a")].map((a) => [
      hrefOf(a),
      text(a),
    ]),
    entrants: entrants
      ? [...entrants.querySelectorAll("li")].map((li) => [
          text(li.querySelector(":scope > span")),
          text(li.querySelector("a, span[translate]")),
          hrefOf(li.querySelector("a")),
          text(li.querySelector(":scope > span[translate]")),
        ])
      : [],
  };
}

/** 同じ材料・時計・節でボットの HTML を作る */
export async function renderBot({ id, lang = "ja", json, seriesRow = null }) {
  const date = id.slice(0, 10);
  const { res } = await call(
    `/api/bot-page/${lang === "ja" ? "" : `${lang}/`}race/${id}`,
    {
      langMode: lang === "ja" ? "ja" : "prefixed",
      json,
      now: () => Date.parse(`${date}T08:00:00+09:00`),
      getSeries: async () => seriesRow,
    },
  );
  check(`ボット ${lang} ${id}: 200`, res.statusCode, 200);
  return extractBot(res.body);
}

// 比べて落ちたら、描く間にためた console.error を出す（原因の手がかり）
export const reportErrors = (label, page, before) => {
  if (failures.length === before || page.errors.length === 0) return;
  console.error(
    `[${label}] 描く間の console.error（${page.errors.length}件、先頭10件）:`,
  );
  for (const e of page.errors.slice(0, 10)) console.error(`  ${e}`);
};

// check して、落ちたら描く間の console.error を出す
export const checkPage = (page, label, actual, expected) => {
  const before = failures.length;
  check(label, actual, expected);
  reportErrors(label, page, before);
};

function scene1() {
  globalThis[FAKE_KEY] = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "from")
          return (table) => {
            const q = { table, ops: [] };
            fake.calls.push(q);
            return chainOf(q);
          };
        if (prop === "rpc") return async () => ({ data: null, error: null });
        if (prop === "then") return undefined;
        return unknownOp(`supabase.${String(prop)}`);
      },
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM） */
export function runBotRaceFunctionScenes6(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM } = env);
  scene1();
}

async function scene2() {
  ({ initReactI18next } = await import("react-i18next"));
  await i18next.use(initReactI18next).init({
    resources: Object.fromEntries(
      LANGS.map((l) => [
        l,
        { common: JSON.parse(read(`src/locales/${l}/common.json`)) },
      ]),
    ),
    lng: "ja",
    fallbackLng: "ja",
    supportedLngs: LANGS,
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM・i18next） */
export async function runBotRaceFunctionScenes7(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM, i18next } = env);
  await scene2();
}

async function scene3() {
  ({ getSeriesOfDate } = await import("../../../src/services/scheduleQueries.js"));
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM・i18next） */
export async function runBotRaceFunctionScenes8(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM, i18next } = env);
  await scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM・i18next） */
export function runBotRaceFunctionScenes9(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM, i18next } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM・i18next） */
export function runBotRaceFunctionScenes10(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM, i18next } = env);

}

function scene4() {
  // 9a. 同じ入力で人とボットが同じ物を出す
  json29 = fixtureOf("2026-09-29");
  json22 = fixtureOf("2026-09-22");
  json12 = fixtureOf("2026-10-12");
  hamaNoDay = json12.races.find(
    (r) => r.venueCode === 6 && r.seriesDay == null,
  );
  cases = [
    {
      label: "児島12R（G1・節のリンクあり）",
      id: "2026-09-29-16-12",
      json: json29,
      series: [
        { ...KOJIMA_G1, start_date: "2026-09-14", end_date: "2026-09-19" },
        KOJIMA_G1,
        { ...KOJIMA_G1, start_date: "2026-10-08", end_date: "2026-10-13" },
      ],
      seriesRow: KOJIMA_G1,
      seriesCalls: 1,
    },
    {
      label: "児島12R en",
      id: "2026-09-29-16-12",
      lang: "en",
      json: json29,
      series: [KOJIMA_G1],
      seriesRow: KOJIMA_G1,
      seriesCalls: 1,
    },
    {
      label: "戸田5R（一般戦・節を引かない）",
      id: "2026-09-22-02-05",
      json: json22,
      seriesCalls: 0,
    },
    {
      label: "桐生12R（優勝戦・節タイトル）",
      id: "2026-10-12-01-12",
      json: json12,
      seriesCalls: 0,
    },
    {
      label: "浜名湖（日目を他レースで補う）",
      id: hamaNoDay.raceId,
      json: json12,
      seriesCalls: 0,
    },
  ];
}

/** verify から呼ぶ入口。env は verify 側の束縛（FAKE_KEY・read・failures・check・JSDOM・i18next） */
export function runBotRaceFunctionScenes11(env) {
  ({ FAKE_KEY, read, failures, check, JSDOM, i18next } = env);
  scene4();
}
