/**
 * 発売開始の遅れ（想定内の未公開。BOA-386・完了の定義Bの見直し）: 「発走60分前のオッズが、その窓（±3分）の間は
 * まだ公開されていない」を、監視の警告・窓内取得率の欠落として数えないための、定義の正本。
 *
 * 背景（2026-09-22の実測）: オッズの発売開始が、発走60分前の窓より遅いレースがある。各会場のその日の第1レースは、
 * 発走60分前のオッズ（±3分）の取得率が81.5%（88/108）で、それ以外の90.6%（1,066/1,177）より低い。朝の開催会場の
 * 第2レースにも及ぶ（旧基盤も同じ）。これは取得の失敗ではなく、公式側の発売開始の遅れである。毎朝の警告（警告疲れ）と、
 * 完了の定義B（窓内取得率98%以上）の食い潰しになるため、次の2つで扱う（.claude/rules/data-acquisition.md のB）。
 *
 *   1. -60の窓内取得率の分母から除外する。ただし、次の条件を全て満たすものだけ（それ以外は従来どおり）。除外件数は
 *      必ず別に出す（黙って除外しない）。第1レースに限らない（全レース）。
 *        - ジョブ odds の offset_min = -60 のスロット
 *        - 未公開だった。次のどちらか:
 *            延長で取得できた: 完了（ok）していて、完了が窓（期限+3分）より後、かつ、最初の試行は窓の中で行っている
 *              （attempts>=2＝未公開で再試行した）。自分の試行の遅れではなく、発売開始の遅れである根拠は、最初の試行を
 *              窓の中で行ったこと
 *            延長しても取得できなかった: 最後の結果が no_values（試行が1回以上）で、期限+許容幅（延長後）を過ぎている。
 *              後で発売が始まった証拠として、同じレースの後続の窓（-30・-15・-10・-5・0）のどれかが、実際に取得できている
 *        - まだ結論が出ていない間（後続の窓が、期限+許容幅に達していない）は「保留」（警告も欠落も数えない）。
 *          後続の窓が全て過ぎても取れていない（または後続の窓が無い）なら、本当に取れていないため、従来どおり警告する
 *   2. 除外したレースは、別指標「発売開始の検知の遅れ」で評価する。定義: 発売開始後の最初の成功取得の時刻と、その直前の
 *      未公開の試行の時刻の差（＝検知の遅れの上限）。5分以内の割合が98%以上（THRESHOLDS 相当は DETECTION_LAG）。
 *      予定表（scrape_slots）は、スロットごとに、最初・最後の試行の時刻と試行回数だけを持つため、次の近似で測る（測れない
 *      ものは lagMin=null で、計測不能として別に数える）:
 *        延長で取得できた（試行2回）: 最後の試行の時刻 − 最初の試行の時刻（直前の未公開の試行の時刻が、そのまま分かる。正確）
 *        延長で取得できた（試行3回以上）: (最後の試行 − 最初の試行) ÷ (試行回数 − 1)＝平均の試行間隔（直前の試行の時刻は
 *          残らないため。再試行は1分間隔で、取得の遅れ・Cronの欠けがなければ約1分）
 *        延長しても取れず、後続の窓で取得できた: その窓の完了時刻 − 直前の未公開の試行の時刻。直前の未公開の試行は、
 *          その窓が試行2回以上ならその窓の最初の試行（上限）、初回で完了したなら、-60のスロットの最後の試行
 *
 * このモジュールは、監視（monitor.js）とレポート（scripts/analysis/data-health-report.js）が共有する
 * （二重実装しない）。監視・レポートとも scrape_slots の行で、同じ関数を使って判定・計測する。
 * レポートの窓内取得率（race_odds の取得時刻が基準）の除外の判定は、race_odds の取得時刻で、同じ条件の「取れていない・
 * 後続の窓には取れている」を SQL で判定する（laterWindowHitSql。GitHub Actions時代のデータには予定表が無いため）。
 */
import { SCRAPE_JOBS, graceMinFor } from "./registry.js";
import { slotDeadline, slotWindowEnd } from "./time.js";

export const EXPECTED_UNPUBLISHED = Object.freeze({
  job: "odds",
  /** 対象の窓（発走の何分後か。負なら発走前） */
  offsetMin: -60,
  /** 対象の結果（未公開） */
  outcome: "no_values",
  /** 「後で公開された」ことの確認に使う、後続の窓のスロットの結果（データが実際に取れた・既に取れていた） */
  confirmingOutcomes: Object.freeze(["ok", "skipped_have_data"]),
  /** 窓の許容幅（分）。この分以内に完了していれば、窓内（発売開始の遅れではない） */
  toleranceMin: 3,
});

