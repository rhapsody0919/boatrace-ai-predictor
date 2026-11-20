/**
 * 思考アシスト（BOA-430）の艇の行・賭式・オッズ・更新の間隔の計算。純粋関数だけ。
 * src/utils/assistModel.js から字のまま移した（呼び出し側は assistModel.js の再 export を読む）。
 */
import { compositeOdds, latestSnapshotWith } from "./oddsMath.js";

const numOrNull = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** v16 の fill_course_st と同じ境目（scripts/ml/analogy/v16_defs.py の MIN_COURSE_RUNS） */
export const MIN_COURSE_RUNS = 5;

/** このコースの走が5走未満で、直近30走で補った値か（v16 の course_n で判定） */
export function courseFilled(courseSt, i) {
  const n = courseSt?.course_n?.[i];
  return (
    courseSt?.course_filled?.[i] != null && (n == null || n < MIN_COURSE_RUNS)
  );
}

/**
 * 艇番ごとの値をそろえる（1〜6号艇の順）。出走表は1段目、v16 の today は届いたら埋める（N-5）
 * @param {{players?: object[], today?: object|null, exhibition?: object[]|null, rates?: object[]|null}} sources
 *   players: getPredictions の players（aiScore 順。艇番は number）
 *   today: v16 facts の today（items・course_st）
 *   exhibition: getRaceExhibitionBasics の行
 *   rates: getRaceEntryOfficialRatesBreakdown の行（f_count）
 */
export function buildRacers({
  players = [],
  today = null,
  exhibition = null,
  rates = null,
}) {
  const byBoat = new Map(players.map((p) => [Number(p.number), p]));
  const exh = new Map((exhibition ?? []).map((e) => [e.boat, e]));
  const rate = new Map((rates ?? []).map((r) => [r.boat_number, r]));
  const item = (key, i) => numOrNull(today?.items?.[key]?.values?.[i]);
  return [1, 2, 3, 4, 5, 6].map((boat, i) => {
    const p = byBoat.get(boat) ?? null;
    const e = exh.get(boat) ?? null;
    const name = p?.name ?? "";
    return {
      boat,
      name,
      surname: name.split(/[\s\u3000]+/)[0] ?? "",
      cls: p?.grade ?? today?.classes?.[i] ?? null,
      natWin: numOrNull(p?.winRate) ?? item("nat_win", i),
      locWin: numOrNull(p?.localWinRate) ?? item("loc_win", i),
      motor2: numOrNull(p?.motor2Rate) ?? item("motor_2", i),
      stMean: item("st_mean30", i),
      // このコースの平均ST は判定（v16 の手がかり）と同じ補った値（course_filled）。古い保存は course のまま
      stCourse: numOrNull(
        (today?.course_st?.course_filled ?? today?.course_st?.course)?.[i],
      ),
      stCourseN: numOrNull(today?.course_st?.course_n?.[i]),
      stCourseFilled: courseFilled(today?.course_st, i),
      seriesScore: item("series_score", i),
      exhTime: e?.time ?? null,
      exhSt: e?.st ?? null,
      exhFlying: e?.startFlag === "F",
      tilt: e?.tilt ?? null,
      racerId: p?.racerId ?? null,
      age: numOrNull(p?.age),
      fCount: numOrNull(rate.get(boat)?.f_count),
      absent: e?.absent === true,
    };
  });
}

// ---- 買い目の表記（固定フッター・マークシート）----

/**
 * 買い目の券種（BOA-990、承認モック docs/design/assist-bet-types/mock/）。並びがタブと「券種で比べる」の行の順
 * （3連単｜3連複｜2連単｜2連複｜拡連複）。
 * legs は使う段の数、ordered は着順を問うか（連複・拡連複は false。組は昇順、表記は「=」）、dataKey は getRaceOddsSnapshots・
 * getRaceFinalOdds のキー、combos は全通りの数（人気の注記）。
 * range は拡連複（BOA-990 ③）: オッズが公式の下限〜上限の幅（{low, high}）。配分・払戻・人気・トリガミは下限で
 * 「その組だけ当たったとき」で出し、合成オッズは出さない（同じレースで最大3組が当たるので式が当てはまらない。承認モック 画面2）
 * 図の「1着人気」は券種によらず、締切前は3連単の合成、締切後は公式の単勝（2026-10-28 オーナー決定。boardModel）
 */
