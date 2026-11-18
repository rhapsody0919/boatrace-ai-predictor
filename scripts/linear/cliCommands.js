/**
 * scripts/linear-cli.js のコマンド（create・update・comment・list・get・help）。linear-cli.js の main（233行・複雑さ38）を
 * コマンドごとに分け、ファイルの行を増やさないためここへ移した。本文は元の main のまま（process.argv は argv、
 * Linear の API の関数は api で受ける）。失敗はすべて終了コード1で返す（握りつぶさない）
 */

/** create <タイトル> [説明]。起票の前に未アーカイブ件数を数える（createIssue の中） */
async function runCreate(argv, api) {
  const title = argv[3];
  const description = argv[4] || "";

  if (!title) {
    console.error("❌ タイトルを指定してください");
    console.error(
      '   使用方法: node scripts/linear-cli.js create "タイトル" "説明"',
    );
    process.exit(1);
  }

  const team = await api.getTeamId();
  console.log(`📋 チーム: ${team.teamName} (${team.teamKey})`);

  try {
    const result = await api.createIssue(title, description, team.teamId);

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
}

/** update <タスクID> [状態] [コメント]。状態の種類が完了・取り消しになったらアーカイブする */
async function runUpdate(argv, api) {
  const identifier = argv[3];
  const state = argv[4];
  const comment = argv[5];

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
      const result = await api.updateIssue(identifier, updates);
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
      const commentResult = await api.addComment(identifier, comment);
      if (commentResult?.success) {
        console.log(`💬 コメントを追加しました`);
      } else {
        console.error("❌ コメントの追加に失敗しました");
        process.exit(1);
      }
    }

    // 完了・取り消しにしたらアーカイブする（無料枠の上限はアーカイブしていない
    // チケット数で数えられる）。コメントを付けた後で行う
    if (updated && api.ARCHIVE_STATE_TYPES.has(updated.state.type)) {
      await api.archiveIssue(updated.id);
      console.log(`🗄️ タスク ${identifier} をアーカイブしました`);
    }
  } else {
    console.error("❌ 状態またはコメントを指定してください");
    process.exit(1);
  }
}

/** comment <タスクID> <コメント> */
async function runComment(argv, api) {
  const identifier = argv[3];
  const body = argv[4];

  if (!identifier || !body) {
    console.error("❌ タスクIDとコメントを指定してください");
    console.error(
      '   使用方法: node scripts/linear-cli.js comment BOAT-123 "コメント"',
    );
    process.exit(1);
  }

  const result = await api.addComment(identifier, body);

  if (result?.success) {
    console.log(`✅ コメントを追加しました`);
  } else {
    console.error("❌ コメントの追加に失敗しました");
    process.exit(1);
  }
}

/** list [状態] [件数] */
async function runList(argv, api) {
  const stateFilter = argv[3];
  const limit = parseInt(argv[4]) || 20;

  const issues = await api.listIssues(limit, stateFilter);

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
}

/** get <タスクID> */
async function runGet(argv, api) {
  const identifier = argv[3];

  if (!identifier) {
    console.error("❌ タスクIDを指定してください");
    console.error("   使用方法: node scripts/linear-cli.js get BOAT-123");
    process.exit(1);
  }

  const issue = await api.getIssue(identifier);

  console.log(`\n📋 タスク詳細:\n`);
  console.log(`  ID: ${issue.identifier}`);
  console.log(`  タイトル: ${issue.title}`);
  if (issue.description) {
    console.log(`  説明: ${issue.description}`);
  }
  console.log(`  状態: ${issue.state.name}`);
  console.log(`  作成日: ${new Date(issue.createdAt).toLocaleString("ja-JP")}`);
  console.log(`  更新日: ${new Date(issue.updatedAt).toLocaleString("ja-JP")}`);
  console.log(`  URL: ${issue.url}\n`);
}

const HELP_TEXT = `
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
`;

const COMMANDS = new Map([
  ["create", runCreate],
  ["update", runUpdate],
  ["comment", runComment],
  ["list", runList],
  ["get", runGet],
]);

/** argv（process.argv の形）の argv[2] のコマンドを回す。知らないコマンド・help は使い方を出す */
export async function runLinearCommand(argv, api) {
  const run = COMMANDS.get(argv[2]);
  if (run) await run(argv, api);
  else console.log(HELP_TEXT);
}
