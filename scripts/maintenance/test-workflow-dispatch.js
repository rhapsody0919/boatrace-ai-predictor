/**
 * GitHub Actions workflow_dispatch API のテストスクリプト
 * 外部 cron トリガーが正しく動作するか確認する
 *
 * 使い方:
 *   GITHUB_PAT=ghp_xxx node scripts/maintenance/test-workflow-dispatch.js
 *
 * 特定のワークフローのみテスト:
 *   GITHUB_PAT=ghp_xxx node scripts/maintenance/test-workflow-dispatch.js exhibition
 *   GITHUB_PAT=ghp_xxx node scripts/maintenance/test-workflow-dispatch.js race
 *   GITHUB_PAT=ghp_xxx node scripts/maintenance/test-workflow-dispatch.js stats
 */

const REPO = "rhapsody0919/boatrace-ai-predictor";
const REF = "master";

const WORKFLOWS = {
  race: { id: 211107021, name: "Scrape Race Data" },
  exhibition: { id: 243971527, name: "Scrape Exhibition Data" },
  stats: { id: 244870991, name: "Aggregate Racer Stats" },
};

async function triggerWorkflow(key, token) {
  const workflow = WORKFLOWS[key];
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow.id}/dispatches`;

  console.log(`\n▶ ${workflow.name} (ID: ${workflow.id})`);
  console.log(`  POST ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "test-workflow-dispatch",
    },
    body: JSON.stringify({ ref: REF }),
  });

  if (res.status === 204) {
    console.log(`  ✅ トリガー成功 (HTTP ${res.status})`);
    return true;
  } else {
    const body = await res.text();
    console.error(`  ❌ トリガー失敗 (HTTP ${res.status}): ${body}`);
    return false;
  }
}

async function main() {
  const token = process.env.GITHUB_PAT;
  if (!token) {
    console.error("❌ GITHUB_PAT 環境変数を設定してください");
    console.error(
      "   GITHUB_PAT=ghp_xxx node scripts/maintenance/test-workflow-dispatch.js",
    );
    process.exit(1);
  }

  const target = process.argv[2];
  const keys = target ? [target] : Object.keys(WORKFLOWS);

  if (target && !WORKFLOWS[target]) {
    console.error(`❌ 不明なワークフロー: ${target}`);
    console.error(`   使用可能: ${Object.keys(WORKFLOWS).join(", ")}`);
    process.exit(1);
  }

  console.log("=== GitHub Actions workflow_dispatch テスト ===");
  console.log(`リポジトリ: ${REPO}`);
  console.log(`ブランチ: ${REF}`);

  let allOk = true;
  for (const key of keys) {
    const ok = await triggerWorkflow(key, token);
    if (!ok) allOk = false;
  }

  console.log("\n" + (allOk ? "✅ すべて成功" : "❌ 一部失敗"));
  process.exit(allOk ? 0 : 1);
}

main();
