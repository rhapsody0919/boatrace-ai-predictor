/**
 * BOA-271 アナロジー・ファインダー: GitHub Actions の workflow_dispatch を Vercel Cron から起動する（学習側 T10-7）。
 * GitHub Actions の schedule は遅れ・欠落が常態なので使わない（ADR-0080）。
 *
 * - train: 週次の学習（train-analogy.yml）。日曜 JST 4:00
 * - dailyFeatures: 日次の特徴量（analogy-daily-features.yml）。JST 6:40・9:40・13:40 は無条件に起動する。
 *   JST 7:00〜7:59 の起動（7:20 の拾い直し）は、今日の対象レースのうち analogy_race_features に行が1つも無い
 *   レースがあるときだけ起動する。対象が0件なら「充足」とせず失敗にする（朝の初期化の遅れ）
 *
 * 対象レースの定義は scripts/ml/analogy/daily_features.py の select_targets と同じ（締切まで10分以上、
 * 開催中止でない、欠場が分かっていない。発走時刻の無いレースは対象にしない）。
 *
 * 失敗（トークン未設定・dispatch の HTTP 失敗・対象0件）は outcome:"error" で返す。レジストリの
 * failureAlertAfter: 1 により、scrape-monitor が1回目の失敗から Slack に出す。
 * shadow は起動せず、起動するはずだったかだけを返す。
 */
import {
  jstMinutesOfDay,
  raceStartInstant,
  toJstDateString,
} from "./scrapeJobs/time.js";

export const GITHUB_REPO = "rhapsody0919/boatrace-ai-predictor";
export const MIN_LEAD_MINUTES = 10;
const RECHECK_FROM_MIN = 7 * 60;
const RECHECK_TO_MIN = 8 * 60;

export const DISPATCH_WORKFLOWS = Object.freeze({
  train: { workflow: "train-analogy.yml", inputs: {} },
  dailyFeatures: { workflow: "analogy-daily-features.yml", inputs: {} },
});

/** JST 7:00〜7:59 の起動は拾い直し（欠けがあるときだけ起動する） */
export const isRecheckRun = (now) => {
  const m = jstMinutesOfDay(now);
  return m >= RECHECK_FROM_MIN && m < RECHECK_TO_MIN;
};

/** daily_features.py の select_targets と同じ規則 */
export function selectTargets(races, absentRaceIds, now) {
  return races
    .filter((r) => {
      if (!r.start_time) return false;
      const lead = raceStartInstant(r.race_date, r.start_time) - now;
      if (lead < MIN_LEAD_MINUTES * 60 * 1000) return false;
      return (
        r.cancellation_status !== "confirmed" && !absentRaceIds.has(r.race_id)
      );
    })
    .map((r) => r.race_id)
    .sort();
}

async function readAll(client, table, select, apply) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(
      client.from(table).select(select),
    ).range(from, from + 999);
    if (error) throw new Error(`${table} の読み取りに失敗: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** 今日の対象レースと、そのうち analogy_race_features に行が無いレース */
export async function findMissingRaces(client, now) {
  const today = toJstDateString(now);
  const races = await readAll(
    client,
    "races",
    "race_id,race_date,start_time,cancellation_status",
    (q) => q.eq("race_date", today).order("race_id"),
  );
  const absent = await readAll(client, "race_entries", "race_id", (q) =>
    q
      .eq("is_absent", true)
      .like("race_id", `${today}%`)
      .order("race_id")
      .order("boat_number"),
  );
  const targets = selectTargets(
    races,
    new Set(absent.map((r) => r.race_id)),
    now,
  );
  const have = await readAll(client, "analogy_race_features", "race_id", (q) =>
    q.like("race_id", `${today}%`).order("race_id").order("boat_number"),
  );
  const haveIds = new Set(have.map((r) => r.race_id));
  return { targets, missing: targets.filter((id) => !haveIds.has(id)) };
}

export async function dispatchWorkflow({ fetchImpl, token, workflow, inputs }) {
  const res = await fetchImpl(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "master", inputs }),
    },
  );
  // 成功は 204（本文なし）。2xx 以外は失敗
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${workflow} の dispatch が HTTP ${res.status}: ${text.slice(0, 200)}`,
    );
  }
}

/**
 * @param {"train"|"dailyFeatures"} target
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [deps]
 */
export function createAnalogyDispatchRun(
  target,
  { fetchImpl = fetch, env = process.env } = {},
) {
  const def = DISPATCH_WORKFLOWS[target];
  if (!def) throw new Error(`不明な dispatch の対象: ${target}`);
  return async (ctx) => {
    const now = ctx.now();
    const report = { target, workflow: def.workflow };
    if (target === "dailyFeatures" && isRecheckRun(now)) {
      const { targets, missing } = await findMissingRaces(ctx.client, now);
      Object.assign(report, {
        recheck: true,
        targets: targets.length,
        missing: missing.length,
        missingSample: missing.slice(0, 5),
      });
      if (targets.length === 0) {
        return {
          outcome: "error",
          error: `今日（${toJstDateString(now)}）の特徴量の対象レースが0件（races の朝の初期化の遅れの可能性）。充足とはしない`,
        };
      }
      if (missing.length === 0) {
        return {
          rowsWritten: 0,
          report: { ...report, dispatched: false },
          body: report,
        };
      }
    }
    if (ctx.mode !== "live") {
      return {
        rowsWritten: 0,
        report: { ...report, dispatched: false, wouldDispatch: true },
        body: { ...report, wouldDispatch: true },
      };
    }
    const token = env.GITHUB_ACTIONS_DISPATCH_TOKEN;
    if (!token) {
      return {
        outcome: "error",
        error: "GITHUB_ACTIONS_DISPATCH_TOKEN が未設定（Vercel の環境変数）",
      };
    }
    try {
      await dispatchWorkflow({
        fetchImpl,
        token,
        workflow: def.workflow,
        inputs: def.inputs,
      });
    } catch (error) {
      return { outcome: "error", error: error.message };
    }
    return {
      rowsWritten: 0,
      report: { ...report, dispatched: true },
      body: { ...report, dispatched: true },
    };
  };
}
