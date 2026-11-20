/**
 * verify-bot-page-model.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-page-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { register } from "node:module";

let SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt, headMeta;
let SWAP_HOOKS, fakeChain, setI18n;

const FAKE_KEY = "__verifyBotPageModelSupabase";

const SPIES = {
  "utils/pageMeta.js": ["getTopPageMeta", "getTodayVenuePageMeta"],
  "utils/raceListDisplay.js": [
    "venueCardHeadline",
    "raceNumberLabel",
    "deadlineValueText",
  ],
  "utils/todayRaces.js": ["transformTodayRaces"],
};

// 偽の supabase（どの問い合わせも空の結果。auth 等の同期の呼び出しも同じ物を返す）
const fakeResult = { data: [], error: null, count: 0 };

// 通信はしない（fetch を差し替える）。/api/races/today はフィクスチャ、/api/predictions/:date はフィクスチャから組んだ Edge API の形
// （江戸川だけ G1 にして、会場ページの title に節タイトルが入る場合も見る）
const withEdogawaG1 = () => {
  const json = fresh();
  json.data
    .find((v) => v.place_cd === 3)
    .races.forEach((r) => {
      r.raceGrade = "G1";
    });
  return json;
};

const pad2 = (n) => String(n).padStart(2, "0");

const predictionsOf = (date) => ({
  date,
  races: withEdogawaG1().data.flatMap((v) =>
    v.races.map((r) => ({
      raceId: `${date}-${pad2(v.place_cd)}-${pad2(r.raceNo)}`,
      venueCode: v.place_cd,
      raceNumber: r.raceNo,
      startTime: r.startTime,
      raceGrade: r.raceGrade ?? null,
      raceTitle: r.raceTitle ?? null,
      raceStage: r.raceStage ?? null,
      cancellationStatus: r.cancellationStatus ?? null,
      seriesDay: r.seriesDay ?? null,
      isFinalDay: r.isFinalDay ?? null,
      entries: [],
      predictions: {},
    })),
  ),
});

// 部品の console.log 等は黙らせる（失敗の文だけを出す。報告の前に戻す）
const consoleSaved = { ...console };

const texts = (root, selector) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

function scene1() {
  for (const file of new Set(globalThis[ENV_HIT_KEY] ?? [])) {
    failures.push(`${file}: ブラウザ専用の依存（import.meta.env）を使っている`);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・renderAt） */
export function runBotPageModelScenes7(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, renderAt } = env);
  scene1();
}

function scene2() {
  if (Atomics.load(guardState, 1) > 0) {
    failures.push(
      `botPageModel.js の木: react・supabaseClient の import が ${Atomics.load(guardState, 1)} 件（握りつぶされても落とす）`,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・renderAt） */
export function runBotPageModelScenes8(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, renderAt } = env);
  scene2();
}

function scene3() {
  // 木を観測できていること（hook が働かず空振りしていない）
  check(
    "§1: import の木を観測できている（10ファイル以上）",
    treeFileCount >= 10,
    true,
  );
  Atomics.store(guardState, 0, 1);
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderAt） */
export function runBotPageModelScenes9(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderAt } = env);
  scene3();
}

async function scene4() {
  // 1回描いて renderJsx の hook と jsdom を入れてから、記録係の hook を重ねる（順を逆にすると拡張子の無い import が素通りする）
  await (
    await renderJsx(routerUrl, { children: null }, { exportName: "MemoryRouter" })
  ).unmount();
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderJsx・routerUrl・renderAt） */
export async function runBotPageModelScenes10(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, renderAt } = env);
  await scene4();
}

function scene5() {
  SWAP_HOOKS = `
let src;
let spies;
export function initialize(data) {
  src = data.src;
  spies = data.spies;
}
const asModule = (code) => ({ url: "data:text/javascript," + encodeURIComponent(code), shortCircuit: true });
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const parent = context.parentURL ?? "";
  if (resolved.url === src + "services/supabaseClient.js") {
    return asModule("export const supabase = globalThis.${FAKE_KEY};");
  }
  const target = resolved.url.startsWith(src) ? resolved.url.slice(src.length) : null;
  if (target && spies[target] && parent.startsWith(src)) {
    const importer = JSON.stringify(parent.slice(src.length));
    const real = JSON.stringify(resolved.url);
    const lines = ["import * as real from " + real + ";", "export * from " + real + ";"];
    for (const name of spies[target]) {
      lines.push(
        "export function " + name + "(...args) { const result = real." + name + "(...args);" +
          " (globalThis.${SPY_KEY} ??= []).push({ importer: " + importer + ", name: " + JSON.stringify(name) + ", args, result });" +
          " return result; }",
      );
    }
    return asModule(lines.join("\\n"));
  }
  return resolved;
}
`;
  register(`data:text/javascript,${encodeURIComponent(SWAP_HOOKS)}`, {
    data: { src: SRC_URL, spies: SPIES },
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderJsx・routerUrl・SPY_KEY・renderAt） */
export function runBotPageModelScenes11(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, renderAt } = env);
  scene5();
}

async function scene6() {
  fakeChain = new Proxy(function fake() {}, {
    get(_, key) {
      if (key === "then") {
        return (resolve, reject) =>
          Promise.resolve(fakeResult).then(resolve, reject);
      }
      return typeof key === "symbol" ? undefined : fakeChain;
    },
    apply: () => fakeChain,
  });
  globalThis[FAKE_KEY] = fakeChain;
  globalThis.fetch = async (input) => {
    const url = String(input?.url ?? input);
    if (url === "/api/races/today") return Response.json(fresh());
    const m = url.match(/^\/api\/predictions\/(\d{4}-\d{2}-\d{2})(\?|$)/);
    if (m) return Response.json(predictionsOf(m[1]));
    return new Response("{}", { status: 404 }); // 他の補助の取得（会場カードの傾向等）は無いものとして描く
  };
  for (const level of ["log", "info", "debug", "warn", "error"]) {
    console[level] = () => {};
  }
  ({ setI18n } = await import("react-i18next"));
  setI18n(i18nAll);
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderJsx・routerUrl・SPY_KEY・callsOf・renderAt） */
export async function runBotPageModelScenes12(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt } = env);
  await scene6();
}

