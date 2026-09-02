/**
 * 却下フィードバックの恒久反映（閾値エスカレーション）。2026-09-02新設。
 *
 * sns_draftsのrevision_reason_codes（既存スキーマ、X/TikTok・blog/note共通）は
 * DBに保存されるだけで、誰も読み返さなければ属人的なClaudeセッションの
 * 気づきに依存し続ける。この穴を埋めるため:
 *
 * 1. 直近windowDays日以内の却下理由をplatform:reason_code単位で集計する
 * 2. 同じ組み合わせがTHRESHOLD回以上溜まっていれば、Linearに
 *    content-qualityラベル付きIssueを自動起票する（scripts/analysis/
 *    create-vup-linear-ticket.jsと同じGraphQL直叩きパターン）
 * 3. 起票済みの組み合わせは data/analysis/content-quality-audit/
 *    escalations.json に記録し、二重起票を防ぐ
 *
 * 起票されたIssueは既存のcheck-quality-backlog.js（content-qualityラベル
 * 読み取り）が自動的に拾うため、session-start-check.js側の追加実装は不要。
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getRecentRevisions,
  countReasonCodes,
} from "../../lib/contentRevisionHistory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const ESCALATIONS_PATH = path.join(
  REPO_ROOT,
  "data/analysis/content-quality-audit/escalations.json",
);
const LINEAR_API_URL = "https://api.linear.app/graphql";
const THRESHOLD = 3;
const WINDOW_DAYS = 30;
const CONTENT_QUALITY_LABEL = "content-quality";

async function readEscalations() {
  try {
    const raw = await fs.readFile(ESCALATIONS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { escalated: {} };
  }
}

async function writeEscalations(data) {
  await fs.mkdir(path.dirname(ESCALATIONS_PATH), { recursive: true });
  await fs.writeFile(ESCALATIONS_PATH, JSON.stringify(data, null, 2) + "\n");
}

async function graphqlRequest(apiKey, query, variables) {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Linear API error: ${response.status}`);
  }
  const json = await response.json();
  if (json.errors) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }
  return json.data;
}

async function resolveTeamId(apiKey) {
  if (process.env.LINEAR_TEAM_ID) return process.env.LINEAR_TEAM_ID;
  const data = await graphqlRequest(
    apiKey,
    `query { viewer { teams { nodes { id } } } }`,
    {},
  );
  const teams = data?.viewer?.teams?.nodes ?? [];
  if (teams.length === 0) throw new Error("Linearにチームが見つかりません");
  return teams[0].id;
}

async function getLabelId(apiKey, teamId, labelName) {
  const data = await graphqlRequest(
    apiKey,
    `query TeamLabels($teamId: String!) {
      team(id: $teamId) { labels { nodes { id name } } }
    }`,
    { teamId },
  );
  const label = data.team.labels.nodes.find((l) => l.name === labelName);
  return label?.id ?? null;
}

async function createEscalationIssue(
  apiKey,
  { teamId, labelId, title, description },
) {
  const data = await graphqlRequest(
    apiKey,
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }`,
    {
      input: {
        teamId,
        title,
        description,
        labelIds: labelId ? [labelId] : [],
      },
    },
  );
  return data.issueCreate.issue;
}

/**
 * @returns {Promise<{escalated: Array<{key: string, count: number, issueUrl: string}>, checked: number}>}
 */
export async function checkRevisionEscalation({
  threshold = THRESHOLD,
  windowDays = WINDOW_DAYS,
  dryRun = false,
} = {}) {
  const revisions = await getRecentRevisions({ windowDays, limit: 200 });
  const counts = countReasonCodes(revisions);
  const history = await readEscalations();
  history.escalated = history.escalated ?? {};

  const newlyEscalated = [];
  const apiKey = process.env.LINEAR_API_KEY;

  for (const [key, count] of Object.entries(counts)) {
    if (count < threshold) continue;
    if (history.escalated[key]) continue; // 既に起票済み

    if (dryRun || !apiKey) {
      newlyEscalated.push({ key, count, issueUrl: null, skipped: !apiKey });
      continue;
    }

    const [platform, reasonCode] = key.split(":");
    const teamId = await resolveTeamId(apiKey);
    const labelId = await getLabelId(apiKey, teamId, CONTENT_QUALITY_LABEL);
    const examples = revisions
      .filter(
        (r) =>
          r.platform === platform && r.revisionReasonCodes.includes(reasonCode),
      )
      .slice(0, 5)
      .map(
        (r) =>
          `- ${r.title ?? "(無題)"}: ${r.revisionReasonFreetext ?? "(自由記述なし)"}`,
      )
      .join("\n");

    const issue = await createEscalationIssue(apiKey, {
      teamId,
      labelId,
      title: `[content-quality] ${platform}下書きで「${reasonCode}」による修正依頼が${count}件累積`,
      description: `content-multi-channel-pipelineの却下フィードバック閾値エスカレーション（自動起票、check-revision-escalation.js）。\n\n直近${windowDays}日で同一理由による修正依頼が${threshold}件以上溜まりました。生成プロンプト・品質採点基準の見直しを検討してください。\n\n直近の該当下書き（最大5件）:\n${examples}`,
    });

    history.escalated[key] = {
      escalatedAt: new Date().toISOString(),
      issueUrl: issue.url,
      count,
    };
    newlyEscalated.push({ key, count, issueUrl: issue.url });
  }

  if (!dryRun) {
    await writeEscalations(history);
  }

  return { escalated: newlyEscalated, checked: Object.keys(counts).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  checkRevisionEscalation({ dryRun })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(`❌ エラー: ${error.message}`);
      process.exit(1);
    });
}
