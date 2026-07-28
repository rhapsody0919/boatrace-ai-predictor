/**
 * Linearチケットをラベル付きで作成する（VUP機能提案用）
 *
 * 分析・チケット文面の作成はClaude自身が行う
 * （.claude/commands/create-vup-ticket.md 参照）。このスクリプトは
 * Linear APIへの登録のみを担当する。
 *
 * 使い方:
 *   node scripts/analysis/create-vup-linear-ticket.js path/to/ticket.json
 *
 * ticket.json の形式:
 *   {
 *     "title": "...",
 *     "description": "...",
 *     "labels": ["proposal", "vup-feature"],
 *     "estimate": 5
 *   }
 *
 * 必要な環境変数: LINEAR_API_KEY（LINEAR_TEAM_ID未設定時はAPIからチーム一覧を取得して
 * 最初のチームを使用する。scripts/linear-cli.js と同じ方式）
 */
import * as fs from "fs";

const LINEAR_API_URL = "https://api.linear.app/graphql";

async function graphqlRequest(query, variables) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("LINEAR_API_KEY環境変数が設定されていません");
  }

  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
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

// LINEAR_TEAM_ID未設定時はAPIからチーム一覧を取得し最初のチームを使う（linear-cli.js と同じ方式）
async function resolveTeamId() {
  if (process.env.LINEAR_TEAM_ID) {
    return process.env.LINEAR_TEAM_ID;
  }
  const data = await graphqlRequest(
    `query { viewer { teams { nodes { id } } } }`,
    {},
  );
  const teams = data?.viewer?.teams?.nodes ?? [];
  if (teams.length === 0) {
    throw new Error("Linearにチームが見つかりません");
  }
  return teams[0].id;
}

// チーム内のラベル名 → ラベルIDのマップを取得
async function getTeamLabels(teamId) {
  const data = await graphqlRequest(
    `query TeamLabels($teamId: String!) {
      team(id: $teamId) {
        labels {
          nodes { id name }
        }
      }
    }`,
    { teamId },
  );
  return new Map(data.team.labels.nodes.map((l) => [l.name, l.id]));
}

async function createVupLinearTicket(ticket) {
  const teamId = await resolveTeamId();

  const labelMap = await getTeamLabels(teamId);
  const labelIds = [];
  const missingLabels = [];
  for (const name of ticket.labels ?? []) {
    const id = labelMap.get(name);
    if (id) {
      labelIds.push(id);
    } else {
      missingLabels.push(name);
    }
  }
  if (missingLabels.length > 0) {
    console.warn(
      `⚠️ Linearに存在しないラベルはスキップしました: ${missingLabels.join(", ")}`,
    );
  }

  const data = await graphqlRequest(
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }`,
    {
      input: {
        teamId,
        title: ticket.title,
        description: ticket.description,
        labelIds,
        estimate: ticket.estimate,
      },
    },
  );

  return data.issueCreate.issue;
}

const ticketPath = process.argv[2];
if (!ticketPath) {
  console.error(
    "使用方法: node create-vup-linear-ticket.js path/to/ticket.json",
  );
  process.exit(1);
}

const ticket = JSON.parse(fs.readFileSync(ticketPath, "utf-8"));

try {
  const issue = await createVupLinearTicket(ticket);
  console.log(`✅ チケット作成成功！`);
  console.log(`📋 チケットID: ${issue.identifier}`);
  console.log(`🔗 URL: ${issue.url}`);
  console.log(`📝 タイトル: ${issue.title}`);
} catch (error) {
  console.error(`❌ エラー: ${error.message}`);
  process.exit(1);
}
