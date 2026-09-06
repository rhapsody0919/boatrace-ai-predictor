/**
 * SNSマーケティングハブ用の共有ヘルパー（api/admin/sns-hub/配下の複数ハンドラーから利用）
 * ファイル名に`_`prefixを付けたディレクトリはVercelのルーティング対象外になる。
 */

export const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

export const SNS_HUB_STORAGE_BUCKET = "sns-hub-media";

/**
 * sns-hub-media（非公開バケット）内の複数パスをまとめて署名付きURLに変換する。
 * `sns_drafts.video_storage_path`/`cover_image_path`は生のStorageパスを保存する
 * 規約（2026-09-03確定、下記参照）のため、実際にfetchする側は必ずこの関数で
 * 署名してから使う。
 *
 * 2026-09-03、コードレビューで発覚した不具合の修正: 以前は生成Routine側が
 * `createSignedUrl()`で発行した署名付きURLをそのまま列に保存する運用だったが、
 * `drafts/index.js`（管理画面の一覧取得）は列の値を生パスとして扱い読み取り時に
 * 再署名する設計だったため、両者の前提が食い違い「動画準備中」表示のまま
 * 進めなくなっていた。生パス保存・都度署名に統一し、この関数を両方の呼び出し元
 * （`drafts/index.js`・`publish-youtube.js`）で共有する。
 *
 * @param {string[]} paths - バケット相対の生パス（例: `{content_group_id}/x-ja.mp4`）
 * @param {number} [expiresIn] - 秒数、既定1時間
 * @returns {Promise<Record<string, string>>} path -> 署名付きURLのマップ（署名失敗分は含まれない）
 */
export async function signStoragePaths(paths, expiresIn = 3600) {
  if (!paths || paths.length === 0) return {};

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${SNS_HUB_STORAGE_BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn, paths }),
    },
  );

  if (!response.ok) {
    console.error(`Storage署名エラー: ${response.status}`);
    return {};
  }

  const results = await response.json();
  const map = {};
  for (const r of results) {
    if (r.signedURL) {
      map[r.path] = `${SUPABASE_URL}/storage/v1${r.signedURL}`;
    }
  }
  return map;
}

/** 単一パスを署名付きURLに変換する。見つからない/失敗した場合はnull */
export async function signStoragePath(path, expiresIn = 3600) {
  if (!path) return null;
  const map = await signStoragePaths([path], expiresIn);
  return map[path] || null;
}

export const SITE_BASE_URL = "https://www.boat-ai.jp";

/**
 * `cover_image_path`をブラウザで表示可能なURLに変換する。
 *
 * blog/noteチャネルは`docs/operation/sns-pipeline-blog.md`/`sns-pipeline-note.md`の
 * 設計により、Supabase Storageにアップロードせず`public/images/blog/{slug}.jpg`
 * （リポジトリにコミット済みの静的アセット、本番では`{SITE_BASE_URL}/images/blog/{slug}.jpg`
 * として配信される）をそのまま`cover_image_path`に記録する。X/TikTok/YouTubeは
 * `{content_group_id}/x-ja.jpg`のようなsns-hub-media（Storage）内の生パスを使う。
 * 両者は同じ列に異なる種類のパスが混在するため、形状で判定して分岐する
 * （2026-09-05発覚: この分岐が無く全パスをStorage署名対象として扱っていたため、
 * blog/noteのカバー画像プレビュー・ダウンロードボタンが常に表示されない不具合が
 * あった。承認済み下書きの画像はブログPRマージ後に本番へ反映されるため、
 * マージ前（pending_review）はまだ404になりうる制約が残る）
 */
export function resolvePublicAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith("public/")) {
    return `${SITE_BASE_URL}/${path.slice("public/".length)}`;
  }
  return null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * URLパスから抽出したIDがUUID形式か検証する（draft/insight等どのエンティティにも使う汎用関数）。
 * 未検証のままSupabase REST APIのクエリ文字列に埋め込むと、意図しない文字
 * （&や?等）でクエリ構造が壊れる可能性があるため、抽出直後に必ず通す。
 */
export function isValidUuid(id) {
  return typeof id === "string" && UUID_PATTERN.test(id);
}

/** @deprecated isValidUuidを使う。既存呼び出し元との後方互換のために残している */
export const isValidDraftId = isValidUuid;