async function scene7() {
  // 5a. データ層: 公開の入口（scheduleQueries の getRaces。殻 dataService.js は RA40 BOA-1673 で消す）が todayRaces.js の transformTodayRaces を呼び、同じ値を返す
  {
    globalThis[SPY_KEY] = [];
    const { getRaces } = await import(srcUrl("services/scheduleQueries.js"));
    const out = await getRaces();
    check(
      "データ層: getRaces は transformTodayRaces と同じ値（会場の1コース勝率は偽の DB で空）",
      out,
      transformTodayRaces(fresh(), {}),
    );
    const calls = (globalThis[SPY_KEY] ?? []).filter(
      (c) =>
        c.importer.startsWith("services/") && c.name === "transformTodayRaces",
    );
    check(
      "データ層: getRaces が todayRaces.js の transformTodayRaces を呼んでいる（自前の定義で二重にしない）",
      calls.some((c) => JSON.stringify(c.result) === JSON.stringify(out)),
      true,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderJsx・routerUrl・SPY_KEY・callsOf・renderAt・headMeta） */
export async function runBotPageModelScenes13(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt, headMeta } = env);
  await scene7();
}

async function scene8() {
  // 5c. 会場ページ（VenueRaceListPage と、その中の RaceCard）。一般戦の桐生と G1 にした江戸川、ja と en
  {
    const { default: VenueRaceListPage } = await import(
      srcUrl("pages/VenueRaceListPage.jsx")
    );
    for (const [lang, code] of [
      ["ja", 1],
      ["ja", 3],
      ["en", 1],
    ]) {
      await i18nAll.changeLanguage(lang);
      const model = buildVenueModel(withEdogawaG1(), code, {
        t: tOf(lang),
        lang,
      });
      const view = await renderAt(
        lang === "ja" ? `/venue/${code}` : `/${lang}/venue/${code}`,
        ["/venue/:venueCode", "/:lang/venue/:venueCode"],
        VenueRaceListPage,
        (c) => c.querySelectorAll(".race-card").length === model.races.length,
      );
      const label = `会場${code}（${lang}）`;
      check(
        `${label}: title・description・canonical はモデルと同じ`,
        headMeta(view.document),
        model.meta,
      );
      const metaCalls = callsOf(
        "pages/VenueRaceListPage.jsx",
        "getTodayVenuePageMeta",
      );
      check(
        `${label}: getTodayVenuePageMeta で title 等を組む`,
        metaCalls.some(
          (c) =>
            c.args[1] === code &&
            c.args[3] === lang &&
            JSON.stringify(c.result) === JSON.stringify(model.meta),
        ),
        true,
      );
      const cards = view.container.querySelectorAll(".race-card");
      check(
        `${label}: レースカードのレース番号`,
        texts(view.container, ".race-card .race-number"),
        model.races.map((r) => r.raceLabel),
      );
      check(
        `${label}: レースカードの締切`,
        [...cards].map((c) => [
          c.querySelector(".race-info .info-item .label")?.textContent ?? null,
          c.querySelector(".race-info .info-item .value")?.textContent ?? null,
        ]),
        model.races.map((r) => [
          r.deadline?.label ?? null,
          r.deadline?.value ?? null,
        ]),
      );
      const numbers = model.races.map((r) => r.raceNumber);
      check(
        `${label}: RaceCard が raceNumberLabel(race.raceNumber) で書く`,
        numbers.every((n) =>
          callsOf("components/race/RaceCard.jsx", "raceNumberLabel").some(
            (c) => c.args[0] === n,
          ),
        ),
        true,
      );
      const deadlineCalls = callsOf(
        "components/race/RaceCard.jsx",
        "deadlineValueText",
      );
      check(
        `${label}: RaceCard が deadlineValueText(t, race.startTime) で書く`,
        model.races.every((r) =>
          deadlineCalls.some(
            (c) =>
              typeof c.args[0] === "function" &&
              c.result === r.deadline?.value &&
              c.args[1] ===
                fresh()
                  .data.find((v) => v.place_cd === code)
                  .races.find((x) => x.raceNo === r.raceNumber).startTime,
          ),
        ),
        true,
      );
      await view.unmount();
    }
  }
  Object.assign(console, consoleSaved);
}

/** verify から呼ぶ入口。env は verify 側の束縛（SRC_URL・srcUrl・failures・check・ENV_HIT_KEY・guardState・i18nAll・tOf・fresh・buildVenueModel・transformTodayRaces・treeFileCount・renderJsx・routerUrl・SPY_KEY・callsOf・renderAt・headMeta） */
export async function runBotPageModelScenes14(env) {
  ({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt, headMeta } = env);
  await scene8();
}
