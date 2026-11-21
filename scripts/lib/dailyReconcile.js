/**
 * 日次の照合（N29、完了の定義Cの独立した突合先）の、突合の純関数。DB・取得先に接続しない。
 * 日次ジョブ（scripts/lib/dailyReconcileJob.js）が、前日分のDBの行と、公式のKファイル（競走成績）を突き合わせるために使う。
 *
 * 突合の対象（1レースごと）:
 *   結果の有無   K にレースがあるのに race_results が無い（result_missing）、逆に、K に無いのに結果がある（result_not_in_k）
 *   着順         rank1〜3（完走が3艇以上のとき）・rank4〜6。既存の compareRaceWithKDay（raceResultAudit.js）を使う
 *   払戻         race_results の払戻15列（旧列名。payout_trio=3連単・payout_trifecta=3連複）と、K の払戻明細（同着は複数口）
 *   払戻明細     race_payouts（マイグレーション079。2026-09-20 21時台から書かれる）と、K の払戻明細。行があるレースのみ
 *   進入         race_results.actual_course_1〜6（艇番ごとの進入コース）と、K の進入の欄
 *
 * 独立性: rank1〜3・払戻は、結果ページ（boatrace.jp raceresult）から取得した値で、Kファイル（別の公式ファイル）との
 * 突合は独立している。rank4〜6・進入は、Kファイルの同期（kfile_sync）が書いた値のため、Kファイルとの突合は
 * 「同期が完了しているか・書き込みが壊れていないか」の確認で、取得元の誤りは検知できない（同じ元との比較）。
 *
 * 同期待ち: rank4〜6・進入が全て NULL（Kファイル同期の前）は、誤りではなく「同期待ち」として、別に数える
 * （sync_pending）。Kファイル同期（07:00・12:00 JST）が済む前の照合で、誤警告を出さないため。
 *
 * 分類:
 *   照合不能   K が未取得（404）・会場が未展開（プレースホルダ）・Kに会場が無い。不一致に混ぜない
 *   除外       確定中止（races.cancellation_status='confirmed'）。除外した件数を報告する。ただし、Kにそのレースの結果が
 *              あれば、不整合（cancelled_but_in_k）として不一致に数える
 */
import {
  PAYOUT_COLUMNS_BY_KIND,
  compareRaceWithKDay,
  kVenuesToRaceFacts,
} from "./raceResultAudit.js";
import { parseKText } from "./kbFileParser.js";
import { isCancellationConfirmed } from "./cancellationStatus.js";

/** 不一致の種類。SYNC_PENDING_KINDS は「同期待ち」（最終の照合まで、不一致に数えない） */
export const SYNC_PENDING_KINDS = Object.freeze([
  "rank456_unfilled",
  "course_unfilled",
]);

/** last_report に残す不一致の明細の上限（1回の照合。超過分は件数のみ） */
export const MAX_REPORTED_MISMATCHES = 30;

const BOATS = [1, 2, 3, 4, 5, 6];
const UNORDERED_BET_TYPES = new Set(["2fuku", "wide", "3fuku"]);

const isNum = (v) => v !== null && v !== undefined;

/**
 * Kファイルのテキストを、会場ごとの状態とレースごとの確定情報にする。
 *
 * @param {string} text
 * @param {string} date YYYY-MM-DD
 * @returns {{
 *   facts: Map<string, ReturnType<typeof kVenuesToRaceFacts> extends Map<string, infer F> ? F : never>,
 *   completeVenues: Set<number>,
 *   pendingVenues: Set<number>,
 * }}
 */
export function parseKDay(text, date) {
  const { venues } = parseKText(text);
  return {
    facts: kVenuesToRaceFacts(venues, date),
    completeVenues: new Set(
      venues.filter((v) => v.status === "complete").map((v) => v.venue_code),
    ),
    pendingVenues: new Set(
      venues.filter((v) => v.status !== "complete").map((v) => v.venue_code),
    ),
  };
}

/** 組番の正規化（順不同の勝式は、数字を昇順にする） */
export function normalizeCombination(betType, combination) {
  if (combination === null || combination === undefined) return null;
  const parts = String(combination).split("-");
  return UNORDERED_BET_TYPES.has(betType)
    ? [...parts].sort((a, b) => Number(a) - Number(b)).join("-")
    : parts.join("-");
}

