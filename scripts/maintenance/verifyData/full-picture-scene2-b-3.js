/**
 * verify-full-picture-scene2.js の後半の場面（3/13）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { live, date, entryRows } from "./full-picture-scene2-b-1.js";
import { rpcBodies, r3, scoped3 } from "./full-picture-scene2-b-2.js";

let m, losingRows;
let finals;

// 優勝戦の成績・優出・優勝回数（2026-10-26 hq 依頼、FT01 の PR B の 5）。本体の優勝戦（固定の材料の日 2026-10-12 より前）:
//   Y1 1/10: 4001 1号艇 1着 / 4002 2号艇 欠 / 4003 3号艇 F / 4005 5号艇 6着だが race_entries.is_absent
//   Y2 3/05: 4001 3号艇 2着 / 4003 2号艇 着の表記なしで rank1=2（1着） / 4004 1号艇 L
//   Y3 4/01 不成立（no_race） / Y4 5/01 中止（cancellation_status） / Y5 6/01 結果の行なし（いずれも 4001 1号艇）
//   Y6 10/13（このレースの後）・Y0 2025-12-02（本体の窓の前、長期のアーカイブの日）は問い合わせの範囲の外
// 長期のアーカイブ（既定は匿名で読めない 401）: K1 2024-05-05 は 4001 1号艇 01・4002 2号艇 S1・4003 4号艇 K0、K2 2023-01-01 は結果なし
export const Y = {
  y0: "2025-12-02-09-12",
  y1: "2026-01-10-01-12",
  y2: "2026-03-05-02-12",
  y3: "2026-04-01-03-12",
  y4: "2026-05-01-04-12",
  y5: "2026-06-01-05-12",
  y6: "2026-10-13-01-12",
};

export const seenQueries = [];

export const listParam = (v) => (v ?? "").replace(/^in\.\(|\)$/g, "").split(",");

export const inIds = (q) =>
  listParam(q.get("race_id")).map((x) =>
    decodeURIComponent(x).replace(/"/g, ""),
  );

// 優勝戦の成績・期の表の問い合わせの偽物（PostgREST の絞り込みの代わり）。該当しなければ undefined
// finalsResponse の if の並びを分けた部品。合わなければ finalsResponseNext を返し、finalsResponse が次の部品へ進む（分ける前と同じ順・条件・答え）
const finalsResponseNext = {};

const finalsResponse1 = ({ table, q, fail }) => {
  if (table === "race_conditions" && q.get("race_stage")) {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    if (live.failFinals === "stage") return fail;
    const [, gte, lt] =
      q
        .get("and")
        ?.match(/^\(race_id\.gte\.([^,]+),race_id\.lt\.([^)]+)\)$/) ?? [];
    return q.get("race_stage") === "eq.優勝戦"
      ? finals.stage.filter((r) => r.race_id >= gte && r.race_id < lt)
      : [];
  }
  return finalsResponseNext;
};

const finalsResponse2 = ({ table, q, sel, racers }) => {
  if (table === "race_entries" && /is_absent/.test(sel))
    return finals.entries.filter(
      (r) => inIds(q).includes(r.race_id) && racers.includes(r.racer_id),
    );
  if (table === "race_results" && sel === "race_id,rank1,race_status")
    return finals.results.filter((r) => inIds(q).includes(r.race_id));
  if (table === "races" && /cancellation_status/.test(sel))
    return finals.races.filter((r) => inIds(q).includes(r.race_id));
  if (
    table === "race_start_timings" &&
    sel === "race_id,boat_number,finish_mark"
  )
    return finals.st.filter((r) => inIds(q).includes(r.race_id));
  if (table === "kb_archive_races") {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    return live.kbReadable
      ? finals.kbRaces
      : {
          ok: false,
          status: 401,
          json: async () => ({
            message: "permission denied for table kb_archive_races",
          }),
        };
  }
  if (table === "kb_archive_boats")
    return finals.kbBoats.filter(
      (r) => inIds(q).includes(r.race_id) && racers.includes(r.racer_id),
    );
  return finalsResponseNext;
};

const finalsResponse3 = ({ table, q, sel, fail, racers }) => {
  if (table === "racer_period_stats" && /finals/.test(sel)) {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    if (live.failFinals === "periods") return fail;
    const [, lt, gte] =
      q
        .get("and")
        ?.match(/^\(calc_to\.lt\.([\d-]+),calc_to\.gte\.([\d-]+)\)$/) ?? [];
    return finals.periods
      .filter(
        (r) =>
          racers.includes(r.racer_id) && r.calc_to < lt && r.calc_to >= gte,
      )
      .sort(
        (a, b) =>
          a.racer_id - b.racer_id || b.calc_to.localeCompare(a.calc_to),
      );
  }
  return finalsResponseNext;
};

export const finalsResponse = (table, q) => {
  const sel = q.get("select") ?? "";
  const fail = { ok: false, status: 503, json: async () => ({}) };
  const r2 = finalsResponse1({ table, q, fail });
  if (r2 !== finalsResponseNext) return r2;
  const racers = listParam(q.get("racer_id")).map(Number);
  const r4 = finalsResponse2({ table, q, sel, racers });
  if (r4 !== finalsResponseNext) return r4;
  const r10 = finalsResponse3({ table, q, sel, fail, racers });
  if (r10 !== finalsResponseNext) return r10;
  return undefined;
};

// run の偽の fetch の sb.invalid（偽の DB）の答え（run から分けた。分ける前の if の並びと同じ順。chainsplit.mjs が更に部品に分ける）
// sbAnswer の if の並びを分けた部品。合わなければ sbAnswerNext を返し、sbAnswer が次の部品へ進む（分ける前と同じ順・条件・答え）
export const sbAnswerNext = {};

export const sbAnswer1 = ({ table, q, init, json, ex, fr }) => {
  if (fr !== undefined) return Array.isArray(fr) ? json(fr) : fr;
  if (table === "get_racer_accident_records") {
    rpcBodies.push(JSON.parse(init.body));
    return live.accidentRows === "fail"
      ? { ok: false, status: 503, json: async () => ({}) }
      : json(live.accidentRows);
  }
  if (table === "race_original_exhibition") return json(live.origHeader);
  if (table === "race_original_exhibition_values")
    return json(live.origValues);
  if (table === "losing_technique_stats") {
    seenQueries.push(`${table}?${decodeURIComponent(String(q))}`);
    return json(losingRows);
  }
  if (
    table === "exhibition_data" &&
    q.get("race_id") === `eq.${m.raceId}`
  )
    return json(ex);
  // 選手 4003 の走の展示は偽物だけ（固定の材料のモーターの展示に同じ race_id の実の行がある）
  if (table === "exhibition_data" && live.failExhibition)
    return { ok: false, status: 503, json: async () => ({}) };
  return sbAnswerNext;
};

export const sbAnswer2 = ({ table, q, json, ex, conditions }) => {
  if (table === "exhibition_data")
    return json(
      [
        ...(m.db.motor?.exhibition ?? []).filter(
          (r) => !Object.values(r3).includes(r.race_id),
        ),
        ...scoped3.ex,
      ].filter((r) => inIds(q).includes(r.race_id)),
    );
  // 選手の走の race_conditions（in.(...)）と、このレースの気象（eq.）
  if (
    table === "race_conditions" &&
    q.get("race_id")?.startsWith("in.")
  ) {
    if (live.failConditions)
      return { ok: false, status: 503, json: async () => ({}) };
    return json(
      scoped3.conditions.filter((r) => inIds(q).includes(r.race_id)),
    );
  }
  if (table === "race_conditions")
    return json(conditions === undefined ? [] : [conditions]);
  if (table === "race_entries" && q.get("race_id") === `eq.${m.raceId}`)
    return json(ex.length ? entryRows : []);
  return sbAnswerNext;
};

function scene1() {
  live.origValues = [1, 2, 3, 4, 5].flatMap((n) =>
    [
      ["一周", 37 + n / 10],
      ["まわり足", 5.5 + n / 100],
      ["直線", n === 2 ? null : 7 + n / 100],
    ].map(([kind, value]) => ({
      boat_number: n,
      kind,
      value: value === null ? null : String(value),
      updated_at: `${date}T06:50:00+00:00`,
    })),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（m） */