export const ASSIST_BET_TYPES = Object.freeze([
  Object.freeze({
    id: "trifecta",
    legs: 3,
    ordered: true,
    dataKey: "trifectaAll",
    combos: 120,
  }),
  Object.freeze({
    id: "trio",
    legs: 3,
    ordered: false,
    dataKey: "trioAll",
    combos: 20,
  }),
  Object.freeze({
    id: "exacta",
    legs: 2,
    ordered: true,
    dataKey: "exactaAll",
    combos: 30,
  }),
  Object.freeze({
    id: "quinella",
    legs: 2,
    ordered: false,
    dataKey: "quinellaAll",
    combos: 15,
  }),
  Object.freeze({
    id: "wide",
    legs: 2,
    ordered: false,
    range: true,
    dataKey: "wideAll",
    combos: 15,
  }),
]);
export const ASSIST_BET_TYPE_IDS = ASSIST_BET_TYPES.map((t) => t.id);
/** 券種の id → 定義。知らない id は3連単（古い保存・既定） */
export const assistBetType = (id) =>
  ASSIST_BET_TYPES.find((t) => t.id === id) ?? ASSIST_BET_TYPES[0];

/**
 * 拡連複の幅の表（"1-2" → {low, high}）から、計算に使う下限の表（"1-2" → low）を作る。下限の無い組は入れない
 * @param {Record<string, {low: number|null, high: number|null}|null>|null} table
 * @returns {Record<string, number>}
 */
export const wideLowTable = (table) =>
  Object.fromEntries(
    Object.entries(table ?? {})
      .filter(([, v]) => v?.low != null && v.low > 0)
      .map(([k, v]) => [k, v.low]),
  );

/** 拡連複の幅の表から、下限のある組だけを残す（odds と同じ組の集合にする） */
const widePricedRange = (table) =>
  Object.fromEntries(
    Object.entries(table ?? {}).filter(([, v]) => v?.low != null && v.low > 0),
  );

/**
 * 券種の合成オッズ（その券種のオッズの表で、組んだ組の合成）。拡連複（range）は同じレースで最大3組が当たり
 * 合成オッズの式（どれか1組だけ当たる前提）が当てはまらないので null（BOA-990 ③ 承認モック 画面1・2）
 * @param {{range?: boolean}} type ASSIST_BET_TYPES の1つ
 * @param {Record<string, number>|null} odds
 * @param {string[]} tickets
 */
export const betTypeComposite = (type, odds, tickets) =>
  odds && !type.range ? compositeOdds(tickets.map((k) => odds[k])) : null;

/**
 * 券種ごとのオッズを選ぶ（BOA-990）。締切時オッズ（公式）のある券種はその値、無ければその券種の値を持つ最新の
 * スナップショット。どの券種も無ければ null（発売前）。trifecta・capturedAt は3連単の値（図・よく出た3連単が使う）
 * @param {Array<object>} snaps getRaceOddsSnapshots
 * @param {object|null} final getRaceFinalOdds
 * finalWin は公式の単勝の締切時オッズ（race_odds_final.win_all。締切後だけ。図の1着人気）
 * 拡連複（range）は odds に下限の表、range に下限のある組の幅（{low, high}。high は null のことがある）を入れる
 * @returns {null | {byType: Record<string, {odds: Record<string, number>, range?: Record<string, {low: number, high: number|null}>, capturedAt: string, final: boolean}>, trifecta: Record<string, number>|null, capturedAt: string|null, finalWin: Record<string, number>|null}}
 */
