/**
 * X の投稿を消す口（BOA-1279、オーナー 2026-11-04「架空の選手の投稿は削除」）。既定は dry-run（何も消さない・DB に書かない）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/delete-x-post.js
 *       架空・試験と疑う投稿の候補の一覧（送信の記録の X の posted から。名簿に無い選手の名前・試験の印）
 *   node --env-file=.env.local scripts/sns/delete-x-post.js --tweet-id <ID> [--item-id <uuid>] [--job-id <uuid>] [--reason <理由>]
 *       指定した投稿の確かめ（消す相手の一覧。何も消さない）
 *   node --env-file=.env.local scripts/sns/delete-x-post.js --tweet-id <ID> --reason <理由> --apply
 *       X で消して、記録を「消した」に直す（本番の関数 /api/admin/sns-hub/delete-x-post を Basic 認証で呼ぶ。
 *       X の鍵は Vercel の側にあり、手元・hq には無い）。既に消えている（404）ときは記録だけ直す
 *
 * --tweet-id・--item-id（sns_auto_send_items の id）・--job-id（sns_x_send_jobs の id）は繰り返してよい（1回5件まで）。
 * --apply は ID の明示が要る。条件で一括に消す道は無い（候補の一覧は見るためだけ）。HQ_TEST が立っていれば --apply は断る。
 * stdout の最後の1行は `DELETE_RESULT {...}`（mode・targets または candidates・results）。
 * exit: 0 成功・2 引数や鍵の不備・1 消せなかった（results に理由）
 * 鍵は .env.local の SUPABASE_URL・SUPABASE_SERVICE_KEY（読むだけ）と SNS_HUB_BASIC_AUTH_USER・SNS_HUB_BASIC_AUTH_PASSWORD（--apply だけ）
 */
import { pathToFileURL } from "node:url";
import {
  candidateRow,
  deleteReasonIssue,
  DELETE_MAX_TARGETS,
  fictionalReasons,
  normalizeRacerName,
  targetIssue,
  TWEET_ID_RE,
  UUID_RE,
} from "../../api/_lib/snsXDelete.js";

export const DELETE_API_URL =
  "https://www.boat-ai.jp/api/admin/sns-hub/delete-x-post";
const FLAGS = {
  "--tweet-id": "tweetIds",
  "--item-id": "itemIds",
  "--job-id": "jobIds",
};

/** 引数（純粋関数）。不備は { error } */
export function parseDeleteArgs(argv) {
  const out = {
    tweetIds: [],
    itemIds: [],
    jobIds: [],
    reason: null,
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--dry-run") out.apply = false;
    else if (arg === "--reason") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        return { error: "--reason の後に理由を書く" };
      out.reason = value;
    } else if (FLAGS[arg]) {
      const value = argv[++i] ?? "";
      const re = arg === "--tweet-id" ? TWEET_ID_RE : UUID_RE;
      if (!re.test(value)) return { error: `${arg} の値が不正: ${value}` };
      out[FLAGS[arg]].push(value);
    } else return { error: `知らない引数: ${arg}` };
  }
  const count = out.tweetIds.length + out.itemIds.length + out.jobIds.length;
  if (out.apply && !count)
    return {
      error:
        "--apply は消す投稿の ID（--tweet-id・--item-id・--job-id）を明示で並べる",
    };
  if (count > DELETE_MAX_TARGETS)
    return { error: `1回に指定するのは${DELETE_MAX_TARGETS}件まで` };
  if (out.apply) {
    const issue = deleteReasonIssue(out.reason);
    if (issue) return { error: issue };
  }
  return out;
}

/** PostgREST の読み取り（service key、GET だけ） */
export function createReadStore({ url, key, fetchImpl = fetch }) {
  async function get(path) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      throw new Error(
        `DB の読み取りに失敗: ${path.split("?")[0]} HTTP ${response.status}`,
      );
    return response.json();
  }
  async function all(path) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await get(`${path}&limit=1000&offset=${offset}`);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  const inList = (ids) => `in.(${ids.map(encodeURIComponent).join(",")})`;
  return {
    async jobs({ jobIds = [], tweetIds = [], itemIds = [] } = {}) {
      const filters = [
        jobIds.length && `id.${inList(jobIds)}`,
        tweetIds.length && `external_post_id.${inList(tweetIds)}`,
        itemIds.length && `auto_item_id.${inList(itemIds)}`,
      ].filter(Boolean);
      const where = filters.length
        ? `&or=(${filters.join(",")})`
        : "&channel=eq.x&state=eq.posted";
      return all(`sns_x_send_jobs?select=*${where}&order=posted_at.asc`);
    },
    // URL の長さと1回の行の上限に収めるため、100件ずつ読む
    async drafts(ids) {
      const rows = [];
      for (let i = 0; i < ids.length; i += 100)
        rows.push(
          ...(await get(
            `sns_drafts?id=${inList(ids.slice(i, i + 100))}&select=id,format,title,status,source_data`,
          )),
        );
      return rows;
    },
    async roster() {
      const rows = await all("racer_profiles?select=name&order=racer_id");
      return new Set(rows.map((r) => normalizeRacerName(r.name)));
    },
  };
}

/**
 * 一覧（dry-run と --apply の前の確かめ）。ID の指定が無ければ架空の候補、あれば指定した投稿（理由は --reason と疑いの理由）
 */