export function runFullPictureScene2B3(env) {
  ({ m } = env);
  scene1();
}

function scene2() {
  finals = {
    stage: Object.values(Y).map((race_id) => ({ race_id })),
    entries: [
      [Y.y0, 1, 4001],
      [Y.y1, 1, 4001],
      [Y.y1, 2, 4002],
      [Y.y1, 3, 4003],
      [Y.y1, 5, 4005, true],
      [Y.y2, 3, 4001],
      [Y.y2, 2, 4003],
      [Y.y2, 1, 4004],
      [Y.y3, 1, 4001],
      [Y.y4, 1, 4001],
      [Y.y5, 1, 4001],
      [Y.y6, 1, 4001],
    ].map(([race_id, boat_number, racer_id, is_absent = false]) => ({
      race_id,
      boat_number,
      racer_id,
      is_absent,
    })),
    results: [
      [Y.y0, 1],
      [Y.y1, 1],
      [Y.y2, 2],
      [Y.y3, null, "no_race"],
      [Y.y4, 1],
      [Y.y6, 1],
    ].map(([race_id, rank1, race_status = "normal"]) => ({
      race_id,
      rank1,
      race_status,
    })),
    races: Object.values(Y).map((race_id) => ({
      race_id,
      cancellation_status: race_id === Y.y4 ? "confirmed" : null,
    })),
    st: [
      [Y.y1, 1, "1"],
      [Y.y1, 2, "欠"],
      [Y.y1, 3, "F"],
      [Y.y1, 5, "6"],
      [Y.y2, 3, "2"],
      [Y.y2, 2, null],
      [Y.y2, 1, "L"],
    ].map(([race_id, boat_number, finish_mark]) => ({
      race_id,
      boat_number,
      finish_mark,
    })),
    kbRaces: [
      { race_id: "2024-05-05-06-12", has_result: true },
      { race_id: "2023-01-01-07-12", has_result: false },
    ],
    kbBoats: [
      ["2024-05-05-06-12", 1, 4001, "01"],
      ["2024-05-05-06-12", 2, 4002, "S1"],
      ["2024-05-05-06-12", 4, 4003, "K0"],
      ["2023-01-01-07-12", 1, 4001, null],
    ].map(([race_id, boat_number, racer_id, finish_raw]) => ({
      race_id,
      boat_number,
      racer_id,
      finish_raw,
    })),
    // 4001: 5期（2026-10-31 締めはレースの日の後で使わない、5期目の 2024-04-30 は4期の外）/ 4003: 2期だけ / 4004: finals の無い期 / 4005: 4期 / 4002: 期なし
    periods: [
      [4001, 2027, 1, "2026-05-01", "2026-10-31", 9, 9],
      [4001, 2026, 2, "2025-11-01", "2026-04-30", 3, 1],
      [4001, 2026, 1, "2025-05-01", "2025-10-31", 2, 0],
      [4001, 2025, 2, "2024-11-01", "2025-04-30", 1, 1],
      [4001, 2025, 1, "2024-05-01", "2024-10-31", 4, 2],
      [4001, 2024, 2, "2023-11-01", "2024-04-30", 7, 7],
      [4003, 2026, 2, "2025-11-01", "2026-04-30", 1, 0],
      [4003, 2026, 1, "2025-05-01", "2025-10-31", 0, 0],
      [4004, 2026, 2, "2025-11-01", "2026-04-30", null, null],
      [4005, 2026, 2, "2025-11-01", "2026-04-30", 0, 0],
      [4005, 2026, 1, "2025-05-01", "2025-10-31", 1, 0],
      [4005, 2025, 2, "2024-11-01", "2025-04-30", 0, 0],
      [4005, 2025, 1, "2024-05-01", "2024-10-31", 2, 1],
    ].map(
      ([racer_id, period_year, period_no, calc_from, calc_to, fin, wins]) => ({
        racer_id,
        period_year,
        period_no,
        calc_from,
        calc_to,
        starts: 100,
        finals: fin,
        wins,
      }),
    ),
  };
  live.kbReadable = false;
  live.failFinals = null;
}

/** verify から呼ぶ入口。env は verify 側の束縛（m・losingRows） */
export function runFullPictureScene2B4(env) {
  ({ m, losingRows } = env);
  scene2();
}