const sortNum = (list) => [...list].sort((a, b) => a - b);
const sameList = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * 旧列（race_results の払戻15列）と、Kの払戻明細を突合する。
 *   - K が不成立の勝式: 100（返還額）は refund_payout（compareRaceWithKDay）が扱う。それ以外の値が入っていれば不一致
 *   - K に払われる額（通常・特払）がある勝式: 列の値の集合と一致。K の口数が列の数より多い（同着）ときは、列の値が
 *     Kの額のいずれかであること
 *
 * @returns {Array<{kind: "payout", field: string, db: number[], k: number[]|string}>}
 */
export function comparePayoutColumns(row, fact) {
  const defects = [];
  const noRace = new Set(fact.noRaceKinds);
  for (const [betType, columns] of Object.entries(PAYOUT_COLUMNS_BY_KIND)) {
    const dbAmounts = sortNum(
      columns.map((c) => row[c]).filter((v) => isNum(v)),
    );
    const kAmounts = sortNum(
      fact.payouts
        .filter((p) => p.bet_type === betType && isNum(p.amount))
        .map((p) => p.amount),
    );
    if (kAmounts.length === 0) {
      if (noRace.has(betType)) {
        const others = dbAmounts.filter((v) => v !== 100);
        if (others.length > 0) {
          defects.push({
            kind: "payout",
            field: betType,
            db: others,
            k: "不成立",
          });
        }
      }
      // 払戻の記載が無い勝式（空欄）は、突合しない（返還等でKの形が異なるため）
      continue;
    }
    const ok =
      kAmounts.length <= columns.length
        ? sameList(dbAmounts, kAmounts)
        : dbAmounts.length > 0 && dbAmounts.every((v) => kAmounts.includes(v));
    if (!ok) {
      defects.push({
        kind: "payout",
        field: betType,
        db: dbAmounts,
        k: kAmounts,
      });
    }
  }
  return defects;
}

/**
 * 払戻明細（race_payouts）と、Kの払戻明細を突合する。DBに行があるレースのみ呼ぶ。
 * 払われた行（paid・special）の (勝式, 組番, 払戻) の集合と、不成立の勝式の集合を比べる。
 */
export function comparePayoutTable(payoutRows, fact) {
  const defects = [];
  const paidKey = (betType, combo, amount) =>
    `${betType}|${normalizeCombination(betType, combo) ?? "-"}|${amount}`;
  const dbPaid = payoutRows
    .filter((p) => p.payout_status === "paid" || p.payout_status === "special")
    .map((p) => paidKey(p.bet_type, p.combination, p.payout))
    .sort();
  const kPaid = fact.payouts
    .filter((p) => isNum(p.amount))
    .map((p) => paidKey(p.bet_type, p.combination, p.amount))
    .sort();
  if (!sameList(dbPaid, kPaid)) {
    const only = (a, b) => a.filter((k) => !b.includes(k));
    defects.push({
      kind: "payout_table",
      field: "paid",
      db: only(dbPaid, kPaid),
      k: only(kPaid, dbPaid),
    });
  }
  const dbNoRace = sortStrings(
    payoutRows
      .filter((p) => p.payout_status === "no_race")
      .map((p) => p.bet_type),
  );
  const kNoRace = sortStrings(fact.noRaceKinds);
  if (!sameList(dbNoRace, kNoRace)) {
    defects.push({
      kind: "payout_table",
      field: "no_race",
      db: dbNoRace,
      k: kNoRace,
    });
  }
  return defects;
}
const sortStrings = (list) => [...list].sort();

/**
 * 進入コース（艇番ごと）を突合する。全て NULL は、Kファイル同期の前（course_unfilled=同期待ち）。
 */
export function compareCourses(row, fact) {
  const db = BOATS.map((n) => row[`actual_course_${n}`] ?? null);
  const k = BOATS.map((n) => fact.courses[n] ?? null);
  if (db.every((v) => v === null)) {
    return k.some((v) => v !== null)
      ? [{ kind: "course_unfilled", field: "actual_course", db, k }]
      : [];
  }
  return BOATS.flatMap((n, i) =>
    db[i] === k[i]
      ? []
      : [{ kind: "course", field: `actual_course_${n}`, db: db[i], k: k[i] }],
  );
}