/** 発売開始の検知の遅れの基準（完了の定義B）: 5分以内の割合が98%以上 */
export const DETECTION_LAG = Object.freeze({
  thresholdMin: 5,
  rate: 0.98,
});

/**
 * 後続の窓（対象の窓より発走に近い窓）の offset_min の一覧。レジストリのオッズの窓から導く
 * @param {{offsets: number[]}} oddsDef レジストリの odds 定義
 */
export function laterOffsetsOf(oddsDef) {
  return oddsDef.offsets
    .filter((o) => o > EXPECTED_UNPUBLISHED.offsetMin)
    .sort((a, b) => a - b);
}

/**
 * 会場・日ごとの第1レース（races の最小のレース番号）の race_id の集合。
 * race_number が無い行は無視する。確定中止のレースも、最小の決定には含める
 * （第1レースが中止なら、第2レースを第1レースに繰り上げない）。
 * 想定内の未公開の判定は、第1レースに限らない（全レース）。これは、レポートの内訳（第1レースの件数）の表示用
 *
 * @param {Array<{race_id: string, race_date: string, venue_code: number, race_number: number|null}>} raceRows
 * @returns {Set<string>}
 */
export function firstRaceIdSet(raceRows) {
  const minByVenueDay = new Map();
  for (const row of raceRows) {
    if (typeof row.race_number !== "number") continue;
    const key = `${row.race_date}|${row.venue_code}`;
    const cur = minByVenueDay.get(key);
    if (!cur || row.race_number < cur.race_number) {
      minByVenueDay.set(key, row);
    }
  }
  return new Set([...minByVenueDay.values()].map((r) => r.race_id));
}

// ---------------------------------------------------------------------------
// スロット（scrape_slots の行）による判定・計測（監視とレポートが共有する）
// ---------------------------------------------------------------------------

const MS_PER_MIN = 60000;
const minutesBetween = (later, earlier) =>
  (later.getTime() - earlier.getTime()) / MS_PER_MIN;
const toDate = (value) => (value ? new Date(value) : null);

/** スロットの期限（races の埋め込み行から）。races が無い（削除済み等）なら null */
export function slotDeadlineOf(slot) {
  const race = slot.races;
  if (!race?.start_time || !slot.race_date) return null;
  return slotDeadline(slot.race_date, race.start_time, slot.offset_min);
}

const isCancelledRace = (slot) =>
  slot.outcome === "cancelled_race" ||
  slot.races?.cancellation_status === "confirmed";

export const slotKeyOf = (slot) =>
  `${slot.job}:${slot.race_id}:${slot.offset_min}`;

/**
 * 期限+許容幅（延長後。窓ごとの許容幅）を超えたか（expired、または、claim されないまま pending・リース切れの
 * running で超過）。now が無ければ、expired のみを超過とする
 */
export function isPastWindow(slot, now, registry = SCRAPE_JOBS) {
  if (slot.status === "expired") return true;
  if (!now) return false;
  const deadline = slotDeadlineOf(slot);
  if (!deadline) return false;
  if (
    slot.status === "pending" ||
    (slot.status === "running" &&
      slot.lease_until &&
      new Date(slot.lease_until) < now)
  ) {
    const def = registry[slot.job];
    return (
      Boolean(def) &&
      now.getTime() >
        slotWindowEnd(deadline, graceMinFor(def, slot.offset_min)).getTime()
    );
  }
  return false;
}

/** 対象のスロット（odds の -60）で、live（shadow・確定中止でない）か */
function isTargetSlot(slot) {
  return (
    slot.job === EXPECTED_UNPUBLISHED.job &&
    slot.offset_min === EXPECTED_UNPUBLISHED.offsetMin &&
    slot.run_mode !== "shadow" &&
    !isCancelledRace(slot)
  );
}

/**
 * 延長で取得できた（発売開始が窓の後だった）スロットか: 完了（ok）・試行2回以上・完了が窓（期限+3分）より後・
 * 最初の試行は窓の中（期限+3分以内）で行っている
 */
export function isExtensionSuccess(slot) {
  if (!isTargetSlot(slot)) return false;
  if (slot.status !== "done" || slot.outcome !== "ok") return false;
  if ((slot.attempts ?? 0) < 2) return false;
  const deadline = slotDeadlineOf(slot);
  const doneAt = toDate(slot.done_at);
  const first = toDate(slot.first_attempt_at);
  if (!deadline || !doneAt || !first) return false;
  const tol = EXPECTED_UNPUBLISHED.toleranceMin;
  return (
    minutesBetween(doneAt, deadline) > tol &&
    minutesBetween(first, deadline) <= tol
  );
}

