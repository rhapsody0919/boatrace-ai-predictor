#!/usr/bin/env node

/**
 * Linear CLI - Claude Code用タスク管理ツール
 *
 * Linearのタスクを作成・更新・取得するためのCLIツールです。
 * Claude Codeから呼び出して、タスク管理を自動化できます。
 *
 * 使用方法:
 *   node scripts/linear-cli.js create "タスクタイトル" "説明"
 *   node scripts/linear-cli.js update BOAT-123 "進行中" "進捗コメント"
 *   node scripts/linear-cli.js list
 *   node scripts/linear-cli.js get BOAT-123
 *
 * 完了したチケットはアーカイブする運用（2026-10-02、ユーザー決定。無料枠の上限は
 * アーカイブしていないチケット数で数えられ、上限に当たると新規起票が止まる）。
 * update で状態の種類（state.type）が completed・canceled に変わったら、続けて
 * issueArchive を呼ぶ。状態名では判定しない（名前は変えられるため）。
 *
 * 失敗はすべて終了コード1で返す（握りつぶさない）。以前は create の失敗に気づけず
 * （USAGE_LIMIT_EXCEEDED、2026-09-28）、起票したつもりで進みかけた。
 * docs/operation/linear-cli.md
 */

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
// 検査（verify-linear-cli.js）で模擬サーバーに向けるため、環境変数で差し替えられる
const LINEAR_API_URL =
  process.env.LINEAR_API_URL || "https://api.linear.app/graphql";

if (!LINEAR_API_KEY) {
  console.error("❌ LINEAR_API_KEY環境変数が設定されていません");
  console.error('💡 設定方法: export LINEAR_API_KEY="your-api-key"');
  console.error("💡 または .env ファイルに LINEAR_API_KEY=your-api-key を追加");
  process.exit(1);
}

/**
 * GraphQLリクエストを送信する。HTTP のエラー・GraphQL の errors はどちらも例外にする。
 * 例外のメッセージには Linear のエラーコード（extensions.code、例 USAGE_LIMIT_EXCEEDED）を含める
 */
async function graphqlRequest(query, variables = {}) {
  if (process.env.DEBUG) {
    console.error(
      "送信データ:",
      JSON.stringify({ query, variables }).substring(0, 500),
    );
  }
  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: LINEAR_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.text();
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error(
      `HTTP ${res.status}: JSON でない応答: ${body.substring(0, 200)}`,
    );
  }
  if (result.errors?.length) {
    const summary = result.errors
      .map((e) => [e.extensions?.code, e.message].filter(Boolean).join(": "))
      .join(" / ");
    throw new Error(`Linear API エラー（HTTP ${res.status}）: ${summary}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body.substring(0, 200)}`);
  }
  return result.data;
}

/**
 * チームIDを取得
 */
async function getTeamId() {
  const query = `
    query {
      viewer {
        id
        name
        teams {
          nodes {
            id
            key
            name
          }
        }
      }
    }
  `;

  const result = await graphqlRequest(query);
  const teams = result?.viewer?.teams?.nodes || [];

  if (teams.length === 0) {
    throw new Error("チームが見つかりません");
  }

  // 最初のチームを使用（複数ある場合は環境変数で指定可能）
  const teamId = process.env.LINEAR_TEAM_ID || teams[0].id;
  const team = teams.find((t) => t.id === teamId) || teams[0];

  return { teamId: team.id, teamKey: team.key, teamName: team.name };
}

/**
 * identifier（例: "BOA-179"）からissueのUUIDを取得
 * LinearのIssueFilterはidentifierフィールドを廃止しているため、
 * team.key + numberの組み合わせで検索する
 */
async function resolveIssueId(identifier) {
  const match = identifier.match(/^([A-Za-z]+)-(\d+)$/);
  if (!match) {
    throw new Error(`不正なタスクID形式です: ${identifier}（例: BOA-123）`);
  }
  const [, teamKey, number] = match;

  const query = `
    query GetIssue($teamKey: String!, $number: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
        nodes {
          id
          identifier
          title
          state {
            id
            name
          }
        }
      }
    }
  `;

  const result = await graphqlRequest(query, {
    teamKey,
    number: Number(number),
  });
  const issues = result?.issues?.nodes || [];

  if (issues.length === 0) {
    throw new Error(`タスク ${identifier} が見つかりません`);
  }

  return issues[0];
}

