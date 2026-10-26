/** M1: 最終 outcome と累積 attempts からの固定ページ数による近似。純粋関数。 */
const ODDS_PATHS = ["oddstf", "odds2tf", "oddsk", "odds3t", "odds3f"];
const JOB_PAGES = {
  odds: ODDS_PATHS,
  odds_final: ODDS_PATHS,
  exhibition: ["beforeinfo"],
  result: ["raceresult"],
  race_info: ["racelist"],
  pcexpect: ["pcexpect"],
  pit_reports: ["pitreport"],
  // 動的なファイル名は同じ取得経路のテンプレートへまとめる（カナリアは含まない）。
  boatcast_oriten: ["/txt/{jo}/bc_oriten_{YYYYMMDD}_{jo}_{RR}.txt"],
  pseudo: [],
};

export const FETCH_COUNT_NOTES = [
  "対象は指定日の scrape_slots（race_date、JSTの開催日）。実際の取得日時別ではありません。",
  "再試行込みの attempts × 固定ページ数の近似。odds・odds_final は5パスへ各1ページ。",
  "取得0の最終 outcome（skipped_*・cancelled_race・breaker_open・budget_exhausted・not_due）は除外。",
  "1ページ確認・partial の不足券種だけの取得を反映せず、最終 outcome による過去試行の除外でも実取得と差が出ます。",
  "politeFetch 内部の再試行・日次ジョブ・ライブ・GHA・BOATCASTのカナリアは含みません。BOATCASTのパスはテンプレートです。",
];

export function validateTargetDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error("対象日は実在する YYYY-MM-DD で指定してください");
  }
  return date;
}

/**
 * 入力は slot 行、または job/status/outcome/target_date ごとに attempts を合算した行。
 * target_date は DB の race_date::text の別名。status によらず実行済みの試行を含む。
 * attempts は各パスに配分した試行数。パス間の合計はジョブの試行総数ではない。
 */
export function dailyFetchCounts(rows, registry, targetDate) {
  validateTargetDate(targetDate);
  const totals = new Map();
  for (const row of rows) {
    if (row.target_date !== targetDate) continue;
    if (!Object.hasOwn(registry, row.job) || registry[row.job].kind !== "window") {
      throw new Error(`窓型ジョブが未定義です: ${row.job}`);
    }
    if (!Object.hasOwn(JOB_PAGES, row.job)) throw new Error(`ページ数が未定義です: ${row.job}`);
    const n = typeof row.attempts === "string" && /^\d+$/.test(row.attempts)
      ? Number(row.attempts) : row.attempts;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("attempts は非負の安全な整数が必要です");
    if (n === 0 || row.outcome?.startsWith("skipped_") ||
        ["cancelled_race", "breaker_open", "budget_exhausted", "not_due"].includes(row.outcome)) continue;
    const host = row.job === "boatcast_oriten" ? "race.boatcast.jp" : "www.boatrace.jp";
    for (const page of JOB_PAGES[row.job]) {
      const path = page.startsWith("/") ? page : `/owpc/pc/race/${page}`;
      const key = `${host}${path}`;
      const total = totals.get(key) ?? { host, path, attempts: 0, pages: 0 };
      total.attempts += n;
      total.pages += n;
      if (!Number.isSafeInteger(total.pages)) throw new Error("集計値が安全な整数の範囲を超えました");
      totals.set(key, total);
    }
  }
  return [...totals.values()].sort((a, b) =>
    a.host < b.host ? -1 : a.host > b.host ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