/**
 * 発売開始の遅れ（想定内の未公開）の判定。
 *
 *   confirmed  延長で取得できた（isExtensionSuccess）、または、延長しても取れず（no_values・期限+許容幅を超過・未完了）、
 *              後続の窓（-30・-15…）のどれかが取れている（ok・skipped_have_data）＝後で公開された。警告・欠落に数えない
 *   deferred   まだ結論が出ていない（取れた後続の窓が無く、期限+許容幅に達していない後続の窓がある）。警告も欠落も保留する
 *   （どちらでもない候補、すなわち、後続の窓が全て過ぎても取れていない・後続の窓が無いものは、戻り値に含めず、従来どおり警告する）
 *
 * @param {Array<Object>} slots 候補を含みうるスロット（重複してよい。races を埋め込んだ行）
 * @param {{siblingSlots?: Array<Object>, now?: Date, registry?: typeof SCRAPE_JOBS}} [options]
 *   siblingSlots: 後続の窓のスロットを含むオッズのスロット（races を埋め込んだ行）
 * @returns {Map<string, "confirmed"|"deferred">} key は `${job}:${race_id}:${offset_min}`
 */
export function classifyExpectedUnpublished(
  slots,
  { siblingSlots = [], now, registry = SCRAPE_JOBS } = {},
) {
  /** @type {Map<string, "confirmed"|"deferred">} */
  const result = new Map();
  const rule = EXPECTED_UNPUBLISHED;
  const laterByRace = groupLaterSlots(siblingSlots);
  for (const slot of slots) {
    if (!isTargetSlot(slot)) continue;
    if (isExtensionSuccess(slot)) {
      result.set(slotKeyOf(slot), "confirmed");
      continue;
    }
    if (
      slot.outcome !== rule.outcome ||
      (slot.attempts ?? 0) === 0 ||
      slot.status === "done" ||
      !isPastWindow(slot, now, registry)
    ) {
      continue;
    }
    const later = laterByRace.get(slot.race_id) ?? [];
    if (later.length === 0) continue;
    if (later.some(isConfirmingSlot)) {
      result.set(slotKeyOf(slot), "confirmed");
    } else if (
      later.some((s) => s.status !== "done" && !isPastWindow(s, now, registry))
    ) {
      result.set(slotKeyOf(slot), "deferred");
    }
  }
  return result;
}

/** 後続の窓（対象の窓より後）の live のスロットを、レースごとにまとめる */
function groupLaterSlots(siblingSlots) {
  const rule = EXPECTED_UNPUBLISHED;
  /** @type {Map<string, Array<Object>>} */
  const laterByRace = new Map();
  for (const s of siblingSlots) {
    if (s.job !== rule.job || s.offset_min <= rule.offsetMin) continue;
    if (s.run_mode === "shadow") continue;
    if (!laterByRace.has(s.race_id)) laterByRace.set(s.race_id, []);
    laterByRace.get(s.race_id).push(s);
  }
  return laterByRace;
}

/** 後続の窓のスロットが、公開の確認になるか（データが実際に取れた: ok・skipped_have_data） */
const isConfirmingSlot = (s) =>
  s.status === "done" &&
  EXPECTED_UNPUBLISHED.confirmingOutcomes.includes(s.outcome);

/**
 * 発売開始の検知の遅れ（分）の上限。測れなければ null（計測不能）。近似の方法は、ファイル冒頭の説明
 *
 * @param {Object} slot 対象の -60 のスロット（confirmed のもの）
 * @param {Array<Object>} siblingSlots オッズの後続の窓のスロット
 * @returns {{lagMin: number|null, basis: "extension"|"later_window"}}
 */
