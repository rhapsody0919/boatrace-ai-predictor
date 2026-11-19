import { groupIntoMeetBeforeRace } from "./meetGrouping.js";

// 期の初めから、前期との差を出さない月数（periodDiffShownFrom）
export const PERIOD_DIFF_WITHHELD_MONTHS = 3;

/**
 * 前期との差を出さずにおく期間の終わり（その日から差を出す、純関数、BOA-439）。
 *
 * 出走表の勝率・2連率は期の区切りで数え直されず、直近の成績を転がして数えた値。
 * 期が替わってしばらくは中身の大半が前期のレースで、前期の確定値との差は
 * 「今期の調子」ではなく集計の窓のずれにすぎない（2026-09-30実測: 前期の確定値との
 * 平均差は、期末の4/30でも0.06、5月0.07〜0.13、9月0.38）。期の初めから3か月は
 * 差を出さず、出走表の値だけを並べる（ファン評価2周目・オーケストレーター判断）。
 *
 * @param {string|null} calcTo 前期の算出期間の終わり（例 "2026-04-30"）
 * @returns {string|null} 差を出し始める日（例 "2026-08-01"）。calcTo が読めなければ null
 */
export function periodDiffShownFrom(calcTo) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(calcTo ?? "");
  if (!m) return null;
  // 算出期間の終わりの翌月が今期の初め。そこから3か月後の1日
  const index =
    Number(m[1]) * 12 + (Number(m[2]) - 1) + 1 + PERIOD_DIFF_WITHHELD_MONTHS;
  const y = Math.floor(index / 12);
  const mo = (index % 12) + 1;
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}

/**
 * 前期と出走表の値の差（純関数、BOA-439）。どちらも公式の値（勝率は点、2連対率は%）。
 * 自社集計の1着率%と混ぜない。どちらかが無ければ null。
 *
 * @param {number|null} prev 前期の値
 * @param {number|string|null} current 出走表の値（race_entries は文字列で返ることがある）
 * @param {number} digits 小数の桁（勝率2・2連対率1）
 * @returns {{current: string, diff: string, sign: -1|0|1}|null}
 */
export function periodDiff(prev, current, digits) {
  if (prev === null || prev === undefined) return null;
  if (current === null || current === undefined || current === "") return null;
  const cur = Number(current);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  // 表示する桁に丸めてから引く。丸める前で引くと「25.6 → 出走表31.3（+5.6）」のように、
  // 画面の数字どうしを引いた値と食い違う
  const scale = 10 ** digits;
  const round = (v) => Math.round(v * scale);
  const d = (round(cur) - round(prev)) / scale;
  const sign = d > 0 ? 1 : d < 0 ? -1 : 0;
  const abs = Math.abs(d).toFixed(digits);
  // 負号は全角のマイナス記号（−）。ハイフンより数字と並べて読みやすい
  return {
    current: (round(cur) / scale).toFixed(digits),
    diff: sign > 0 ? `+${abs}` : sign < 0 ? `−${abs}` : `±${abs}`,
    sign,
  };
}

/** 「直近2年」の優出・優勝に足す期の数（半期×4。BOA-326、ユーザー承認） */
export const RECENT_PERIOD_COUNT = 4;

/**
 * レース日より前に**終わった**期を、新しい順に `count` 個返す（純関数）。
 * 先頭が「前期」。
 *
 * `period_year` Y は「5月〜翌4月の年度」を指し、その中が2つに割れる
 * （本番DBの全15期を実測して確認した。083のCOMMENTの言い換え）:
 *   (Y,1) = (Y-1)-05-01 〜 (Y-1)-10-31
 *   (Y,2) = (Y-1)-11-01 〜     Y-04-30
 * 例: (2026,1)=2025-05-01〜2025-10-31、(2026,2)=2025-11-01〜2026-04-30
 * したがって直前に終わった期は
 *   5〜10月  → (Y,2)   … Y-04-30 に終わった期
 *   11〜12月 → (Y+1,1) … Y-10-31 に終わった期
 *   1〜4月   → (Y,1)   … (Y-1)-10-31 に終わった期
 *
 * @param {string} raceDate `YYYY-MM-DD`
 * @param {number} count
 * @returns {Array<{periodYear: number, periodNo: number, calcFrom: string, calcTo: string}>}
 */
export function periodsEndedBefore(raceDate, count = 1) {
  const [y, m] = (raceDate ?? "").split("-").map(Number);
  if (!y || !m) return [];
  let periodYear = m >= 5 && m <= 10 ? y : m >= 11 ? y + 1 : y;
  let periodNo = m >= 5 && m <= 10 ? 2 : 1;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      periodYear,
      periodNo,
      calcFrom:
        periodNo === 1 ? `${periodYear - 1}-05-01` : `${periodYear - 1}-11-01`,
      calcTo:
        periodNo === 1 ? `${periodYear - 1}-10-31` : `${periodYear}-04-30`,
    });
    if (periodNo === 2) periodNo = 1;
    else {
      periodNo = 2;
      periodYear -= 1;
    }
  }
  return out;
}