/**
 * 1レースの突合。rank4〜6・進入の「同期待ち」は kind が SYNC_PENDING_KINDS のもの。
 *
 * @param {Record<string, unknown>} row race_results の行
 * @param {Object} fact kVenuesToRaceFacts のレースの確定情報
 * @param {Array<Object>} payoutRows race_payouts の行（無ければ空）
 * @returns {Array<{kind: string, field?: string, db?: unknown, k?: unknown}>}
 */
export function reconcileRace(row, fact, payoutRows = []) {
  const defects = compareRaceWithKDay(row, fact).map((d) => ({
    kind: d.kind,
    field: d.kind === "refund_payout" ? d.bet : "rank",
    db: d.db ?? d.columns ?? null,
    k: d.k ?? null,
  }));
  defects.push(...comparePayoutColumns(row, fact));
  if (payoutRows.length > 0)
    defects.push(...comparePayoutTable(payoutRows, fact));
  defects.push(...compareCourses(row, fact));
  return defects;
}

const finisherLabel = (fact) => `完走${fact.finisherBoats.length}艇`;

/** 結果の有無などの不一致の1件（race_id・kind・db・k の順） */
const mismatchOf = (raceId, kind, db, k) => ({
  race_id: raceId,
  kind,
  db,
  k,
});

/** 1レースの分類の結果。bucket 以外は、集計に足す分だけ */
const outcomeOf = (bucket, extra = {}) => ({
  bucket,
  mismatches: [],
  syncPending: [],
  compared: 0,
  matched: 0,
  bothAbsent: 0,
  ...extra,
});

/** 確定中止。中止と確定しているのに、Kに結果がある（走ったのに中止と判定した）ものは、不整合 */
function classifyCancelled(race, fact) {
  const inK = fact?.hasRows && fact.finisherBoats.length > 0;
  return outcomeOf("excluded", {
    mismatches: inK
      ? [
          mismatchOf(
            race.race_id,
            "cancelled_but_in_k",
            "confirmed",
            finisherLabel(fact),
          ),
        ]
      : [],
  });
}

/** Kの確定した会場に、このレースの結果が無い */
function classifyAbsentFromK(race, row) {
  return row
    ? outcomeOf("noCompare", {
        mismatches: [
          mismatchOf(race.race_id, "result_not_in_k", "あり", "なし"),
        ],
      })
    : outcomeOf("noCompare", { bothAbsent: 1 });
}

/** 結果もKもあるレースの突合。同期待ちは、最後の照合のときだけ不一致に数える */
function classifyCompared(race, row, fact, payoutRows, final) {
  const defects = reconcileRace(row, fact, payoutRows);
  const isPending = (d) => SYNC_PENDING_KINDS.includes(d.kind);
  const pendingDefects = defects.filter(isPending);
  const hard = defects.filter((d) => !isPending(d) || final);
  return outcomeOf("compared", {
    compared: 1,
    mismatches: hard.map((d) => ({ race_id: race.race_id, ...d })),
    syncPending: pendingDefects.map((d) => ({
      race_id: race.race_id,
      kind: d.kind,
    })),
    matched: hard.length === 0 && pendingDefects.length === 0 ? 1 : 0,
  });
}

/** 1レースを、除外・照合不能・突合のどれかに分ける */
function classifyRace(race, ctx) {
  const fact = ctx.kDay.facts.get(race.race_id);
  if (isCancellationConfirmed(race.cancellation_status)) {
    return classifyCancelled(race, fact);
  }
  if (!ctx.kDay.completeVenues.has(race.venue_code)) {
    return outcomeOf(
      ctx.kDay.pendingVenues.has(race.venue_code)
        ? "kVenuePending"
        : "kVenueAbsent",
    );
  }
  const row = ctx.resultById.get(race.race_id);
  if (!fact || !fact.hasRows) return classifyAbsentFromK(race, row);
  if (!row) {
    return outcomeOf("noCompare", {
      mismatches: [
        mismatchOf(race.race_id, "result_missing", "なし", finisherLabel(fact)),
      ],
    });
  }
  return classifyCompared(
    race,
    row,
    fact,
    ctx.payoutsById.get(race.race_id) ?? [],
    ctx.final,
  );
}

