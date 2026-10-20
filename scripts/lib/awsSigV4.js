/**
 * AWS Signature Version 4（S3 互換の口の署名）。Cloudflare R2 を呼ぶ scripts/storage-mirror/r2.js が使う（ADR-0098）。
 * 依存を増やさないために自前で持つ。正しさは AWS の公開の試験値で verify-storage-mirror.js が固定する。
 */
import { createHash, createHmac } from "node:crypto";

export const sha256Hex = (data) =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 の非予約文字以外を %XX にする（S3 の正規化の規則） */
export const uriEncode = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** オブジェクトのキーをパスに直す（区切りの / は残す） */
export const encodeKeyPath = (key) => key.split("/").map(uriEncode).join("/");

/** `20130524T000000Z` の形 */
export const amzDate = (date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

/**
 * 署名した headers を返す（Authorization・x-amz-date・x-amz-content-sha256 を足す）。
 * 渡した headers は全部署名に入れる。
 *
 * @param {{ method: string, host: string, path: string, query?: Record<string,string>, headers?: Record<string,string>,
 *           payloadHash: string, accessKeyId: string, secretAccessKey: string, region: string, service?: string,
 *           date: Date }} req path は encodeKeyPath 済みの、/ で始まるもの
 * @returns {Record<string,string>}
 */
export function signRequest({
  method,
  host,
  path,
  query = {},
  headers = {},
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region,
  service = "s3",
  date,
}) {
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const all = {
    ...Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [
        k.toLowerCase(),
        String(v).trim().replace(/\s+/g, " "),
      ]),
    ),
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
  };
  const names = Object.keys(all).sort();
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
    .join("&");
  const canonical = [
    method,
    path,
    canonicalQuery,
    names.map((n) => `${n}:${all[n]}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join(
    "\n",
  );
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  const { host: _host, ...rest } = all;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}
