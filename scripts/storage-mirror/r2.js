/**
 * Cloudflare R2 の S3 互換の口（ADR-0100）。使う呼び出しは一覧・PUT（If-None-Match: *）・GET・HEAD だけ。消す呼び出しは持たない。
 */
import zlib from "node:zlib";
import {
  encodeKeyPath,
  sha256Hex,
  signRequest,
  uriEncode,
} from "../lib/awsSigV4.js";
import { md5Base64 } from "../lib/storageMirror.js";

const EMPTY_HASH = sha256Hex("");

/** secret の名前（Environment prod-jobs） */
export const R2_SECRETS = Object.freeze([
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
]);

export function r2EnvOrThrow(env = process.env) {
  const missing = R2_SECRETS.filter((k) => !env[k]);
  if (missing.length)
    throw new Error(
      `${missing.join("・")} が無い（Environment prod-jobs の secret 未設定。docs/operation/storage-mirror-r2-owner-steps.md）`,
    );
  if (!/^[0-9a-f]{32}$/.test(env.R2_ACCOUNT_ID))
    throw new Error("R2_ACCOUNT_ID の形が違う（32桁の16進のはず）");
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

const xmlText = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? xmlText(m[1]) : null;
};

/** R2 のエラーの本文からコードを取る（無ければ空） */
const errorCode = (text) => tag(text, "Code") ?? "";

/** ListObjectsV2 の XML から { keys, truncated, next } */
export function parseListXml(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
    (m) => ({
      key: tag(m[1], "Key"),
      size: Number(tag(m[1], "Size")),
    }),
  );
  return {
    objects,
    truncated: tag(xml, "IsTruncated") === "true",
    next: tag(xml, "NextContinuationToken"),
  };
}

/**
 * @param {{accountId: string, bucket: string, accessKeyId: string, secretAccessKey: string}} cfg
 * @param {{fetchImpl?: typeof fetch, now?: () => Date}} [opts]
 */
export function createR2Client(
  cfg,
  { fetchImpl = fetch, now = () => new Date() } = {},
) {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const call = async (
    method,
    key,
    { query = {}, headers = {}, body, payloadHash = EMPTY_HASH } = {},
  ) => {
    const path = `/${cfg.bucket}${key === null ? "" : `/${encodeKeyPath(key)}`}`;
    const signed = signRequest({
      method,
      host,
      path,
      query,
      headers,
      payloadHash,
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: "auto",
      date: now(),
    });
    // 署名の正規化と同じ符号化にする（URLSearchParams は空白を + にする）
    const qs = Object.keys(query)
      .sort()
      .map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`)
      .join("&");
    const res = await fetchImpl(`https://${host}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: signed,
      body,
      signal: AbortSignal.timeout(120_000),
    });
    return res;
  };
  // 一覧（バケット単位）の失敗は `R2 HTTP {状態}` で、job-watch が 401・403 を「鍵・設定の誤り」に分ける。
  // オブジェクト単位の失敗は、一覧が通った後のもの（キーの符号化の誤り等）なので `HTTP 403` の文字を含めない
  // （鍵の誤りに分けると、カナリアの成功で鍵の Issue が閉じ、翌日また開くを繰り返す）。キーは公開のログに出さない
  const fail = async (res, op) => {
    const text = await res.text().catch(() => "");
    const code = errorCode(text);
    return op === "list"
      ? new Error(`R2 HTTP ${res.status}${code ? ` ${code}` : ""}（list）`)
      : new Error(`R2 object error ${res.status}${code ? ` ${code}` : ""}（${op}）`);
  };

  return {
    /** prefix の下の全部のキー */
    async list(prefix) {
      const out = [];
      let token = null;
      for (;;) {
        const query = { "list-type": "2", prefix, "max-keys": "1000" };
        if (token) query["continuation-token"] = token;
        const res = await call("GET", null, { query });
        if (!res.ok) throw await fail(res, "list");
        const page = parseListXml(await res.text());
        out.push(...page.objects);
        if (!page.truncated) return out;
        if (!page.next)
          throw new Error("R2 の一覧: 続きの token が無い");
        token = page.next;
      }
    },
    /** 1件だけ一覧する（カナリア。Class A の操作1回） */
    async listOne(prefix) {
      const res = await call("GET", null, {
        query: { "list-type": "2", prefix, "max-keys": "1" },
      });
      if (!res.ok) throw await fail(res, "list");
      return parseListXml(await res.text()).objects;
    },
    /** 無いときだけ書く。書いたら "created"、既にあれば "exists" */
    async put(key, body, { contentType, md5, sha256, meta = {} }) {
      const headers = {
        "content-type": contentType,
        "content-md5": md5,
        "if-none-match": "*",
        ...Object.fromEntries(
          Object.entries(meta).map(([k, v]) => [`x-amz-meta-${k}`, v]),
        ),
      };
      const res = await call("PUT", key, {
        headers,
        body,
        payloadHash: sha256,
      });
      if (res.status === 412) {
        await res.arrayBuffer().catch(() => null);
        return "exists";
      }
      if (!res.ok) throw await fail(res, "put");
      await res.arrayBuffer().catch(() => null);
      return "created";
    },
    /** 無ければ null */
    async head(key) {
      const res = await call("HEAD", key);
      if (res.status === 404) return null;
      if (!res.ok) throw await fail(res, "head");
      return {
        size: Number(res.headers.get("content-length")),
        contentType: res.headers.get("content-type"),
        meta: { sha256: res.headers.get("x-amz-meta-sha256") },
      };
    },
    async get(key) {
      const res = await call("GET", key);
      if (!res.ok) throw await fail(res, "get");
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"),
        meta: { sha256: res.headers.get("x-amz-meta-sha256") },
      };
    },
    async getManifest(key) {
      const { body } = await this.get(key);
      return JSON.parse(zlib.gunzipSync(body).toString("utf8"));
    },
    async putManifest(key, obj) {
      const body = zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
      return this.put(key, body, {
        contentType: "application/gzip",
        md5: md5Base64(body),
        sha256: sha256Hex(body),
        meta: { sha256: sha256Hex(body) },
      });
    },
  };
}