/**
 * 公式の出走表が出している期（勝率・平均STの期）を返す（純関数、BOA-815）。
 *   1〜6月  → (Y,1) = (Y-1)-05-01 〜 (Y-1)-10-31
 *   7〜12月 → (Y,2) = (Y-1)-11-01 〜     Y-04-30
 * **渡す日付は節の初日**（無ければレース日）。公式は節の途中で期を替えない。6/27〜7/1 の節の
 * 7/1 は旧期 (Y,1) の値を出す（戸田 2026-07-01 8R で照合。レース日で決めると6艇中4艇が食い違った）。
 * `periodsEndedBefore`（直前に終わった期）とは5〜6月と11〜12月で違う。公式の出走表と
 * 2025-12〜2026-10 の照合結果は docs/design/avg-st-definition/mock/APPROVED.md
 *
 * @param {string} seriesStartDate 節の初日 `YYYY-MM-DD`（取れなければレース日）
 * @returns {{periodYear: number, periodNo: number, calcFrom: string, calcTo: string}|null}
 */
export function officialPeriodOf(seriesStartDate) {
  const [y, m] = (seriesStartDate ?? "").split("-").map(Number);
  if (!y || !m) return null;
  const periodNo = m >= 7 ? 2 : 1;
  return {
    periodYear: y,
    periodNo,
    calcFrom: periodNo === 1 ? `${y - 1}-05-01` : `${y - 1}-11-01`,
    calcTo: periodNo === 1 ? `${y - 1}-10-31` : `${y}-04-30`,
  };
}

// 表示する期（新しい順）。出す期が無ければ null。fallback は前期未取り込み
function periodsToShow(result, raceDate) {
  const all = periodsEndedBefore(raceDate, RECENT_PERIOD_COUNT + 1);
  if (all.length === 0) return null;
  const fallback = result.latestImported === false;
  const periods = fallback ? all.slice(1) : all.slice(0, RECENT_PERIOD_COUNT);
  return { all, fallback, periods };
}

// 直近の期（periods）に含まれる行だけの finals / wins の合計
function recentPeriodTotals(own, periods) {
  const inRecent = own.filter((r) =>
    periods.some(
      (p) => r.period_year === p.periodYear && r.period_no === p.periodNo,
    ),
  );
  const total = (key) => inRecent.reduce((s, r) => s + (r[key] ?? 0), 0);
  return { finals: total("finals"), wins: total("wins") };
}

/**
 * 「前期」（`racer_period_stats`）の1選手分を表示用に整える（純関数）。
 *
 * **指標の列に混ぜない**。`win_rate` は公式勝率（点、実測1.07〜8.24）で、
 * `computeRates` の `winRate`（1着率、%）とは単位が違う。`top3_rate` に
 * 相当する列も無い。呼び出し側は固定3値＋算出期間の別枠として描画する。
 *
 * 優出・優勝（BOA-326）は前期の値と、前期を含む直近4期（2年）の合計を返す。
 * 「通算」ではない（DBは2019年後期以降しか無く、ベテランの通算にならない）。
 * 直近2年の範囲は期の定義から決める（6艇で同じ表記になる）。範囲内に行が
 * 無い期（登録前の新人など）は0回として足す。
 *
 * ## 前期をまだ取り込んでいないとき（期替わり直後）
 *
 * 公式の fan は期の終わりから15〜60日遅れて公開される。その間（`latestImported`
 * が false）は、前々期の値と、前々期で終わる4期の合計を返し、`fallback` を立てる。
 * 判定は表全体（その期の行が1行も無いか）で行う。選手ごとの欠け（長期休場で
 * fan に載らない等）では切り替えない（「公開待ち」と事実と違う注記が出るため）。
 * 遡るのは前々期まで。前々期の行も無ければ null。
 *
 * @param {{rows: Array<Object>, latestImported: boolean}|{state: string, rows: []}} result
 *   `getRacerPeriodStats` の戻り値
 * @param {number|null} racerId
 * @param {string} raceDate `YYYY-MM-DD`。この日より前に終わった期を「前期」とする
 * @returns {{winRate: number|null, top2Rate: number|null, avgSt: number|null,
 *            starts: number|null, calcFrom: string|null, calcTo: string|null,
 *            finals: number|null, wins: number|null,
 *            recent: {finals: number, wins: number, from: string, to: string},
 *            fallback: boolean,
 *            pending: {calcFrom: string, calcTo: string}|null}|null}
 *   表示する期の行が無ければ null（呼び出し側は枠ごと出さない）。
 *   pending は公開待ちの前期の算出期間（fallback のときだけ）
 */