export function detectionLagOf(slot, siblingSlots = []) {
  if (isExtensionSuccess(slot)) {
    const first = toDate(slot.first_attempt_at);
    const last = toDate(slot.last_attempt_at);
    const attempts = slot.attempts ?? 0;
    if (!first || !last || attempts < 2) {
      return { lagMin: null, basis: "extension" };
    }
    return {
      lagMin: minutesBetween(last, first) / (attempts - 1),
      basis: "extension",
    };
  }
  const later = (groupLaterSlots(siblingSlots).get(slot.race_id) ?? [])
    .filter((s) => isConfirmingSlot(s) && s.done_at)
    .sort((a, b) => new Date(a.done_at) - new Date(b.done_at));
  const earliest = later[0];
  if (!earliest) return { lagMin: null, basis: "later_window" };
  const previous =
    (earliest.attempts ?? 0) > 1
      ? toDate(earliest.first_attempt_at)
      : toDate(slot.last_attempt_at);
  if (!previous) return { lagMin: null, basis: "later_window" };
  return {
    lagMin: minutesBetween(new Date(earliest.done_at), previous),
    basis: "later_window",
  };
}

/**
 * 除外（confirmed）したスロットの、発売開始の検知の遅れの集計。
 *
 * @param {Array<Object>} slots -60 のスロット（候補を含む。confirmed 以外は無視する）
 * @param {Map<string, "confirmed"|"deferred">} classified classifyExpectedUnpublished の結果
 * @param {Array<Object>} siblingSlots オッズの後続の窓のスロット
 * @returns {{total: number, measured: number, unmeasured: number, within: number, over: number, rate: number|null, p50Min: number|null, p95Min: number|null, maxMin: number|null, byBasis: {extension: number, later_window: number}, overSlots: Array<{race_id: string, lagMin: number, basis: string}>}}
 */
export function summarizeDetectionLags(slots, classified, siblingSlots = []) {
  const seen = new Set();
  const lags = [];
  const byBasis = { extension: 0, later_window: 0 };
  for (const slot of slots) {
    const key = slotKeyOf(slot);
    if (classified.get(key) !== "confirmed" || seen.has(key)) continue;
    seen.add(key);
    const { lagMin, basis } = detectionLagOf(slot, siblingSlots);
    byBasis[basis]++;
    lags.push({ race_id: slot.race_id, lagMin, basis });
  }
  const measuredLags = lags.filter((l) => l.lagMin !== null);
  const sorted = measuredLags.map((l) => l.lagMin).sort((a, b) => a - b);
  const pick = (p) =>
    sorted.length === 0
      ? null
      : sorted[
          Math.min(
            sorted.length,
            Math.max(1, Math.ceil((p / 100) * sorted.length)),
          ) - 1
        ];
  const within = measuredLags.filter(
    (l) => l.lagMin <= DETECTION_LAG.thresholdMin,
  ).length;
  return {
    total: lags.length,
    measured: measuredLags.length,
    unmeasured: lags.length - measuredLags.length,
    within,
    over: measuredLags.length - within,
    rate: measuredLags.length > 0 ? within / measuredLags.length : null,
    p50Min: pick(50),
    p95Min: pick(95),
    maxMin: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    byBasis,
    overSlots: measuredLags.filter(
      (l) => l.lagMin > DETECTION_LAG.thresholdMin,
    ),
  };
}

// ---------------------------------------------------------------------------
// SQL（data-health-report.js の窓内取得率のクエリに埋め込む。レースのエイリアス b・発走時刻の式 dl が前提）
// ---------------------------------------------------------------------------

/**
 * 「その会場・その日の第1レース」のSQLの式（races の最小のレース番号。確定中止も含めて最小を決める。内訳の表示用）
 * @param {string} alias レース（race_date・venue_code・race_number を持つ）のエイリアス
 */
export function firstRaceSql(alias) {
  return `not exists (select 1 from races fr where fr.race_date = ${alias}.race_date and fr.venue_code = ${alias}.venue_code and fr.race_number < ${alias}.race_number)`;
}

/**
 * 「対象の窓より後の、後続の窓のどれかに、オッズが取得できている」のSQLの式
 * （監視の「後続の窓のスロットが done（ok・skipped_have_data）」に対応する。取得できた窓は、
 * 窓の中心（発走の m 分前）±toleranceMin 分に captured_at が入るもの）
 *
 * @param {{raceIdExpr: string, deadlineExpr: string, laterMinutesBefore: number[], toleranceMin: number}} p
 */
export function laterWindowHitSql({
  raceIdExpr,
  deadlineExpr,
  laterMinutesBefore,
  toleranceMin,
}) {
  const windows = laterMinutesBefore
    .map(
      (m) =>
        `o2.captured_at between ${deadlineExpr} - make_interval(mins => ${m + toleranceMin}) and ${deadlineExpr} - make_interval(mins => ${m - toleranceMin})`,
    )
    .join(" or ");
  return `exists (select 1 from race_odds o2 where o2.race_id = ${raceIdExpr} and (${windows}))`;
}
