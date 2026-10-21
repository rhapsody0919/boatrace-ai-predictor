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
import {
  LinearIssueGateError,
  assertCanCreateIssue,
  slackNotifierFromEnv,
} from "../../lib/linearIssueGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../../..");
const ESCALATIONS_PATH = path.join(
  REPO_ROOT,
  "data/analysis/content-quality-audit/escalations.json",
);
// 検証（verify-revision-escalation-linear-errors.js）で模擬サーバーへ向けるため、環境変数で差し替えられる
const LINEAR_API_URL =
  process.env.LINEAR_API_URL || "https://api.linear.app/graphql";
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

/**
 * HTTP のエラー・GraphQL の errors はどちらも例外にする。例外のメッセージには
 * Linear のエラーコード（extensions.code、例 USAGE_LIMIT_EXCEEDED）を含める。
 * 以前は message だけを拾い、HTTP 400 では本文を読まずに捨てていたため、
 * 無料枠の上限で起票が失敗しても理由が分からなかった（2026-10-18 調査）。
 * 書き方は scripts/linear-cli.js の graphqlRequest に揃える
 */
export async function graphqlRequest(apiKey, query, variables) {
  const response = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(
      `Linear API error: HTTP ${response.status}: JSON でない応答: ${body.substring(0, 200)}`,
    );
  }
  if (json.errors?.length) {
    const summary = json.errors
      .map((e) => [e.extensions?.code, e.message].filter(Boolean).join(": "))
      .join(" / ");
    throw new Error(`Linear API error（HTTP ${response.status}）: ${summary}`);
  }
  if (!response.ok) {
    throw new Error(`Linear API error: HTTP ${response.status}`);
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

/** 起票するIssueのタイトル。件数は含めない（件数が変わると別タイトルになり重複判定をすり抜けるため） */
function escalationTitle(platform, reasonCode) {
  return `[content-quality] ${platform}下書きで「${reasonCode}」による修正依頼が累積`;
}

/**
 * 同じ platform:reasonCode で未完了のIssueが既にあるかを Linear に問い合わせる。
 *
 * 以前は escalations.json（ローカルファイル）だけで二重起票を防いでいたが、
 * このスクリプトを実行する content-ops-nightly-check.yml はそのファイルを
 * コミットしない。GitHub Actionsのランナーは毎回新しいのでファイルは残らず、
 * readEscalations() が常に空を返して「未起票」と判断していた。
 * 結果、2026-09-20から5日連続で同じIssueを起票し、12件の重複が生まれた。
 *
 * 判定の正はLinear側に置く。ファイルのコミット漏れにも並行実行にも強い。
 * タイトルは前方一致で見るので、件数入りの旧タイトル
 * （「…修正依頼が4件累積」）も既存として拾える。
 */
async function findOpenEscalation(apiKey, teamId, platform, reasonCode) {
  const data = await graphqlRequest(
    apiKey,
    `query OpenEscalations($filter: IssueFilter) {
      issues(filter: $filter, first: 100) {
        nodes { identifier title url }
      }
    }`,
    {
      filter: {
        team: { id: { eq: teamId } },
        labels: { name: { eq: CONTENT_QUALITY_LABEL } },
        state: { type: { nin: ["completed", "canceled"] } },
      },
    },
  );
  const prefix = `[content-quality] ${platform}下書きで「${reasonCode}」による修正依頼が`;
  return data.issues.nodes.find((i) => i.title.startsWith(prefix)) ?? null;
}

/**
 * 起票の前に未アーカイブ件数を確かめる（scripts/lib/linearIssueGate.js）。閾値以上・数えられない
 * ときは関所が Slack に件数と閾値を送って LinearIssueGateError を投げる。checkRevisionEscalation はそれを
 * 「保留」として受け、その晩の起票をやめて正常に終わる（2026-10-20 オーナー決定。アーカイブが済むまで毎晩赤にしない）
 */
export async function createEscalationIssue(
  apiKey,
  { teamId, labelId, title, description },
) {
  await assertCanCreateIssue({
    request: (query, variables) => graphqlRequest(apiKey, query, variables),
    notify: slackNotifierFromEnv(process.env),
    source: "check-revision-escalation.js",
  });
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
  // 試験で差し替える（既定は本番の読み書き）
  loadRevisions = getRecentRevisions,
  loadHistory = readEscalations,
  saveHistory = writeEscalations,
} = {}) {
  const revisions = await loadRevisions({ windowDays, limit: 200 });
  const counts = countReasonCodes(revisions);
  const history = await loadHistory();
  history.escalated = history.escalated ?? {};

  const newlyEscalated = [];
  let held = null;
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

    // ローカルの記録より先にLinearを見る（上記 findOpenEscalation のコメント参照）
    const existing = await findOpenEscalation(
      apiKey,
      teamId,
      platform,
      reasonCode,
    );
    if (existing) {
      // 記録が消えていただけの場合に備え、ファイル側も復元しておく
      history.escalated[key] = {
        escalatedAt:
          history.escalated[key]?.escalatedAt ?? new Date().toISOString(),
        issueUrl: existing.url,
        count,
      };
      newlyEscalated.push({
        key,
        count,
        issueUrl: existing.url,
        alreadyOpen: existing.identifier,
      });
      continue;
    }

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

    let issue;
    try {
      issue = await createEscalationIssue(apiKey, {
        teamId,
        labelId,
        title: escalationTitle(platform, reasonCode),
        description: `content-multi-channel-pipelineの却下フィードバック閾値エスカレーション（自動起票、check-revision-escalation.js）。\n\n直近${windowDays}日で同一理由による修正依頼が**${count}件**溜まりました（閾値${threshold}件）。生成プロンプト・品質採点基準の見直しを検討してください。\n\n件数はこの本文にのみ書いています。タイトルに入れると件数が変わるたびに別タイトルになり、重複起票の判定をすり抜けるためです。\n\n直近の該当下書き（最大5件）:\n${examples}`,
      });
    } catch (error) {
      if (!(error instanceof LinearIssueGateError)) throw error;
      // 関所が止めた（Slack には関所が件数と閾値を送った）。記録に残さず、次の晩にもう一度数える。
      // 同じ晩の残りの組み合わせも同じ理由で止まるので、ここで打ち切る（通知を1晩1回にする）
      held = { key, count, reason: error.message };
      break;
    }

    history.escalated[key] = {
      escalatedAt: new Date().toISOString(),
      issueUrl: issue.url,
      count,
    };
    newlyEscalated.push({ key, count, issueUrl: issue.url });
  }

  if (!dryRun) {
    await saveHistory(history);
  }

  return {
    escalated: newlyEscalated,
    checked: Object.keys(counts).length,
    ...(held ? { held } : {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  checkRevisionEscalation({ dryRun })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      // 関所で止めたときは保留（exit 0）。Slack への件数と閾値の通知は関所が送った
      if (result.held)
        console.log(`保留: Linear の起票を止めた（${result.held.reason}）`);
    })
    .catch((error) => {
      console.error(`❌ エラー: ${error.message}`);
      process.exit(1);
    });
}
