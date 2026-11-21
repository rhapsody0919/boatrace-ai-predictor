/**
 * verify-bot-race-function.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-bot-race-function.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { call, SUCCESS_CC, bodyOf } from "./bot-race-function-scenes-1.js";
import { botRaceLang1 } from "./bot-race-function-scenes-2.js";

let check, NOW, jsonResponse, stubFetch, window;
export let KNOWN_OPS;

/** { の中身を割った 2/3 */
async function botRaceLang2({ KOJIMA_G1, at, b, fixture, id, json29, meetLinks, raceLinks, racerLinks, seriesStub }) {
  check(
    "児島12R: 帯と出走6艇はデータ分析結果の見出しの前（人の並び）",
    b.indexOf("<nav aria-label=") < b.indexOf('<ul aria-label="出走6艇">') &&
      b.indexOf('<ul aria-label="出走6艇">') < b.indexOf("<h2>"),
    true,
  );

  // 言語版: 帯と節は接頭辞付き、選手ページは ja 専用なので接頭辞なし
  const en = await call(`/api/bot-page/en/race/${id}`, {
    langMode: "prefixed",
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub(KOJIMA_G1),
  });
  check(
    "en: 選手は /racer/N（接頭辞なし）・帯と節は /en/ 付き",
    [
      racerLinks(en.res.body).length,
      raceLinks(en.res.body).every((h) => h.startsWith("/en/race/")),
      meetLinks(en.res.body),
    ],
    [6, true, ["/en/venue/16/meet/2026-09-28"]],
  );

  // 節が引けない: リンクだけ外して 200
  const origError = console.error;
  console.error = () => {};
  try {
    const failed = await call(`/api/bot-page/race/${id}`, {
      json: json29,
      now: at("2026-09-29"),
      getSeries: async () => {
        throw new Error("boom");
      },
    });
    check(
      "節が引けない: 200 で節のリンクだけ無い（帯と選手は出る）・CDN に残さない",
      [
        failed.res.statusCode,
        meetLinks(failed.res.body).length,
        racerLinks(failed.res.body).length,
        failed.res.headers["cache-control"],
      ],
      [200, 0, 6, "no-store"],
    );
  } finally {
    console.error = origError;
  }
  // 範囲外の節（前の節）・対象外のタイトル
  const none = await call(`/api/bot-page/race/${id}`, {
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub(null),
  });
  check(
    "節が無い: 節のリンクが無い（引けたので通常のキャッシュ）",
    [meetLinks(none.res.body), none.res.headers["cache-control"]],
    [[], SUCCESS_CC],
  );
  // 形の違う entries の1レースで、その日の全レースを 503 にしない
  const broken = fixture("2026-09-29");
  broken.races.find((r) => r.raceId !== id).entries = { bad: true };
  broken.races
    .find((r) => r.raceId === id)
    .entries.push(null, {
      name: "艇番なし",
    });
  const brokenRes = await call(`/api/bot-page/race/${id}`, {
    json: broken,
    now: at("2026-09-29"),
    getSeries: seriesStub(KOJIMA_G1),
  });
  check(
    "形の違う entries: 200 で、艇番の無い行は出さない",
    [
      brokenRes.res.statusCode,
      racerLinks(brokenRes.res.body).length,
      bodyOf(brokenRes.res.body).includes("艇番なし"),
    ],
    [200, 6, false],
  );
  const gp = await call(`/api/bot-page/race/${id}`, {
    json: json29,
    now: at("2026-09-29"),
    getSeries: seriesStub({ ...KOJIMA_G1, title: "グランプリ" }),
  });
  return { gp };
}