export function pickPeriodStats(result, racerId, raceDate) {
  const rows = result?.rows;
  if (!Array.isArray(rows) || !racerId) return null;
  const shown = periodsToShow(result, raceDate);
  if (!shown) return null;
  const { all, fallback, periods } = shown;
  const [latest] = periods;
  const own = rows.filter((r) => r.racer_id === racerId);
  const row = own.find(
    (r) =>
      r.period_year === latest.periodYear && r.period_no === latest.periodNo,
  );
  if (!row) return null;
  const totals = recentPeriodTotals(own, periods);
  const oldest = periods[periods.length - 1];
  return {
    // 出走0の新人は win_rate が NULL（実測2.6%）。呼び出し側は「—」を出す
    winRate: row.win_rate ?? null,
    top2Rate: row.top2_rate ?? null,
    avgSt: row.avg_st ?? null,
    starts: row.starts ?? null,
    calcFrom: row.calc_from ?? null,
    calcTo: row.calc_to ?? null,
    finals: row.finals ?? null,
    wins: row.wins ?? null,
    recent: {
      finals: totals.finals,
      wins: totals.wins,
      from: oldest.calcFrom,
      to: latest.calcTo,
    },
    fallback,
    pending: fallback
      ? { calcFrom: all[0].calcFrom, calcTo: all[0].calcTo }
      : null,
  };
}

/**
 * 「今節」のタブ（phase a FR-3 / T6-1）に出す走を切り出す（純関数）。
 *
 * **新規取得は0本**。`getRacerScopedRaceStats` が既に持っている走から、
 * 表示中のレースと同じ節のものだけを抜く（plan.md §6.1「FR-3は+0本」）。
 *
 * ## 節の判定
 *
 * 既存の `groupIntoCurrentMeet`（`src/utils/meetGrouping.js`、直前情報タブの
 * 今節展示情報と同じ）に委ねる。日付の間隔が2日以内で連続する区間を1節とみなす。
 *
 * ただしそのままでは2つずれる。
 *
 * 1. **会場で絞る**。`groupIntoCurrentMeet` は日付の連続性しか見ないため、
 *    別会場の節が地続きだと1つの節として繋がる。節は会場単位なので先に絞る
 * 2. **表示中のレースを終端の目印として足してから切り出す**。この関数の呼び出し元は
 *    過去のレースも開く。最新の走から遡る実装なので、目印を足さずに呼ぶと
 *    「表示中のレースより後の節」を今節として返してしまう。初日の朝（その節の
 *    結果がまだ1走も無い）に、前節が今節として出るのも同じ理由で防げる
 *
 * 表示中のレース自体は返さない（結果タブで見られる。ここは「今節のこれまで」）。
 *
 * @param {Array<Object>} records `getRacerScopedRaceStats` の戻り値
 * @param {{raceId: string, venueCode: number|null}} options 表示中のレース
 * @returns {Array<Object>} 日付昇順。`RecentRunsBar` がそのまま描ける形（生のrecord）
 */
export function buildMeetResults(records, { raceId, venueCode }) {
  const all = Array.isArray(records) ? records : [];
  const date = (raceId ?? "").slice(0, 10);
  if (!date || venueCode === null || venueCode === undefined) return [];

  // 会場で絞る・表示中のレースより前だけにする・表示中のレースを目印に足す、の3つは
  // `groupIntoMeetBeforeRace` が行う（直前情報タブの今節展示情報と同じ切り方、BOA-591）
  const candidates = all.map((r) => ({ race_id: r.raceId, record: r }));
  return groupIntoMeetBeforeRace(candidates, raceId).map((m) => m.record);
}

/**
 * 「前走」のST（純関数、BOA-597）。最後の走から遡り、STの無い記号の走
 * （F＝フライング、L＝出遅れ）に当たったらその記号を返す。
 *
 * F・L の走は ST を異常値として落としている（null）ので、「数値のある最後の走」を
 * 採ると**直前のFを飛ばして1つ前の走のST**を「前走」と出してしまう
 * （2026-09-30 平和島11Rの古川誠之: 4RでFなのに「前走 0.09」＝9/29の値）。
 * 欠場など ST も記号も無い走は、今どおり飛ばす。
 *
 * @param {Array<Object>} runs 走った順（古い順）
 * @param {{valueOf: (run: Object) => unknown, markOf: (run: Object) => string|null}} accessors
 *   markOf はその走が F・L なら記号、それ以外は null
 * @returns {{mark: string|null, value: number|null}|null} 該当が無ければ null
 */
