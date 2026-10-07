/**
 * 会場の決まり手を期間（直近90日・直近365日）ごとに数える（BOA-430 思考アシスト、ADR 0088、マイグレーション 134）。
 * update-winning-technique-stats.js が venue_technique_period_stats に書き、verify-venue-technique-period.js が固定データで確かめる。
 *
 * 期間: 集計日の前日を最終日とし、そこから遡って N 日（両端を含む）。2026-10-06 の集計なら 365日は 2025-10-06〜2026-10-05
 * 数えるレース: 中止・不成立・1着なし・決まり手なしを除く（winning_technique_stats と同じ）。
 * 2025-12-02 以前は長期の表（kb_archive_races）、2025-12-03 以降は新しい表（race_results）から数える。
 * 2025-12-02 は新しい表にも12件あり長期の表と重なるので、新しい表は境目の翌日からだけを読む
 */

export const PERIOD_DAYS = [90, 365];

/** 長期の表（kb_archive_races）で数える最後の日。新しい表はこの翌日から */
export const ARCHIVE_LAST_DATE = "2025-12-02";
export const LIVE_FIRST_DATE = "2025-12-03";

export const VENUE_CODES = Array.from({ length: 24 }, (_, i) => i + 1);

/** YYYY-MM-DD に日数を足す（負も可）。UTC で計算するので時差の影響を受けない */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 集計日 today の N 日の期間 { from, to }（to は前日） */
export function periodRange(today, days) {
  const to = addDays(today, -1);
  return { from: addDays(to, -(days - 1)), to };
}

/**
 * 長期の表と新しい表から読む日付の範囲（最長の期間で決める）。読む必要が無い表は null
 */
export function sourceRanges(today) {
  const { from, to } = periodRange(today, Math.max(...PERIOD_DAYS));
  const min = (a, b) => (a < b ? a : b);
  const max = (a, b) => (a > b ? a : b);
  return {
    archive:
      from <= ARCHIVE_LAST_DATE
        ? { from, to: min(to, ARCHIVE_LAST_DATE) }
        : null,
    live:
      to >= LIVE_FIRST_DATE ? { from: max(from, LIVE_FIRST_DATE), to } : null,
  };
}

/** race_results の行 → { date, venue_code, technique }。数えないレースは null */
export function fromLiveRow(row) {
  if (
    row.is_cancelled === true ||
    row.race_status === "no_race" ||
    row.rank1 === null ||
    row.rank1 === undefined ||
    !row.winning_technique
  )
    return null;
  const date = row.race_id.slice(0, 10);
  if (date < LIVE_FIRST_DATE) return null;
  return {
    date,
    venue_code: Number(row.race_id.slice(11, 13)),
    technique: row.winning_technique,
  };
}

/** kb_archive_races の行 → { date, venue_code, technique }。数えないレースは null */
export function fromArchiveRow(row) {
  if (!row.has_result || !row.technique) return null;
  if (row.race_date > ARCHIVE_LAST_DATE) return null;
  return {
    date: row.race_date,
    venue_code: Number(row.venue_code),
    technique: row.technique,
  };
}

/**
 * 会場ごとの行（venue_technique_period_stats の形）を作る。想定外の決まり手もそのまま行にする（画面で「その他」に寄せる）。
 * 返り値は 1〜24 の全会場のキーを持つ。その期間にレースが無い会場は行が無い（書き込みでは古い行を消すだけになる）
 * @param {Array<{date: string, venue_code: number, technique: string}>} races
 * @param {string} today 集計日（JST、YYYY-MM-DD）
 * @returns {Record<number, Array<object>>}
 */
export function buildPeriodRecords(races, today) {
  const byVenue = Object.fromEntries(VENUE_CODES.map((v) => [v, []]));
  for (const days of PERIOD_DAYS) {
    const { from, to } = periodRange(today, days);
    const counts = new Map(); // venue_code → Map(technique → count)
    for (const r of races) {
      if (r.date < from || r.date > to || !byVenue[r.venue_code]) continue;
      const m = counts.get(r.venue_code) ?? new Map();
      m.set(r.technique, (m.get(r.technique) ?? 0) + 1);
      counts.set(r.venue_code, m);
    }
    for (const [venue, techniques] of counts) {
      const total = [...techniques.values()].reduce((a, b) => a + b, 0);
      for (const [technique, count] of [...techniques].sort()) {
        byVenue[venue].push({
          venue_code: venue,
          period_days: days,
          winning_technique: technique,
          race_count: count,
          total_races: total,
          period_from: from,
          period_to: to,
          last_updated: today,
        });
      }
    }
  }
  return byVenue;
}

/**
 * 書き込み前の検査。問題があれば理由の配列（空なら問題なし）。
 * 期間に長期の表の日付が入るのに長期の表が0件なら失敗にする（新しい表だけを数えた 2,196件の誤りの再発を防ぐ）
 */
export function validateSources({ today, archiveCount, liveCount }) {
  const problems = [];
  const ranges = sourceRanges(today);
  if (ranges.archive && archiveCount === 0)
    problems.push(
      `期間に ${ranges.archive.from}〜${ranges.archive.to}（長期の表）が入るのに、kb_archive_races から1件も読めなかった`,
    );
  if (ranges.live && liveCount === 0)
    problems.push(
      `期間に ${ranges.live.from}〜${ranges.live.to}（新しい表）が入るのに、race_results から1件も読めなかった`,
    );
  return problems;
}

/**
 * 書かれた行の鮮度・形の検査（本番の表を読んだ行に使う）。問題があれば理由の配列。
 * - last_updated が today から2日より古い行がある
 * - 会場×期間で total_races が決まり手の件数の合計と合わない
 * - 会場で 90日の総数が365日の総数を超える（90日 ⊂ 365日）
 */
export function checkStoredRows(rows, today) {
  const problems = [];
  const oldest = addDays(today, -2);
  const stale = rows.filter((r) => r.last_updated < oldest);
  if (stale.length > 0)
    problems.push(
      `last_updated が ${oldest} より古い行が ${stale.length}件ある（最古 ${stale.map((r) => r.last_updated).sort()[0]}）。update-winning-technique-stats が止まっている`,
    );
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.venue_code}:${r.period_days}`;
    const g = groups.get(key) ?? { sum: 0, totals: new Set() };
    g.sum += r.race_count;
    g.totals.add(r.total_races);
    groups.set(key, g);
  }
  for (const [key, g] of groups) {
    if (g.totals.size !== 1 || [...g.totals][0] !== g.sum)
      problems.push(
        `${key}: total_races（${[...g.totals].join("/")}）が決まり手の件数の合計（${g.sum}）と合わない`,
      );
  }
  for (const v of VENUE_CODES) {
    const t90 = groups.get(`${v}:90`)?.sum ?? 0;
    const t365 = groups.get(`${v}:365`)?.sum ?? 0;
    if (t90 > t365)
      problems.push(
        `会場${v}: 90日の総数 ${t90} が365日の総数 ${t365} を超える`,
      );
  }
  return problems;
}