/** { の中身を割った 3/3 */
async function botRaceLang3({ at, fixture, gp, json29, meetLinks, raceLinks, racerLinks, seriesStub }) {
  check(
    "グランプリ等の対象外の節: 節のリンクが無い",
    meetLinks(gp.res.body),
    [],
  );

  // G3（江戸川）は節を引かない
  const g3 = json29.races.find((r) => r.venueCode === 4);
  check("フィクスチャ: 江戸川は G3", g3?.raceGrade, "G3");
  const g3Res = await call(`/api/bot-page/race/${g3.raceId}`, {
    json: json29,
    now: at("2026-09-29"),
  });
  check(
    "G3: 200・節を引かない・節のリンクが無い",
    [g3Res.res.statusCode, meetLinks(g3Res.res.body)],
    [200, []],
  );

  // 一般戦（戸田5R、2026-09-22）
  const json22 = fixture("2026-09-22");
  const ippan = "2026-09-22-02-05";
  check(
    "フィクスチャ: 戸田5R は一般戦",
    json22.races.find((r) => r.raceId === ippan)?.raceGrade,
    "ippan",
  );
  const ip = await call(`/api/bot-page/race/${ippan}`, {
    json: json22,
    now: at("2026-09-22"),
  });
  check(
    "一般戦: 200・/racer/ 6件・/race/ 2件以上・節のリンクが無い（節も引かない）",
    [
      ip.res.statusCode,
      racerLinks(ip.res.body).length,
      raceLinks(ip.res.body).length >= 2,
      meetLinks(ip.res.body),
    ],
    [200, 6, true, []],
  );

  // グレードが分からないときだけ節を引く（人の needsSeries と同じ）
  const unknown = fixture("2026-09-22");
  for (const r of unknown.races) r.raceGrade = null;
  const unknownSeries = seriesStub(null);
  await call(`/api/bot-page/race/${ippan}`, {
    json: unknown,
    now: at("2026-09-22"),
    getSeries: unknownSeries,
  });
  check("グレード不明: 節を1回引く", unknownSeries.calls.length, 1);

  // 中止のレースは出走6艇を出さない（帯は出す）
  const cancelled = fixture("2026-09-22");
  const c = cancelled.races.find((r) => r.raceId === ippan);
  c.cancellationStatus = "confirmed";
  c.result = null;
  const cRes = await call(`/api/bot-page/race/${ippan}`, {
    json: cancelled,
    now: at("2026-09-22"),
  });
  check(
    "中止: 出走6艇を出さず帯は出す",
    [racerLinks(cRes.res.body).length, raceLinks(cRes.res.body).length],
    [0, 12],
  );
}

// ---- 9. 人のレース詳細がボットと同じ関数で同じ物を出す（BOA-1407。描画の試験） ----
// サービス層のキャッシュ・取得の console.log は検査の出力に混ぜない（§9 の終わりで戻す）
export const sectionLog = console.log;

// 時計: 画面は Date で「本日（JST）」を決める。ボットの now と同じ時刻に止める
export const RealDate = Date;

export const fake = { tables: {}, calls: [], unknown: [] };

export const unknownOp = (where) => {
  fake.unknown.push(where);
  throw new Error(`偽の supabase に無い関数: ${where}`);
};