export function lastStartTiming(runs, { valueOf, markOf }) {
  const list = Array.isArray(runs) ? runs : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const run = list[i];
    const mark = markOf(run);
    if (mark) return { mark, value: null };
    const value = valueOf(run);
    if (typeof value === "number") return { mark: null, value };
  }
  return null;
}

/** 今節の平均STが通常値とこれだけ違えば「踏んでいる／慎重」と言い切る閾値（秒） */
export const MEET_ST_DIFF_THRESHOLD = 0.01;

/**
 * 今節のSTの判定文に良し悪しの色（緑・赤）を付けるか（race-detail-ui-unify R2）。
 *
 * 判定文そのものは差 0.01 から出るが、色は差が 0.02 以上（表示の2桁で）かつ
 * 今節3走以上のときだけ付ける。0.01 は計測の誤差の範囲で、初日の1走だけの差に
 * 赤の「慎重」を付けると、準優の1号艇まで不必要に疑わせた（PR #1187 ファン評価1周目）
 *
 * @param {number|null} diff 今節の平均ST − 通常の平均ST（負なら早い）
 * @param {number} meetN 今節の走数
 * @returns {"good"|"bad"|null}
 */
export const MEET_ST_COLOR_THRESHOLD = 0.02;
export const MEET_ST_COLOR_MIN_RUNS = 3;
export function meetStVerdictTone(diff, meetN) {
  if (diff === null || diff === undefined || !(meetN >= MEET_ST_COLOR_MIN_RUNS))
    return null;
  const d = Number(diff.toFixed(2));
  if (d <= -MEET_ST_COLOR_THRESHOLD) return "good";
  if (d >= MEET_ST_COLOR_THRESHOLD) return "bad";
  return null;
}
/**
 * 今節の展示**順位**がこれだけ動けば「上向き／下向き」と言い切る閾値（位）。
 *
 * 当初は展示タイムの絶対値（±0.03秒）で判定していたが、**水面の影響を拾って
 * しまう**ことが実測で分かった（桐生の会場平均は2026-09-20〜25で
 * 6.763〜6.865と日によって0.10秒動き、水面が重い日に6艇中5艇へ
 * 「下向き」が出た）。同じレース内の順位なら、その日の水面は相殺される
 */
export const MEET_EXHIBITION_DIFF_THRESHOLD = 1;

const MEET_DAY_MS = 86400000;
const dateOfRaceId = (raceId) => raceId.slice(0, 10);
const dayOfRaceId = (raceId) =>
  Date.parse(`${dateOfRaceId(raceId)}T00:00:00Z`);

// row が last の節の続きか（同じ会場・同じレース名・直前の行と2日以内）
function continuesMeet(last, row) {
  const prevRow = last?.rows.at(-1);
  return (
    last &&
    String(last.venueCode) === String(row.venueCode) &&
    (last.raceTitle ?? null) === (row.raceTitle ?? null) &&
    Math.abs(dayOfRaceId(row.raceId) - dayOfRaceId(prevRow.raceId)) <=
      2 * MEET_DAY_MS
  );
}

function newMeetGroup(row) {
  const date = dateOfRaceId(row.raceId);
  return {
    venueCode: row.venueCode,
    raceTitle: row.raceTitle ?? null,
    raceGrade: row.raceGrade ?? null,
    firstDate: date,
    lastDate: date,
    rows: [row],
  };
}

/**
 * 直近N走・レース一覧の行を、節ごとのまとまりに分ける（BOA-623）。
 * 表は会場・グレード・レース名を節の見出し行に1回だけ出す（同じ節の10行で
 * 同じ名前が並び、375px で表の幅の大半を取っていた）。
 *
 * 隣り合う行が「同じ会場・同じレース名・日付の差が2日以内」なら同じ節とみなす
 * （meetGrouping.js と同じ「2日」）。行の順序（古い順・新しい順）はそのまま保つ。
 *
 * @param {Array<{raceId: string, venueCode: number|string, raceTitle?: string|null,
 *   raceGrade?: string|null}>} rows
 * @returns {Array<{venueCode, raceTitle, raceGrade, firstDate: string, lastDate: string, rows: Array}>}
 *   firstDate / lastDate は日付の古い方・新しい方（YYYY-MM-DD）
 */
export function groupRunsByMeet(rows) {
  const groups = [];
  for (const row of rows ?? []) {
    const last = groups.at(-1);
    if (continuesMeet(last, row)) {
      last.rows.push(row);
      const date = dateOfRaceId(row.raceId);
      if (date < last.firstDate) last.firstDate = date;
      if (date > last.lastDate) last.lastDate = date;
    } else {
      groups.push(newMeetGroup(row));
    }
  }
  return groups;
}