/**
 * 状態IDを取得
 */
async function getStateId(teamId, stateName) {
  const query = `
    query GetStates($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes {
          id
          name
          type
        }
      }
    }
  `;

  const result = await graphqlRequest(query, { teamId });
  const states = result?.workflowStates?.nodes || [];

  // 状態名で検索（大文字小文字を区別しない）
  const state = states.find(
    (s) => s.name.toLowerCase() === stateName.toLowerCase(),
  );

  if (state) {
    return state.id;
  }

  // 見つからない場合は、デフォルトの状態を返す
  const defaultState = states.find((s) => s.type === "started") || states[0];
  return defaultState?.id || null;
}

/**
 * タスクを作成
 */
async function createIssue(title, description = "", teamId, stateId = null) {
  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          description
          state {
            name
          }
          url
        }
      }
    }
  `;

  const input = {
    teamId,
    title,
    description,
    ...(stateId && { stateId }),
  };

  try {
    const result = await graphqlRequest(mutation, { input });
    if (!result || !result.issueCreate) {
      throw new Error("GraphQLレスポンスが不正です: " + JSON.stringify(result));
    }
    return result.issueCreate;
  } catch (error) {
    console.error("createIssueエラー:", error.message);
    throw error;
  }
}

/**
 * タスクを更新
 */
async function updateIssue(identifier, updates = {}) {
  // まずタスクIDを取得
  const team = await getTeamId();
  const issue = await resolveIssueId(identifier);
  const issueId = issue.id;

  // 状態を更新する場合
  let stateId = null;
  if (updates.state) {
    stateId = await getStateId(team.teamId, updates.state);
  }

  const mutation = `
    mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          state {
            name
            type
          }
        }
      }
    }
  `;

  const input = {};
  if (stateId) {
    input.stateId = stateId;
  }
  if (updates.title) {
    input.title = updates.title;
  }
  if (updates.description !== undefined) {
    input.description = updates.description;
  }

  const result = await graphqlRequest(mutation, {
    id: issueId,
    input,
  });

  return result?.issueUpdate;
}

/**
 * アーカイブする状態の種類（Linear の WorkflowState.type）。Duplicate は Linear では
 * canceled の種類だが、種類として返る可能性に備えて含める
 */
const ARCHIVE_STATE_TYPES = new Set(["completed", "canceled", "duplicate"]);

/**
 * タスクをアーカイブする（issueArchive）
 */
async function archiveIssue(issueId) {
  const mutation = `
    mutation ArchiveIssue($id: String!) {
      issueArchive(id: $id) {
        success
      }
    }
  `;
  const result = await graphqlRequest(mutation, { id: issueId });
  if (!result?.issueArchive?.success) {
    throw new Error(
      `アーカイブに失敗しました: ${JSON.stringify(result?.issueArchive ?? null)}`,
    );
  }
}

/**
 * タスクにコメントを追加
 */
async function addComment(identifier, body) {
  const issue = await resolveIssueId(identifier);
  const issueId = issue.id;

  const mutation = `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
          body
        }
      }
    }
  `;

  const result = await graphqlRequest(mutation, {
    input: {
      issueId,
      body,
    },
  });

  return result?.commentCreate;
}

/** Linear APIが1リクエストで返せる上限 */
const PAGE_SIZE = 100;

/**
 * タスク一覧を取得する。
 *
 * limit が PAGE_SIZE を超える場合はページネーションで繋いで取る。
 * 以前は `first: limit` を1回投げるだけで、Linear APIの上限（250）を
 * 超える指定は Argument Validation Error になり、上限ちょうどの指定は
 * 「それ以上あっても黙って切り捨てられた」。重複チェックや棚卸しのように
 * 「全件見たつもり」で判断する用途では、取りこぼしが結論を誤らせる。
 *
 * なお Linear の issues クエリは既定でアーカイブ済みを含めない。
 * Done/Canceled は一定期間後に自動アーカイブされるため、ここで返るのは
 * 実質「アクティブなIssue」である（2026-09-25時点で204件）。
 */
async function listIssues(limit = 20, stateFilter = null) {
  const team = await getTeamId();

  let filter = { team: { id: { eq: team.teamId } } };
  if (stateFilter) {
    const stateId = await getStateId(team.teamId, stateFilter);
    if (stateId) {
      filter = { ...filter, state: { id: { eq: stateId } } };
    }
  }

  const query = `
    query ListIssues($filter: IssueFilter, $first: Int!, $after: String) {
      issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          identifier
          title
          state {
            name
          }
          updatedAt
          url
        }
      }
    }
  `;

  const nodes = [];
  let after = null;
  while (nodes.length < limit) {
    const first = Math.min(PAGE_SIZE, limit - nodes.length);
    const result = await graphqlRequest(query, { filter, first, after });
    const page = result?.issues?.nodes ?? [];
    nodes.push(...page);
    if (!result?.issues?.pageInfo?.hasNextPage) break;
    after = result.issues.pageInfo.endCursor;
  }
  return nodes;
}

/**
 * タスクの詳細を取得
 */
async function getIssue(identifier) {
  const match = identifier.match(/^([A-Za-z]+)-(\d+)$/);
  if (!match) {
    throw new Error(`不正なタスクID形式です: ${identifier}（例: BOA-123）`);
  }
  const [, teamKey, number] = match;

  const query = `
    query GetIssue($teamKey: String!, $number: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
        nodes {
          id
          identifier
          title
          description
          state {
            name
          }
          createdAt
          updatedAt
          url
        }
      }
    }
  `;

  const result = await graphqlRequest(query, {
    teamKey,
    number: Number(number),
  });
  const issues = result?.issues?.nodes || [];

  if (issues.length === 0) {
    throw new Error(`タスク ${identifier} が見つかりません`);
  }

  return issues[0];
}

/**
 * メイン処理
 */
async function main() {
  const command = process.argv[2];

  try {
    switch (command) {
      case "create": {
        const title = process.argv[3];
        const description = process.argv[4] || "";

        if (!title) {
          console.error("❌ タイトルを指定してください");
          console.error(
            '   使用方法: node scripts/linear-cli.js create "タイトル" "説明"',
          );
          process.exit(1);
        }

        const team = await getTeamId();
        console.log(`📋 チーム: ${team.teamName} (${team.teamKey})`);

        try {
          const result = await createIssue(title, description, team.teamId);

          if (result?.success) {
            const issue = result.issue;
            console.log(`\n✅ タスクを作成しました:`);
            console.log(`   ID: ${issue.identifier}`);
            console.log(`   タイトル: ${issue.title}`);
            console.log(`   状態: ${issue.state.name}`);
            console.log(`   URL: ${issue.url}`);
          } else {
            console.error("❌ タスクの作成に失敗しました");
            console.error("   レスポンス:", JSON.stringify(result, null, 2));
            process.exit(1);
          }
        } catch (createError) {
          console.error("❌ タスク作成中にエラーが発生しました");
          console.error("   エラー:", createError.message);
          if (createError.stack) {
            console.error("   スタック:", createError.stack);
          }
          throw createError;
        }
        break;
      }

      case "update": {
        const identifier = process.argv[3];
        const state = process.argv[4];
        const comment = process.argv[5];

        if (!identifier) {
          console.error("❌ タスクIDを指定してください");
          console.error(
            '   使用方法: node scripts/linear-cli.js update BOAT-123 "状態" "コメント"',
          );
          process.exit(1);
        }

        const updates = {};
        if (state) {
          updates.state = state;
        }

        if (updates.state || comment) {
          let updated = null;
          if (updates.state) {
            const result = await updateIssue(identifier, updates);
            if (result?.success) {
              updated = result.issue;
              console.log(`✅ タスク ${identifier} を更新しました`);
              console.log(`   状態: ${updated.state.name}`);
            } else {
              console.error("❌ タスクの更新に失敗しました");
              process.exit(1);
            }
          }

          if (comment) {
            const commentResult = await addComment(identifier, comment);
            if (commentResult?.success) {
              console.log(`💬 コメントを追加しました`);
            } else {
              console.error("❌ コメントの追加に失敗しました");
              process.exit(1);
            }
          }

          // 完了・取り消しにしたらアーカイブする（無料枠の上限はアーカイブしていない
          // チケット数で数えられる）。コメントを付けた後で行う
          if (updated && ARCHIVE_STATE_TYPES.has(updated.state.type)) {
            await archiveIssue(updated.id);
            console.log(`🗄️ タスク ${identifier} をアーカイブしました`);
          }
        } else {
          console.error("❌ 状態またはコメントを指定してください");
          process.exit(1);
        }
        break;
      }

      case "comment": {
        const identifier = process.argv[3];
        const body = process.argv[4];

        if (!identifier || !body) {
          console.error("❌ タスクIDとコメントを指定してください");
          console.error(
            '   使用方法: node scripts/linear-cli.js comment BOAT-123 "コメント"',
          );
          process.exit(1);
        }

        const result = await addComment(identifier, body);

        if (result?.success) {
          console.log(`✅ コメントを追加しました`);
        } else {
          console.error("❌ コメントの追加に失敗しました");
          process.exit(1);
        }
        break;
      }

      case "list": {
        const stateFilter = process.argv[3];
        const limit = parseInt(process.argv[4]) || 20;

        const issues = await listIssues(limit, stateFilter);

        if (issues.length === 0) {
          console.log("📋 タスクが見つかりませんでした");
        } else {
          console.log(`\n📋 タスク一覧 (${issues.length}件):\n`);
          issues.forEach((issue) => {
            console.log(`  ${issue.identifier}: ${issue.title}`);
            console.log(`    状態: ${issue.state.name}`);
            console.log(`    URL: ${issue.url}\n`);
          });
        }
        break;
      }

      case "get": {
        const identifier = process.argv[3];

        if (!identifier) {
          console.error("❌ タスクIDを指定してください");
          console.error("   使用方法: node scripts/linear-cli.js get BOAT-123");
          process.exit(1);
        }

        const issue = await getIssue(identifier);

        console.log(`\n📋 タスク詳細:\n`);
        console.log(`  ID: ${issue.identifier}`);
        console.log(`  タイトル: ${issue.title}`);
        if (issue.description) {
          console.log(`  説明: ${issue.description}`);
        }
        console.log(`  状態: ${issue.state.name}`);
        console.log(
          `  作成日: ${new Date(issue.createdAt).toLocaleString("ja-JP")}`,
        );
        console.log(
          `  更新日: ${new Date(issue.updatedAt).toLocaleString("ja-JP")}`,
        );
        console.log(`  URL: ${issue.url}\n`);
        break;
      }

      case "help":
      case "--help":
      case "-h":
      default:
        console.log(`