export function oddsByBetType(snaps, final) {
  const byType = {};
  const entry = (t, table, capturedAt, isFinal) =>
    t.range
      ? {
          odds: wideLowTable(table),
          range: widePricedRange(table),
          capturedAt,
          final: isFinal,
        }
      : { odds: table, capturedAt, final: isFinal };
  for (const t of ASSIST_BET_TYPES) {
    const f = final?.[t.dataKey];
    if (f) {
      byType[t.id] = entry(t, f, final.capturedAt, true);
      continue;
    }
    const s = latestSnapshotWith(snaps ?? [], t.dataKey);
    if (s) byType[t.id] = entry(t, s[t.dataKey], s.capturedAt, false);
  }
  if (Object.keys(byType).length === 0) return null;
  return {
    byType,
    trifecta: byType.trifecta?.odds ?? null,
    capturedAt: byType.trifecta?.capturedAt ?? null,
    // 公式の単勝の締切時オッズ（締切後だけ。図の1着人気に使う）
    finalWin: final?.win ?? null,
  };
}

/**
 * 1着・2着・3着の候補を「1-23-234」の形に（候補が無い着は「—」）。legs=2 は「1-234」（2連単）。
 * ordered=false（連複）は「1=23=234」（承認モック: 連単は「-」、連複は「=」）
 */
export const betForm = (bets, legs = 3, ordered = true) =>
  [1, 2, 3]
    .slice(0, legs)
    .map((k) => [...bets[k]].sort((a, b) => a - b).join("") || "—")
    .join(ordered ? "-" : "=");

/** 組のキー（"1-2-3"）の表記。連複・拡連複は「1=2=3」 */
export const ticketLabel = (ticket, ordered = true) =>
  ordered ? ticket : ticket.replaceAll("-", "=");

/**
 * 「選んだ艇でボックス」（承認モック 画面3）: どこかの使う段に入れた艇を、使う段すべてにそろえる。使わない段（2連単の3着）は触らない
 * @param {{1: Set<number>, 2: Set<number>, 3: Set<number>}} bets
 * @param {2|3} legs
 */
export function boxBets(bets, legs) {
  const used = [1, 2, 3].slice(0, legs);
  const all = new Set(used.flatMap((k) => [...bets[k]]));
  return {
    ...bets,
    ...Object.fromEntries(used.map((k) => [k, new Set(all)])),
  };
}

/** 合成オッズの表記（モック v7 と同じ小数2桁、丸める前の理論値） */
export const compositeText = (v) => (v == null ? null : v.toFixed(2));

/**
 * 堅い？荒れる？の枠を出せないときの状態（値が出せるときは使わない）。
 * 範囲キー（1号艇の NC・NA）が無いレースは取得しないので「読み込み中」に残さず empty にする
 * @returns {"error"|"empty"|"loading"}
 */
export function roughState({ factsStatus, today, ncStatus, naStatus }) {
  if (factsStatus === "error" || ncStatus === "error" || naStatus === "error")
    return "error";
  if (factsStatus !== "ready") return "loading";
  const keys = today?.scope_keys?.["1"];
  return keys?.NC && keys?.NA ? "loading" : "empty";
}

/** 組んだ買い目にオッズの付いた組が1つでもあるか（無ければ配分を出さず「オッズは発売後に出る」） */
export const hasPricedTicket = (tickets, trifecta) =>
  tickets.some((t) => trifecta?.[t] != null && trifecta[t] > 0);

// ---- オッズの読み直しの時刻（BOA-1180）----

// DB にオッズのスナップショットが入る窓（締切の何分前）。scripts/lib/scrapeJobs/registry.js の odds.offsets と同じ
// （verify-thinking-assist-model.js が一致を検査する）
export const ODDS_SNAPSHOT_WINDOWS_MIN = [60, 30, 15, 10, 5, 0];
// 窓の始まりから DB に入るまでの余裕。2026-10-29〜11-02 の本番の実測で、各窓の取得は窓の始まりの約0.6分後（p95 も同じ）
const ODDS_ARRIVAL_MS = 90_000;
// 入っているはずの窓の値が無いとき、1分おきに読み直す期間（窓の始まりから。取得の許容幅3分＋リース）
const ODDS_LATE_WINDOW_MS = 5 * 60_000;
const ODDS_RETRY_MS = 60_000;
// 締切時オッズ（race_odds_final）を読みにいく時刻（締切の何分後）。同じ実測で締切の5.7〜9.8分後に入る。
// 取れなかった券種は締切60分後まで5分おきに取り直す（registry.js の odds_final）ので、61分後まで読む
const ODDS_FINAL_CHECKS_MIN = [11, 20, 30, 45, 61];
// 発売前（オッズがまだ1つも無い）で -60〜-30 の間は、-60 の窓が発売の開始まで1分ごとに取り直すので、2分おきに読む
const ODDS_PRESALE_POLL_MS = 120_000;

