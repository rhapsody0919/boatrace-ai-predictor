/**
 * e2e-recording-collect.js - scripts/maintenance/e2e-recording.js の collectTodayRuns（notify-dedupe・gate の入力）の確かめ（verify の部品）。
 * 本文の字は読まず、偽の gh api を渡して問い合わせた endpoint と戻りで見る。GitHub には繋がない。
 * check は verify-e2e-har-merge.js の check(label, actual, expected)。
 */
import { collectTodayRuns } from "../e2e-recording.js";

export function checkCollectTodayRuns(check) {
  const asked = [];
  const gh = (endpoint) => {
    asked.push(endpoint);
    return endpoint.endsWith("/jobs")
      ? { jobs: [] }
      : { workflow_runs: [{ id: 7, created_at: "2026-11-20T01:00:00Z" }] };
  };
  const repo = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "o/r";
  let runs;
  try {
    runs = collectTodayRuns(new Date("2026-11-20T03:00:00Z"), { gh });
  } finally {
    if (repo === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = repo;
  }
  const [listPath, listQuery = ""] = (asked[0] ?? "").split("?");
  const q = new URLSearchParams(listQuery);
  check(
    "notify-dedupe の runs の取得は event で絞らず、master だけを見る（JST の今日の0時から）。run ごとに job を読む",
    [
      listPath,
      q.get("branch"),
      q.has("event"),
      q.get("created"),
      asked.slice(1),
      runs,
    ],
    [
      "repos/o/r/actions/workflows/e2e-rerecord.yml/runs",
      "master",
      false,
      ">=2026-11-19T15:00:00.000Z",
      ["repos/o/r/actions/runs/7/jobs"],
      [
        {
          id: 7,
          createdAt: "2026-11-20T01:00:00Z",
          notified: false,
          recordCancelled: false,
        },
      ],
    ],
  );
}
