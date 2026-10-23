/**
 * 写す元の Supabase Storage（ADR-0101）。service key で一覧と読み取りだけをする。書く・消す呼び出しは持たない
 * （verify-storage-mirror.js が検査する）。一覧は api/_lib/analogyV16.js の listObjects（夜の確認と同じ口）を使う。
 * 失敗の文にファイルのパスを入れない（リポジトリは PUBLIC で、Actions のログは外から見える）。
 */
import { listObjects } from "../../api/_lib/analogyV16.js";
import { encodeKeyPath } from "../lib/awsSigV4.js";
import { SourceNotFound } from "../lib/storageMirror.js";

/** 1つのフォルダの中で同時に潜るフォルダの数（verify-analogy-v16.js の SIZE_PARALLEL と同じ。全部を同時に潜ると 429） */
const LIST_PARALLEL = 8;

/**
 * 鍵の role。JWT（eyJ…）は payload の role、新しい形の鍵は接頭辞で見る。
 * anon の鍵だと非公開のバケットの一覧が 200 で空になり、「全部消えた」と読み違えるため、起動時に確かめる
 */
export function keyRole(key) {
  if (/^sb_secret_/.test(key)) return "service_role";
  if (/^sb_publishable_/.test(key)) return "anon";
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL か SUPABASE_SERVICE_KEY が無い（Environment prod-jobs の secret 未設定）",
    );
  const role = keyRole(key);
  if (role !== "service_role")
    throw new Error(
      `SUPABASE_SERVICE_KEY の role が service_role でない（${role ?? "読めない"}）。Invalid API key の扱い（Environment prod-jobs の secret の値の誤り）`,
    );
  return { url: url.replace(/\/$/, ""), key };
}

/** 一覧の1行をファイルの形に。metadata.size が無いものは大きさを確かめられないので失敗させる */
export function toFile(prefix, row) {
  const m = row.metadata ?? {};
  if (typeof m.size !== "number") throw new Error("一覧の行に metadata.size が無い");
  return {
    path: `${prefix}${row.name}`,
    size: m.size,
    etag: m.eTag ?? null,
    updatedAt: row.updated_at ?? m.lastModified ?? null,
    contentType: m.mimetype ?? null,
  };
}

/** バケットの全部のファイル（フォルダは id が null の行。LIST_PARALLEL 個ずつ並べて潜る） */
export async function listAll(bucket, prefix = "") {
  const rows = await listObjects(prefix, bucket);
  const files = rows.filter((r) => r.id !== null).map((r) => toFile(prefix, r));
  const dirs = rows.filter((r) => r.id === null);
  for (let i = 0; i < dirs.length; i += LIST_PARALLEL)
    for (const sub of await Promise.all(
      dirs.slice(i, i + LIST_PARALLEL).map((r) => listAll(bucket, `${prefix}${r.name}/`)),
    ))
      files.push(...sub);
  return files;
}

export async function download(bucket, path) {
  const { url, key } = env();
  const res = await fetch(
    `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeKeyPath(path)}`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(300_000),
    },
  );
  // Storage は無いオブジェクトに 400（本文の statusCode が 404）を返すことがある
  if (res.status === 404 || res.status === 400) {
    const text = await res.text().catch(() => "");
    if (res.status === 404 || /"statusCode"\s*:\s*"?404|not_found|Object not found/i.test(text))
      throw new SourceNotFound("元で見つからない");
    throw new Error(`Supabase storage object error ${res.status}（get）`);
  }
  // 一覧が通った後のオブジェクト単位の失敗なので `HTTP 403` の形にしない（鍵の誤りに分けると、カナリアの成功で
  // 鍵の Issue が閉じては開くを繰り返す）。5xx は「supabase … 503」で一時的な失敗に分かれる
  if (!res.ok) throw new Error(`Supabase storage object error ${res.status}（get）`);
  return {
    body: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type"),
    etag: res.headers.get("etag"),
  };
}

export const supabaseSource = () => {
  env();
  return { list: (bucket) => listAll(bucket), download };
};