export async function listTargets(args, store) {
  const explicit =
    args.tweetIds.length + args.itemIds.length + args.jobIds.length > 0;
  // 指定した ID に当たる行だけ（DB の条件に加えて手元でも絞る。指定に無い投稿を消す相手に混ぜない）
  const jobs = (await store.jobs(args)).filter(
    (j) =>
      !explicit ||
      args.jobIds.includes(j.id) ||
      args.tweetIds.includes(j.external_post_id) ||
      args.itemIds.includes(j.auto_item_id),
  );
  const drafts = new Map(
    (await store.drafts([...new Set(jobs.map((j) => j.draft_id))])).map((d) => [
      d.id,
      d,
    ]),
  );
  const roster = await store.roster();
  const all = jobs.map((job) => {
    const draft = drafts.get(job.draft_id);
    const reasons = fictionalReasons({ draft }, roster);
    if (explicit && args.reason) reasons.unshift(`指定: ${args.reason}`);
    const issue = targetIssue(job, undefined);
    // --item-id だけで当たった行（同じ item の未送信の job 等）は、消せなければ外す（明示の ID の行だけが止める）
    const byItemOnly =
      args.itemIds.includes(job.auto_item_id) &&
      !args.jobIds.includes(job.id) &&
      !args.tweetIds.includes(job.external_post_id);
    return { ...candidateRow({ job, draft }, reasons), issue, byItemOnly };
  });
  const skipped = all.filter((r) => r.issue && r.byItemOnly);
  const rows = all.filter((r) => !(r.issue && r.byItemOnly));
  if (!explicit)
    return {
      rows: rows.filter((r) => r.reasons.length && !r.issue && !r.deleted_at),
      missing: [],
      skipped: [],
    };
  const found = new Set(all.flatMap((r) => [r.job_id, r.tweet_id]));
  const itemsFound = new Set(jobs.map((j) => j.auto_item_id));
  const missing = [
    ...args.tweetIds.filter((id) => !found.has(id)),
    ...args.jobIds.filter((id) => !found.has(id)),
    ...args.itemIds.filter((id) => !itemsFound.has(id)),
  ];
  return { rows, missing, skipped };
}

function printRows(rows) {
  if (!rows.length) console.log("（該当なし）");
  for (const r of rows)
    console.log(
      [
        `tweet ${r.tweet_id}`,
        `job ${r.job_id}`,
        `送信 ${r.posted_at}`,
        `型 ${r.format}`,
        `本文「${r.head}」`,
        `理由: ${r.reasons.join(" / ") || "（無し）"}`,
        r.deleted_at ? `消した記録あり ${r.deleted_at}` : null,
        r.issue ? `消せない: ${r.issue}` : null,
      ]
        .filter(Boolean)
        .join("  "),
    );
}

const basic = (user, password) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = fetch,
) {
  const args = parseDeleteArgs(argv);
  const finish = (code, result) => {
    console.log(`DELETE_RESULT ${JSON.stringify(result)}`);
    return code;
  };
  if (args.error) {
    console.error(args.error);
    return finish(2, { mode: "error", error: args.error });
  }
  if (args.apply && env.HQ_TEST)
    return finish(2, {
      mode: "error",
      error: "HQ_TEST が立っている（試験から本物の X を消さない）",
    });
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    return finish(2, {
      mode: "error",
      error: "SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）",
    });
  const { rows, missing, skipped } = await listTargets(
    args,
    createReadStore({ url, key, fetchImpl }),
  );
  printRows(rows);
  if (missing.length) console.log(`送信の記録に無い: ${missing.join(", ")}`);
  for (const r of skipped)
    console.log(
      `外した（--item-id で当たった消せない job）: ${r.job_id} ${r.issue}`,
    );
  if (!args.apply) {
    const explicit =
      args.tweetIds.length + args.itemIds.length + args.jobIds.length > 0;
    return finish(0, {
      mode: "dry-run",
      [explicit ? "targets" : "candidates"]: rows,
      missing,
      skipped,
    });
  }
  const blocked = rows.filter((r) => r.issue);
  if (rows.length > DELETE_MAX_TARGETS)
    return finish(2, {
      mode: "error",
      error: `消す相手が${rows.length}件（1回${DELETE_MAX_TARGETS}件まで。何も消していない）`,
    });
  if (!rows.length || missing.length || blocked.length)
    return finish(2, {
      mode: "error",
      error: "記録に無い・消せない投稿がある（何も消していない）",
      missing,
      blocked,
    });
  const user = env.SNS_HUB_BASIC_AUTH_USER;
  const password = env.SNS_HUB_BASIC_AUTH_PASSWORD;
  if (!user || !password)
    return finish(2, {
      mode: "error",
      error:
        "SNS_HUB_BASIC_AUTH_USER・SNS_HUB_BASIC_AUTH_PASSWORD が無い（.env.local）",
    });
  const response = await fetchImpl(DELETE_API_URL, {
    method: "POST",
    headers: {
      Authorization: basic(user, password),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      targets: rows.map((r) => ({ job_id: r.job_id, tweet_id: r.tweet_id })),
      reason: args.reason.trim(),
    }),
  });
  const body = await response.json().catch(() => null);
  // 本文が読めない（未デプロイで HTML が返る等）ときは、消えたか分からない。dry-run で記録を見直す
  if (!body?.data)
    return finish(1, {
      mode: "apply",
      error: `${body?.error ?? "応答が読めない"}（HTTP ${response.status}。--apply を外して記録を見直す）`,
    });
  return finish(body.data.ok ? 0 : 1, { mode: "apply", ...body.data });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  process.exitCode = await main();