async function scene1() {
  {
    const { fixture, at, KOJIMA_G1, seriesStub, racerLinks, raceLinks, meetLinks, json29, id, b } = await botRaceLang1();
    const { gp } = await botRaceLang2({ KOJIMA_G1, at, b, fixture, id, json29, meetLinks, raceLinks, racerLinks, seriesStub });
    await botRaceLang3({ at, fixture, gp, json29, meetLinks, raceLinks, racerLinks, seriesStub });
  }
  // ---- 8. 節（race_series）の取得 ----
  {
    const { createSeriesSource } = await import("../../../api/_lib/botRace.js");
    const env = {
      SUPABASE_URL: "https://x.supabase.co/",
      SUPABASE_ANON_KEY: "anon",
    };
    let clock = NOW;
    const SERIES_ROW = { start_date: "2026-09-28", end_date: "2026-10-03", title: "t", grade: "G1", venue_code: 16, total_days: 6, class_code: "G1", kind: "g1" };
    const f = stubFetch(() => jsonResponse([SERIES_ROW]));
    const getSeries = createSeriesSource({ fetchImpl: f, now: () => clock, env });
    const got = await getSeries(16, "2026-09-29");
    check("節: 人と同じ条件の1行", f.calls, [
      "https://x.supabase.co/rest/v1/race_series?venue_code=eq.16&start_date=lte.2026-09-29&select=start_date,end_date,title,grade,venue_code,total_days,class_code,kind&order=start_date.desc&limit=1",
    ]);
    check("節: その日を含む節を返す（makeMeet で凍結）", [got?.start_date, Object.isFrozen(got)], ["2026-09-28", true]);
    await getSeries(16, "2026-09-29");
    check("節: 60秒以内は使い回す", f.calls.length, 1);
    clock = NOW + 61_000;
    await getSeries(16, "2026-09-29");
    check("節: 61秒後に引き直す", f.calls.length, 2);
    // 予定の最終日から4日以上後は同じ節としない（順延の許容は3日）
    check("節: 最終日から4日後は null", await getSeries(16, "2026-10-07"), null);
    for (const [label, impl] of [
      ["HTTP 500", stubFetch(() => jsonResponse({}, 500))],
      ["配列でない", stubFetch(() => jsonResponse({ a: 1 }))],
      ["日付が無い", stubFetch(() => jsonResponse([{ title: "x" }]))],
      // makeMeet の破れ（人の画面の getSeriesOfDate と同じ検査）は「節なし」でなく取得失敗
      ["total_days が日程と合わない", stubFetch(() => jsonResponse([{ ...SERIES_ROW, total_days: 5 }]))],
      ["class_code が不明", stubFetch(() => jsonResponse([{ ...SERIES_ROW, class_code: "G9" }]))],
    ]) {
      const src = createSeriesSource({ fetchImpl: impl, env });
      const err = await src(16, "2026-09-29").then(
        () => null,
        (e) => e.name,
      );
      check(`節: ${label} は SeriesFetchError`, err, "SeriesFetchError");
    }
    const noEnv = await createSeriesSource({ fetchImpl: f, env: {} })(
      16,
      "2026-09-29",
    ).then(
      () => null,
      (e) => e.name,
    );
    check("節: 環境変数が無いと SeriesFetchError", noEnv, "SeriesFetchError");
  }
  console.log = () => {};
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・NOW・jsonResponse・stubFetch） */
export async function runBotRaceFunctionScenes3(env) {
  ({ check, NOW, jsonResponse, stubFetch } = env);
  await scene1();
}

function scene2() {
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Node",
    "Event",
    "MouseEvent",
    "getComputedStyle",
    "localStorage",
    "sessionStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    const value = key === "window" ? window : window[key];
    if (value !== undefined)
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
  }
  window.scrollTo = () => {};
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・NOW・jsonResponse・stubFetch・window） */
export function runBotRaceFunctionScenes4(env) {
  ({ check, NOW, jsonResponse, stubFetch, window } = env);
  scene2();
}

function scene3() {
  // 偽の supabase（メモリ上の表）。絞り（eq・lte・gte・lt・gt・in）・order・limit・range を表に当て、
  // 問い合わせを calls に残す（race_series 以外の表は空）。知らない鎖の関数は素通しせず例外にし、unknown に残して
  // §9 の終わりに 0件を見る（部品が握りつぶしても、絞りを当てない関数で材料しだいの偽の緑にしない）
  KNOWN_OPS = new Set([
    "select",
    "eq",
    "lte",
    "gte",
    "lt",
    "gt",
    "in",
    "order",
    "limit",
    "range",
  ]);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・NOW・jsonResponse・stubFetch・window） */
export function runBotRaceFunctionScenes5(env) {
  ({ check, NOW, jsonResponse, stubFetch, window } = env);
  scene3();
}