const countBy = (list) => {
  const counts = {};
  for (const item of list) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
};

/** race_payouts の行を race_id ごとに束ねる */
function groupPayoutsById(payouts) {
  const payoutsById = new Map();
  for (const p of payouts) {
    if (!payoutsById.has(p.race_id)) payoutsById.set(p.race_id, []);
    payoutsById.get(p.race_id).push(p);
  }
  return payoutsById;
}

/** 1日分の照合の集計（races の順に、分類の結果を足す） */
function foldOutcomes(races, ctx) {
  const acc = {
    excludedCancelled: [],
    unverifiable: { kVenuePending: [], kVenueAbsent: [] },
    mismatches: [],
    syncPending: [],
    compared: 0,
    matched: 0,
    bothAbsent: 0,
  };
  for (const race of races) {
    const o = classifyRace(race, ctx);
    if (o.bucket === "excluded") acc.excludedCancelled.push(race.race_id);
    if (o.bucket === "kVenuePending" || o.bucket === "kVenueAbsent")
      acc.unverifiable[o.bucket].push(race.race_id);
    acc.mismatches.push(...o.mismatches);
    acc.syncPending.push(...o.syncPending);
    acc.compared += o.compared;
    acc.matched += o.matched;
    acc.bothAbsent += o.bothAbsent;
  }
  return acc;
}

/** Kにあるが、DBの races に無いレース（DBの取りこぼし） */
function missingInDb(kDay, raceIds) {
  return [...kDay.facts]
    .filter(([raceId, fact]) => !raceIds.has(raceId) && fact.hasRows)
    .map(([raceId, fact]) =>
      mismatchOf(raceId, "race_missing_in_db", "なし", finisherLabel(fact)),
    );
}

/**
 * 1日分の照合。
 *
 * @param {Object} params
 * @param {string} params.date
 * @param {ReturnType<typeof parseKDay>} params.kDay Kファイルの解析結果
 * @param {Array<{race_id: string, venue_code: number, cancellation_status: string|null}>} params.races races の行
 * @param {Array<Record<string, unknown>>} params.results race_results の行
 * @param {Array<Record<string, unknown>>} params.payouts race_payouts の行（無ければ空）
 * @param {boolean} [params.final] 最後の照合。true なら、同期待ちを不一致に数える
 */
export function reconcileDay({
  date,
  kDay,
  races,
  results,
  payouts = [],
  final = false,
}) {
  const ctx = {
    kDay,
    final,
    resultById: new Map(results.map((r) => [r.race_id, r])),
    payoutsById: groupPayoutsById(payouts),
  };
  const acc = foldOutcomes(races, ctx);
  const mismatches = [
    ...acc.mismatches,
    ...missingInDb(kDay, new Set(races.map((r) => r.race_id))),
  ];
  const { unverifiable } = acc;

  return {
    date,
    racesInDb: races.length,
    excludedCancelled: acc.excludedCancelled.length,
    kVenuesComplete: kDay.completeVenues.size,
    kVenuesPending: [...kDay.pendingVenues].sort((a, b) => a - b),
    unverifiable: {
      total:
        unverifiable.kVenuePending.length + unverifiable.kVenueAbsent.length,
      kVenuePending: unverifiable.kVenuePending.length,
      kVenueAbsent: unverifiable.kVenueAbsent.length,
    },
    bothAbsent: acc.bothAbsent,
    compared: acc.compared,
    matched: acc.matched,
    syncPending: {
      races: new Set(acc.syncPending.map((p) => p.race_id)).size,
      byKind: countBy(acc.syncPending),
    },
    mismatchRaces: new Set(mismatches.map((m) => m.race_id)).size,
    mismatchCount: mismatches.length,
    byKind: countBy(mismatches),
    mismatches: mismatches.slice(0, MAX_REPORTED_MISMATCHES),
    mismatchesTruncated: Math.max(
      0,
      mismatches.length - MAX_REPORTED_MISMATCHES,
    ),
  };
}