📋 Linear CLI - Claude Code用タスク管理ツール

使用方法:
  node scripts/linear-cli.js <command> [options]

コマンド:
  create <タイトル> [説明]
    タスクを作成します
    例: node scripts/linear-cli.js create "予測機能の実装" "AI予測ロジックを追加"

  update <タスクID> [状態] [コメント]
    タスクを更新します（状態変更とコメント追加）。状態の種類が完了・取り消し
    （Done・Canceled・Duplicate 等）になったら、続けてアーカイブします
    例: node scripts/linear-cli.js update BOAT-123 "進行中" "実装を開始しました"

  comment <タスクID> <コメント>
    タスクにコメントを追加します
    例: node scripts/linear-cli.js comment BOAT-123 "進捗: 50%完了"

  list [状態] [件数]
    タスク一覧を表示します
    例: node scripts/linear-cli.js list "進行中" 10

  get <タスクID>
    タスクの詳細を表示します
    例: node scripts/linear-cli.js get BOAT-123

環境変数:
  LINEAR_API_KEY: Linear APIキー（必須）
  LINEAR_TEAM_ID: チームID（オプション、デフォルトは最初のチーム）

例:
  # タスクを作成
  node scripts/linear-cli.js create "バグ修正" "ログイン機能の不具合を修正"

  # タスクを進行中に変更してコメント追加
  node scripts/linear-cli.js update BOAT-123 "進行中" "実装を開始"

  # タスクにコメントを追加
  node scripts/linear-cli.js comment BOAT-123 "実装完了、テスト中"

  # タスク一覧を表示
  node scripts/linear-cli.js list

  # 特定の状態のタスクを表示
  node scripts/linear-cli.js list "進行中"
`);
        break;
    }
  } catch (error) {
    console.error("❌ エラーが発生しました:", error.message);
    if (process.env.DEBUG || error.message.includes("errors")) {
      console.error("詳細:", error);
    }
    process.exit(1);
  }
}

main();