export async function getDraftById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?id=eq.${id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_drafts取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function updateDraft(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_drafts?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_drafts更新エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function getInsightById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights?id=eq.${id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_strategy_insights取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/**
 * insightを新規作成する（revise/redoの自由記述フィードバックをユーザーが選択的に
 * 恒久方針へ反映する機能用、spec.md課題4）。statusは常にproposedで作成する。
 * proposed→activeへの昇格は「戦略メモ」タブの手動採用ボタン（insights/[id]/approve.js）で行う
 * （2026-09-05、週次自動昇格の想定Routineが後の統合作業で廃止され孤立したため手動運用に変更）。
 */
export async function createInsight(payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_strategy_insights作成エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function updateInsight(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_strategy_insights?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_strategy_insights更新エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

// platformごとの発火先環境変数プレフィックス（ADR 0038）。revise/redoが下書きの
// 生成元パイプラインに関わらず一律SNS_HUB_ROUTINEを発火していたバグの修正に使う。
// チャネル別パイプラインが段階展開（ADR 0037）で未整備のプラットフォームは
// フォールバックとしてSNS_HUB_ROUTINEへ発火する。
export const PLATFORM_ROUTINE_ENV_PREFIX = {
  blog: "SNS_BLOG_ROUTINE",
  note: "SNS_NOTE_ROUTINE",
  x: "SNS_X_ROUTINE",
  tiktok: "SNS_TIKTOK_ROUTINE",
  youtube: "SNS_YOUTUBE_ROUTINE",
};

const FALLBACK_ROUTINE_ENV_PREFIX = "SNS_HUB_ROUTINE";

/**
 * 下書きのplatformから発火すべきRoutineの環境変数プレフィックスを解決する。
 * 対応するチャネル別パイプラインが未展開（環境変数未設定）の場合は、
 * fireRoutine側で自動的にnot_configured判定になりフォールバックの挙動になる。
 */
export function resolveRoutineEnvPrefix(platform) {
  return PLATFORM_ROUTINE_ENV_PREFIX[platform] || FALLBACK_ROUTINE_ENV_PREFIX;
}

export async function getTopicById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topics?id=eq.${id}&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topics取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function updateTopic(id, patch) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topics?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topics更新エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/** 進捗マトリクスUI用。ネタに紐づく全ターゲット（アカウント×生成状況）を取得する */
export async function getTopicTargets(topicId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_targets?topic_id=eq.${topicId}&select=*,sns_target_accounts(platform,account_label)`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topic_targets取得エラー: ${response.status}`);
  }
  return response.json();
}

/** 「⚡今すぐ生成」ボタン用。単一ターゲットをplatform付きで取得する（要件26） */
export async function getTopicTargetById(id) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_targets?id=eq.${id}&select=*,sns_target_accounts(platform,account_label)`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topic_targets取得エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

/**
 * ターゲットをpending⇔skippedで切り替える（要件14、チャネルラベルの手動調整）。
 * claim済み・生成済みのターゲットは対象外（statusがpending/skippedの場合のみ許可）。
 */
export async function updateTopicTargetLabel(id, status, reason) {
  if (status !== "pending" && status !== "skipped") {
    throw new Error(
      `updateTopicTargetLabelはpending/skippedのみ許可: ${status}`,
    );
  }
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_targets?id=eq.${id}&status=in.(pending,skipped)`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status,
        skip_reason: status === "skipped" ? reason || null : null,
        // pendingへ戻す＝未claim状態に戻すことを意味するため、claim系メタデータも
        // 必ずクリアする（scripts/lib/snsTopics.jsの同名関数と同じ修正、2026-09-03）
        ...(status === "pending" ? { claimed_by: null, claimed_at: null } : {}),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topic_targetsラベル更新エラー: ${response.status}`);
  }
  const rows = await response.json();
  return rows[0] || null;
}

export async function getActiveContentTypes() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_content_types?active=eq.true&select=*`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_content_types取得エラー: ${response.status}`);
  }
  return response.json();
}

/**
 * ネタの型（カテゴリ）一覧をチャネル設定つきで取得する（sns-hub「ネタ型設定」画面用）。
 * scripts/lib/snsTopics.jsのgetTopicCategoriesと同じクエリ（Node版とEdge版で
 * 二重管理になっているが、既存のgetActiveContentTypes等と同じ構成を踏襲）。
 */
export async function getTopicCategories() {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_categories?select=*,sns_content_types(type_key,label,cadence),sns_topic_category_channels(id,platform,enabled)&order=created_at`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`sns_topic_categories取得エラー: ${response.status}`);
  }
  return response.json();
}

