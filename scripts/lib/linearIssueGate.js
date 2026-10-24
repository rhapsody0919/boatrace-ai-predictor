/**
 * Linear の起票の前に、未アーカイブのチケット数を数えて上限の手前で止める（hq 台帳 PL48、2026-10-20）。
 *
 * オーナーは Linear の無料プランに留まると決めた。無料プランはワークスペース全体の未アーカイブの
 * チケットを250件までに制限し、超えると issueCreate が USAGE_LIMIT_EXCEEDED で失敗する
 * （2026-09-28 に実際に止まった。2026-10-18 時点で 228/250）。このリポジトリの起票の経路は
 * すべてこのモジュールの assertCanCreateIssue を通してから issueCreate を呼ぶ。
 *
 * - 数え方: issues を includeArchived なし（既定）・チームで絞らずにページ送りで全件数える。
 *   hq の platform/ticket.py の count_unarchived と同じ数え方にし、hq の心拍・ダッシュボードと
 *   同じ数字にする。Linear が上限に使う値（エラー文では activeIssueCount）を直接返す GraphQL の
 *   欄は、公開のスキーマで確かめられなかったため使わない
 * - 閾値: 230（2026-10-21 hq 決定。hq は 200 で警告・240 で社員の起票を止める。龍神の経路は 230 で止める）。230件以上なら起票しない
 * - 数えられないとき: 止める（fail closed）。数えられないまま起票して上限に当たると、
 *   起票したつもりで進むことになるため
 * - 止めたときは黙らない: notify（Slack）に件数と閾値を入れた文を送り、例外を投げる。
 *   通知が失敗しても例外は投げる（通知の失敗で起票が通ることはない）
 */

export const LINEAR_FREE_ISSUE_LIMIT = 250;
export const LINEAR_ISSUE_GATE_THRESHOLD = 230;
export const LINEAR_ISSUE_GATE_CODE = "LINEAR_ISSUE_GATE_BLOCKED";

export const COUNT_ACTIVE_ISSUES_QUERY = `query CountActiveIssues($after: String) {
  issues(first: 250, after: $after) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ページ送りの上限。250件×40ページ＝1万件を超えることは無いので、応答の異常で回り続けないための止め
const MAX_PAGES = 40;

/**
 * 未アーカイブのチケット数を数える。
 * @param {(query: string, variables: Record<string, unknown>) => Promise<any>} request
 *   GraphQL を送って data を返す関数（各経路の既存の graphqlRequest を渡す）
 * @returns {Promise<number>}
 */
export async function countActiveIssues(request) {
  let total = 0;
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request(COUNT_ACTIVE_ISSUES_QUERY, { after });
    const issues = data?.issues;
    if (!Array.isArray(issues?.nodes) || !issues.pageInfo) {
      throw new Error("未アーカイブ件数の応答の形が不正です");
    }
    total += issues.nodes.length;
    if (!issues.pageInfo.hasNextPage) return total;
    after = issues.pageInfo.endCursor;
  }
  throw new Error(
    `未アーカイブ件数のページ送りが ${MAX_PAGES} ページを超えました`,
  );
}

/**
 * 件数と閾値から、起票してよいかと止める理由の文を返す（純粋関数）。
 * @param {{count: number, threshold?: number}} params
 * @returns {{allowed: boolean, message: string | null}}
 */
export function issueGateDecision({
  count,
  threshold = LINEAR_ISSUE_GATE_THRESHOLD,
}) {
  if (count < threshold) return { allowed: true, message: null };
  return { allowed: false, message: gateBlockedMessage({ count, threshold }) };
}

/**
 * 起票を止めた理由の文（純粋関数）。件数を数えられなかったとき（count が null）は、その旨の文。
 * API が画面に返す文もこれで作る（例外の文をそのまま返さない。snsRawErrors の検査）
 * @param {{count?: number | null, threshold?: number}} params
 */
export function gateBlockedMessage({
  count = null,
  threshold = LINEAR_ISSUE_GATE_THRESHOLD,
}) {
  if (count == null)
    return `Linear の起票を止めました: 未アーカイブ件数を数えられないため、閾値 ${threshold} 件を確かめられません`;
  return `Linear の起票を止めました: 未アーカイブ ${count} 件が閾値 ${threshold} 件以上です（無料枠の上限 ${LINEAR_FREE_ISSUE_LIMIT} 件）。完了・取り消しのチケットをアーカイブしてから起票し直してください`;
}

export class LinearIssueGateError extends Error {
  constructor(message, { count = null, threshold } = {}) {
    super(message);
    this.name = "LinearIssueGateError";
    this.code = LINEAR_ISSUE_GATE_CODE;
    this.count = count;
    this.threshold = threshold;
  }
}

/**
 * 起票の直前に呼ぶ。起票してよければ件数を返し、だめなら notify してから LinearIssueGateError を投げる。
 * @param {{
 *   request: (query: string, variables: Record<string, unknown>) => Promise<any>,
 *   notify: (text: string) => Promise<void>,
 *   threshold?: number,
 *   source: string,
 * }} params source は通知の文に入れる起票元（例 "linear-cli.js create"）
 * @returns {Promise<number>} 数えた件数
 */
export async function assertCanCreateIssue({
  request,
  notify,
  threshold = LINEAR_ISSUE_GATE_THRESHOLD,
  source,
}) {
  let count;
  try {
    count = await countActiveIssues(request);
  } catch (error) {
    const message = `Linear の起票を止めました: 未アーカイブ件数を数えられません（${error.message}）。閾値 ${threshold} 件を確かめられないため起票しません`;
    await notifySafely(notify, `[${source}] ${message}`);
    throw new LinearIssueGateError(message, { threshold });
  }
  const decision = issueGateDecision({ count, threshold });
  if (!decision.allowed) {
    await notifySafely(notify, `[${source}] ${decision.message}`);
    throw new LinearIssueGateError(decision.message, { count, threshold });
  }
  return count;
}

// 通知の失敗は記録して続ける（起票を止めたことは例外で呼び出し側に伝わる）
async function notifySafely(notify, text) {
  console.error(text);
  try {
    await notify(text);
  } catch (error) {
    console.error(`起票を止めた通知を送れませんでした: ${error.message}`);
  }
}

/**
 * 環境変数から Slack の通知関数を作る。SLACK_WEBHOOK_URL（Vercel・GitHub Actions の通知先）を優先し、
 * 無ければ SLACK_DIGEST_WEBHOOK_URL（手元の .env.local にあるもの）を使う。どちらも無ければ
 * ログだけにする（assertCanCreateIssue が console.error に出し、例外も投げる）。
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} [fetchImpl]
 * @returns {(text: string) => Promise<void>}
 */
export function slackNotifierFromEnv(env, fetchImpl = globalThis.fetch) {
  const webhookUrl = env.SLACK_WEBHOOK_URL || env.SLACK_DIGEST_WEBHOOK_URL;
  return async (text) => {
    if (!webhookUrl) {
      console.error(
        "SLACK_WEBHOOK_URL・SLACK_DIGEST_WEBHOOK_URL が未設定のため、起票を止めた通知はログだけです",
      );
      return;
    }
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `:no_entry: ${text}` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Slack への通知に失敗: HTTP ${response.status}`);
    }
  };
}