/**
 * 思考アシストのオッズを DB から読み直すまでの時間（ms）。null なら読み直さない。
 * 公式への取得は増やさない（DB に新しいスナップショットが入る時刻に合わせて読み直すだけ）。
 * - 全部の券種の締切時オッズがそろったら終わり。締切の61分後を過ぎても終わり（過去のレースは読み直さない）
 * - もう入っているはずの窓の値が無いとき: 最初の読み込み（キャッシュの古い値かもしれない）はすぐ1回。読み直しの結果なら、
 *   窓の始まりから5分までは1分おきに読む（取得が遅れた窓を、次の窓まで待たない）
 * - それ以外は、次の窓の値が DB に入る時刻・締切時オッズが入る時刻に読み直す
 * @param {number|null} deadlineMs 締切の時刻（getDeadlineDate）
 * @param {number} nowMs
 * @param {{byType?: object, capturedAt?: string|null}|null} data 読んだオッズ（oddsByBetType。締切時オッズの失敗では byType が空のことがある）
 * @param {boolean} [refresh] この data が読み直し（キャッシュを通さない）の結果か
 */
export function nextOddsRefreshDelay(deadlineMs, nowMs, data, refresh = false) {
  if (deadlineMs == null || !Number.isFinite(deadlineMs)) return null;
  const types = Object.values(data?.byType ?? {});
  if (oddsRefreshFinished(deadlineMs, nowMs, types)) return null;
  const arrivalOf = (w) => deadlineMs - w * 60_000 + ODDS_ARRIVAL_MS;
  const candidates = [
    ...ODDS_SNAPSHOT_WINDOWS_MIN.map(arrivalOf),
    ...ODDS_FINAL_CHECKS_MIN.map((m) => deadlineMs + m * 60_000),
  ];
  const passed = ODDS_SNAPSHOT_WINDOWS_MIN.filter((w) => arrivalOf(w) <= nowMs);
  if (passed.length) {
    const windowStart = deadlineMs - passed.at(-1) * 60_000;
    if (windowValueMissing(windowStart, data)) {
      if (!refresh) return 0;
      if (nowMs < windowStart + ODDS_LATE_WINDOW_MS)
        candidates.push(nowMs + ODDS_RETRY_MS);
    }
  }
  if (isOddsPresale(deadlineMs, nowMs, types))
    candidates.push(nowMs + ODDS_PRESALE_POLL_MS);
  const next = Math.min(...candidates.filter((t) => t > nowMs));
  return Number.isFinite(next) ? next - nowMs : null;
}

/** 全部の券種の締切時オッズがそろった・締切の61分後を過ぎた（読み直しを終える） */
function oddsRefreshFinished(deadlineMs, nowMs, types) {
  if (types.length === ASSIST_BET_TYPES.length && types.every((t) => t.final))
    return true;
  return nowMs >= deadlineMs + ODDS_FINAL_CHECKS_MIN.at(-1) * 60_000;
}

/** 入っているはずの窓の値が無い（読んだ値が窓の始まりより前） */
function windowValueMissing(windowStart, data) {
  const capturedMs = data?.capturedAt ? Date.parse(data.capturedAt) : null;
  return capturedMs == null || capturedMs < windowStart;
}

/** 発売前（オッズがまだ1つも無い）で締切の60〜30分前 */
function isOddsPresale(deadlineMs, nowMs, types) {
  return (
    types.length === 0 &&
    nowMs >= deadlineMs - 60 * 60_000 &&
    nowMs < deadlineMs - 30 * 60_000
  );
}