/** 型×チャネルのON/OFFを更新する */
export async function updateTopicCategoryChannel(
  categoryId,
  platform,
  enabled,
) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/sns_topic_category_channels?category_id=eq.${categoryId}&platform=eq.${platform}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        enabled,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `sns_topic_category_channels更新エラー: ${response.status}`,
    );
  }
  const rows = await response.json();
  return rows[0] || null;
}

/**
 * RoutineのAPIトリガー（/fireエンドポイント）を呼ぶ（ADR 0020）。
 * Task13/14でRoutineを実際に構築するまでは対応する環境変数が未設定のため、
 * その場合はfireをスキップして{fired: false}を返す（DB更新自体は独立してテストできるようにする）。
 *
 * @param {string} envPrefix - 'SNS_HUB_GENERATION_ROUTINE' 等、環境変数名のprefix
 * @param {object} payload - Routineに渡す内容（draft_id・修正理由等）
 */
export async function fireRoutine(envPrefix, payload) {
  const fireUrl = process.env[`${envPrefix}_FIRE_URL`];
  const fireToken = process.env[`${envPrefix}_FIRE_TOKEN`];

  if (!fireUrl || !fireToken) {
    console.warn(
      `${envPrefix}のfireをスキップ: 環境変数未設定（Routine未構築の可能性）`,
    );
    return { fired: false, reason: "not_configured" };
  }

  const response = await fetch(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fireToken}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
    },
    body: JSON.stringify({ text: JSON.stringify(payload) }),
  });

  if (!response.ok) {
    console.error(`${envPrefix}のfireに失敗: ${response.status}`);
    return { fired: false, reason: `http_${response.status}` };
  }

  const result = await response.json();
  return { fired: true, sessionUrl: result.claude_code_session_url };
}

const LINEAR_API_URL = "https://api.linear.app/graphql";
const CONTENT_QUALITY_LABEL = "content-quality";

async function linearGraphqlRequest(apiKey, query, variables) {
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

async function resolveLinearTeamId(apiKey) {
  if (process.env.LINEAR_TEAM_ID) return process.env.LINEAR_TEAM_ID;
  const data = await linearGraphqlRequest(
    apiKey,
    `query { viewer { teams { nodes { id } } } }`,
    {},
  );
  const teams = data?.viewer?.teams?.nodes ?? [];
  if (teams.length === 0) throw new Error("Linearにチームが見つかりません");
  return teams[0].id;
}

async function getLinearLabelId(apiKey, teamId, labelName) {
  const data = await linearGraphqlRequest(
    apiKey,
    `query TeamLabels($teamId: String!) {
      team(id: $teamId) { labels { nodes { id name } } }
    }`,
    { teamId },
  );
  const label = data.team.labels.nodes.find((l) => l.name === labelName);
  return label?.id ?? null;
}

/**
 * 制作仕様変更FB（要件85）用のLinear起票。scripts/maintenance/
 * content-ops-checks/check-revision-escalation.jsと同じGraphQL直叩き
 * パターンをEdge Function向けに移植したもの（fsを使わない点のみ異なる）。
 * LINEAR_API_KEY未設定の場合は起票をスキップし、その旨を返す
 * （fireRoutineと同じ「未設定なら静かにスキップ」方針）。
 *
 * @param {{title: string, description: string}} params
 * @returns {Promise<{created: boolean, url?: string, reason?: string}>}
 */
export async function createLinearIssue({ title, description }) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.warn("Linear起票をスキップ: LINEAR_API_KEY未設定");
    return { created: false, reason: "not_configured" };
  }
  const teamId = await resolveLinearTeamId(apiKey);
  const labelId = await getLinearLabelId(apiKey, teamId, CONTENT_QUALITY_LABEL);
  const data = await linearGraphqlRequest(
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
  return { created: true, url: data.issueCreate.issue.url };
}
