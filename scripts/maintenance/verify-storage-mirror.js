#!/usr/bin/env node
/**
 * verify-storage-mirror.js - Supabase Storage → Cloudflare R2 の写し（ADR-0098）の検証。外部に繋がない。
 *
 * 確認する観点:
 *   1. SigV4 の署名が AWS の公開の試験値と一致する。日本語・空白・+ を含むキーの符号化
 *   2. R2 の一覧の XML の読み取り（実体参照・続きの token）
 *   3. 通しの run（偽の Supabase と、S3 の振る舞いを真似た偽の R2 に、本物の r2.js を当てる）
 *      初回／変化なし（manifest を書かない）／中身の変化（versions/）／元で消えた（残す）／大量の削除（基準にしない）／
 *      一覧0件／取り寄せの上限／412 からの復旧／GET が 404（消えた扱い）／initial の誤用／写さないバケット
 *   4. 失敗の文にファイルのパスを入れない（ログは公開）。R2 の一覧の 401・403 は鍵の誤り、オブジェクト単位の 403 は鍵の誤りにしない
 *   5. 鍵の role（anon の鍵を拒む）
 *   6. 配線: 写しの側は Supabase に書く・消す呼び出しを持たない、R2 に消す呼び出しを持たない、workflow の権限・固定・npm ci 無し、
 *      key-canary の r2 の job
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { encodeKeyPath, signRequest } from "../lib/awsSigV4.js";
import { classifyLog } from "../lib/jobWatch.js";
import {
  EXCLUDED_BUCKETS,
  runMirror,
  SOURCE_BUCKETS,
  SourceNotFound,
  sha256,
  md5Base64,
  scrubPath,
  tooManyNotFound,
} from "../lib/storageMirror.js";
import {
  createR2Client,
  parseListXml,
  r2EnvOrThrow,
} from "../storage-mirror/r2.js";
import { keyRole } from "../storage-mirror/supabase-source.js";
import {
  assertDrillEntry,
  assertDrillTarget,
  createDrillTarget,
  DRILL_BUCKET,
  pickDrillSample,
  runDrill,
  sameType,
} from "../lib/storageMirrorDrill.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// ---- 1. SigV4（AWS の S3 の署名の説明にある試験値。GetObject と ListObjects） ----
const AWS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  date: new Date("2013-05-24T00:00:00Z"),
  host: "examplebucket.s3.amazonaws.com",
};
const EMPTY =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
{
  const get = signRequest({
    ...AWS,
    method: "GET",
    path: "/test.txt",
    headers: { range: "bytes=0-9" },
    payloadHash: EMPTY,
  });
  check(
    "SigV4: AWS の GetObject の試験値と一致",
    get.authorization.endsWith(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    ),
    get.authorization,
  );
  const list = signRequest({
    ...AWS,
    method: "GET",
    path: "/",
    query: { "max-keys": "2", prefix: "J" },
    payloadHash: EMPTY,
  });
  check(
    "SigV4: AWS の ListObjects の試験値と一致",
    list.authorization.endsWith(
      "Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    ),
    list.authorization,
  );
  const put = signRequest({
    ...AWS,
    method: "PUT",
    path: `/${encodeKeyPath("test$file.text")}`,
    headers: {
      date: "Fri, 24 May 2013 00:00:00 GMT",
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
    },
    payloadHash: sha256(Buffer.from("Welcome to Amazon S3.")),
  });
  check(
    "SigV4: AWS の PutObject の試験値と一致（$ の符号化・署名するヘッダ）",
    put.authorization.endsWith(
      "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    ),
    put.authorization,
  );
  check(
    "キーの符号化: / は残し、日本語・空白・+ は %XX",
    encodeKeyPath("a b/日本+(1).png") ===
      "a%20b/%E6%97%A5%E6%9C%AC%2B%281%29.png",
  );
}

// ---- 2. 一覧の XML ----
{
  const xml = `<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a&amp;b/c&lt;d.txt</Key><Size>3</Size></Contents><NextContinuationToken>tok+1</NextContinuationToken></ListBucketResult>`;
  const p = parseListXml(xml);
  check(
    "XML: 実体参照を戻す",
    p.objects[0]?.key === "a&b/c<d.txt" && p.objects[0].size === 3,
  );
  check("XML: 続きの token", p.truncated && p.next === "tok+1");
}

// ---- 3. 通しの run ----
const xmlEsc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** S3 の振る舞いを真似た偽の R2（If-None-Match: *、HEAD、ListObjectsV2）。DELETE は 405 */
function fakeR2() {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, { method, headers, body }) => {
    const u = new URL(url);
    calls.push({ method, path: u.pathname, query: u.search, headers });
    // 受け取った URL（WHATWG URL の正規化の後）とヘッダから署名を作り直し、送られた署名と比べる
    const signedNames = headers.authorization?.match(/SignedHeaders=([^,]+)/)?.[1].split(";") ?? [];
    const d = headers["x-amz-date"] ?? "";
    const expect = signRequest({
      method,
      host: u.host,
      // S3 と同じく、受け取ったパスを区切りごとに戻して符号化し直したものを正規の形とする
      path: u.pathname.split("/").map((x) => encodeKeyPath(decodeURIComponent(x))).join("/"),
      query: Object.fromEntries(u.searchParams),
      headers: Object.fromEntries(
        signedNames
          .filter((n) => !["host", "x-amz-content-sha256", "x-amz-date"].includes(n))
          .map((n) => [n, headers[n]]),
      ),
      payloadHash: headers["x-amz-content-sha256"],
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "auto",
      date: new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(9, 11)}:${d.slice(11, 13)}:${d.slice(13, 15)}Z`),
    });
    if (!headers.authorization || headers.authorization !== expect.authorization)
      return new Response("<Error><Code>SignatureDoesNotMatch</Code></Error>", { status: 403 });
    const [, , ...rest] = u.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    if (method === "GET" && key === "") {
      const prefix = u.searchParams.get("prefix") ?? "";
      const max = Math.min(2, Number(u.searchParams.get("max-keys") ?? 1000));
      // 続きの token は空白・/・+・= を含む形にし、1ページは2件までにする（続きの読み取りと、クエリの符号化と署名の一致を通す）
      const start = Number((u.searchParams.get("continuation-token") ?? "t 0/+=").slice(2, -3));
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const page = keys.slice(start, start + max);
      const more = start + max < keys.length;
      const xml = `<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map((k) => `<Contents><Key>${xmlEsc(k)}</Key><Size>${store.get(k).body.length}</Size></Contents>`).join("")}${more ? `<NextContinuationToken>t ${start + max}/+=</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(xml, { status: 200 });
    }
    if (method === "PUT") {
      if (headers["if-none-match"] !== "*")
        return new Response("", { status: 400 });
      if (store.has(key))
        return new Response("<Error><Code>PreconditionFailed</Code></Error>", {
          status: 412,
        });
      const buf = Buffer.from(body);
      if (headers["content-md5"] !== md5Base64(buf))
        return new Response("<Error><Code>BadDigest</Code></Error>", { status: 400 });
      if (sha256(buf) !== headers["x-amz-content-sha256"])
        return new Response("<Error><Code>BadDigest</Code></Error>", {
          status: 400,
        });
      store.set(key, {
        body: buf,
        contentType: headers["content-type"],
        sha: headers["x-amz-meta-sha256"],
      });
      return new Response("", { status: 200 });
    }
    if (method === "GET" || method === "HEAD") {
      const o = store.get(key);
      if (!o)
        return new Response(
          method === "HEAD" ? null : "<Error><Code>NoSuchKey</Code></Error>",
          { status: 404 },
        );
      const h = {
        "content-type": o.contentType,
        "content-length": String(o.body.length),
        "x-amz-meta-sha256": o.sha ?? "",
      };
      return new Response(method === "HEAD" ? null : o.body, {
        status: 200,
        headers: h,
      });
    }
    return new Response("", { status: 405 });
  };
  const r2 = createR2Client(
    {
      accountId: "0".repeat(32),
      bucket: "mirror",
      accessKeyId: "k",
      secretAccessKey: "s",
    },
    { fetchImpl },
  );
  return { r2, store, calls };
}

/** 偽の Supabase。files[bucket][path] = { body, type, v }（v を上げると指紋が変わる） */
function fakeSource(files) {
  return {
    files,
    gets: 0,
    missing: new Set(),
    async list(bucket) {
      if (this.listError === bucket)
        throw new Error("storage list secret-folder/: HTTP 503");
      return Object.entries(files[bucket] ?? {}).map(([p, f]) => ({
        path: p,
        size: f.body.length,
        etag: `"${sha256(f.body).slice(0, 8)}"`,
        updatedAt: `2026-10-0${f.v ?? 1}T00:00:00Z`,
        contentType: f.type,
      }));
    },
    async download(bucket, p) {
      this.gets += 1;
      if (this.missing.has(`${bucket}/${p}`))
        throw new SourceNotFound("元で見つからない");
      const f = files[bucket][p];
      return { body: f.body, contentType: f.type };
    },
  };
}

const many = (prefix, n, type = "application/gzip") =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `${prefix}/${i}.gz`,
      { body: Buffer.from(`${prefix}-${i}`), type },
    ]),
  );
const t = (d) => new Date(`2026-10-${d}T19:40:00Z`);
const manifestOf = (store, key) =>
  JSON.parse(zlib.gunzipSync(store.get(key).body).toString("utf8"));
const SECRET_PATH = "未投稿の企画/秘密 name(1)!+$'*.mp4";

{
  const { r2, store } = fakeR2();
  const src = fakeSource({
    "sns-hub-media": {
      [SECRET_PATH]: { body: Buffer.from("video"), type: "video/mp4" },
      "a/b.png": { body: Buffer.from("png"), type: "image/png" },
    },
    "raw-pages": many("pit", 20),
    analogy: many("v1", 3),
  });

  let err = null;
  await runMirror({ source: src, r2, now: t(20) }).catch((e) => (err = e));
  check(
    "基準の manifest が無いのに initial が無ければ止める（R2 の一覧の誤りで全部を取り直さない）",
    /initial/.test(err?.message ?? ""),
  );

  const r1 = await runMirror({ source: src, r2, now: t(21), initial: true });
  check("初回: 失敗なし", r1.failures.length === 0, r1.failures.join(" / "));
  check(
    "初回: 全部を objects/ に書いた",
    [...store.keys()].filter((k) => k.startsWith("objects/")).length === 25,
  );
  check(
    "初回: 日本語・空白のパスもそのまま書けた",
    store.has(`objects/sns-hub-media/${SECRET_PATH}`),
  );
  check(
    "Content-Type を元から写す",
    store.get("objects/sns-hub-media/a/b.png").contentType === "image/png",
  );
  check("初回: manifest を書いた", r1.manifestKey && store.has(r1.manifestKey));
  const m1 = manifestOf(store, r1.manifestKey);
  check(
    "manifest: 件数・sha256・基準の印",
    Object.keys(m1.entries).length === 25 &&
      m1.baseline === true &&
      m1.entries["raw-pages/pit/0.gz"].sha256 === sha256(Buffer.from("pit-0")),
  );

  err = null;
  await runMirror({ source: src, r2, now: t(22), initial: true }).catch(
    (e) => (err = e),
  );
  check(
    "manifest があるのに initial を付けたら止める",
    /initial/.test(err?.message ?? ""),
  );

  src.gets = 0;
  const before = store.size;
  const r2nd = await runMirror({ source: src, r2, now: t(22) });
  check(
    "変化なし: 取り寄せない・書かない・manifest も書かない",
    src.gets === 0 &&
      store.size === before &&
      r2nd.manifestKey === null &&
      r2nd.failures.length === 0,
  );

  src.files["raw-pages"]["pit/1.gz"] = {
    body: Buffer.from("pit-1-new"),
    type: "application/gzip",
    v: 2,
  };
  src.files["raw-pages"]["pit/2.gz"] = {
    ...src.files["raw-pages"]["pit/2.gz"],
    v: 2,
  }; // 指紋だけ変わる
  delete src.files["raw-pages"]["pit/3.gz"];
  src.files["raw-pages"]["pit/new.gz"] = {
    body: Buffer.from("n"),
    type: "application/gzip",
  };
  const r3 = await runMirror({ source: src, r2, now: t(23) });
  check(
    "中身の変化: versions/{時刻}/ に書き、objects/ の元の版は残す",
    store.has(`versions/${r3.stamp}/raw-pages/pit/1.gz`) &&
      store.get("objects/raw-pages/pit/1.gz").body.toString() === "pit-1",
  );
  check(
    "指紋だけ変わった（中身は同じ）: 書かない",
    ![...store.keys()].some(
      (k) => k.endsWith("pit/2.gz") && k.startsWith("versions/"),
    ),
  );
  const m3 = manifestOf(store, r3.manifestKey);
  check(
    "元で消えた: 写しは残し、manifest に goneAt",
    store.has("objects/raw-pages/pit/3.gz") &&
      m3.entries["raw-pages/pit/3.gz"].goneAt !== null,
  );
  check(
    "新しいファイルは objects/",
    store.has("objects/raw-pages/pit/new.gz") && r3.failures.length === 0,
  );
  check(
    "manifest の r2Key は新しい版を指す",
    m3.entries["raw-pages/pit/1.gz"].r2Key ===
      `versions/${r3.stamp}/raw-pages/pit/1.gz`,
  );

  // 大量の削除: 基準にしない。翌日も同じ基準と比べて落ち続け、accept_gone で進む
  const kept = src.files["raw-pages"];
  src.files["raw-pages"] = Object.fromEntries(Object.entries(kept).slice(0, 5));
  const r4 = await runMirror({ source: src, r2, now: t(24) });
  check(
    "大量の削除: 失敗にし、manifest は基準にしない",
    r4.failures.some((f) => /消えた/.test(f)) &&
      r4.baseline === false &&
      manifestOf(store, r4.manifestKey).baseline === false,
  );
  const r5 = await runMirror({ source: src, r2, now: t(25) });
  check(
    "大量の削除の翌日も、最後に正しかった基準と比べて落ち続ける（鍵の取り違えを success にしない）",
    r5.failures.some((f) => /消えた/.test(f)),
  );
  const r6 = await runMirror({ source: src, r2, now: t(26), acceptGone: true });
  check(
    "accept_gone で基準を進める",
    r6.failures.length === 0 && r6.baseline === true,
  );
  const r7 = await runMirror({ source: src, r2, now: t(27) });
  check("accept_gone の後は成功", r7.failures.length === 0);

  // 一覧0件（anon の鍵だと非公開のバケットが空で返る）
  const saved = src.files.analogy;
  src.files.analogy = {};
  const r8 = await runMirror({ source: src, r2, now: t(28) });
  check(
    "一覧0件（基準では1件以上）: 失敗にし、消えた扱いにしない・基準にしない",
    r8.failures.some((f) => /0件/.test(f)) &&
      r8.baseline === false &&
      manifestOf(store, r8.manifestKey).entries["analogy/v1/0.gz"].goneAt ===
        null,
  );
  src.files.analogy = saved;

  // 一覧の失敗: パスを出さない
  src.listError = "raw-pages";
  const r9 = await runMirror({
    source: src,
    r2,
    now: new Date("2026-10-29T19:40:00Z"),
  });
  check(
    "一覧の失敗: 失敗にし、文にフォルダのパスを入れない",
    r9.failures.length === 1 &&
      /HTTP 503/.test(r9.failures[0]) &&
      !/secret-folder/.test(r9.failures[0]),
    r9.failures.join(" / "),
  );
  src.listError = null;

  // GET が 404: 消えた扱い（失敗にしない）
  src.files["sns-hub-media"]["c.png"] = {
    body: Buffer.from("c"),
    type: "image/png",
  };
  src.missing.add("sns-hub-media/c.png");
  const r10 = await runMirror({
    source: src,
    r2,
    now: new Date("2026-10-30T19:40:00Z"),
  });
  check(
    "一覧に出たのに GET が 404: 失敗にしない",
    r10.failures.length === 0,
    r10.failures.join(" / "),
  );
  src.missing.clear();

  // 上限: 書く前に止める
  src.files["raw-pages"] = { ...src.files["raw-pages"], ...many("bulk", 6) };
  const sz = store.size;
  err = null;
  await runMirror({
    source: src,
    r2,
    now: new Date("2026-10-31T19:40:00Z"),
    limits: { maxFetch: 5, maxBytes: 1e9 },
  }).catch((e) => (err = e));
  check(
    "取り寄せが上限を超えたら、何も書かずに止める",
    /上限/.test(err?.message ?? "") && store.size === sz,
  );

  // 失敗の文にパスを入れない
  const broken = fakeSource({
    "sns-hub-media": {
      [SECRET_PATH]: { body: Buffer.from("x"), type: "video/mp4" },
    },
    "raw-pages": {},
    analogy: {},
  });
  broken.download = async () => ({
    body: Buffer.from("xx"),
    contentType: "video/mp4",
  }); // 大きさが一覧と違う
  const fresh = fakeR2();
  const r11 = await runMirror({
    source: broken,
    r2: fresh.r2,
    now: t(21),
    initial: true,
  });
  check(
    "写し損ねは失敗にし、文にファイルのパスを入れない",
    r11.failures.length === 1 &&
      !r11.failures[0].includes("秘密") &&
      !r11.failures[0].includes("未投稿"),
    r11.failures.join(" / "),
  );
}

// 基準にしない run の後の重複・上限・初回の失敗（/code-review の指摘の再現テスト）
{
  const { r2, store } = fakeR2();
  const src = fakeSource({
    "sns-hub-media": {},
    "raw-pages": many("p", 20),
    analogy: many("a", 2),
  });
  await runMirror({ source: src, r2, now: t(21), initial: true });
  // 大量の削除の日に、残ったファイルの中身も変わる
  src.files["raw-pages"] = Object.fromEntries(
    Object.entries(src.files["raw-pages"]).slice(0, 3),
  );
  src.files["raw-pages"]["p/0.gz"] = {
    body: Buffer.from("changed"),
    type: "application/gzip",
    v: 2,
  };
  const a = await runMirror({ source: src, r2, now: t(22) });
  const b = await runMirror({ source: src, r2, now: t(23) });
  const versionsOf0 = [...store.keys()].filter(
    (k) => k.startsWith("versions/") && k.endsWith("raw-pages/p/0.gz"),
  );
  check(
    "基準にしない run の翌日も、同じ中身の版を重ねて書かない",
    a.baseline === false && b.baseline === false && versionsOf0.length === 1,
    versionsOf0.join(","),
  );

  // 基準にしない日が続いて上限を超えても、accept_gone で基準を進められる
  src.files["raw-pages"] = { ...src.files["raw-pages"], ...many("n", 4) };
  let err = null;
  await runMirror({
    source: src,
    r2,
    now: t(24),
    limits: { maxFetch: 2, maxBytes: 1e9 },
  }).catch((e) => (err = e));
  const c = await runMirror({
    source: src,
    r2,
    now: t(25),
    acceptGone: true,
    limits: { maxFetch: 2, maxBytes: 1e9 },
  });
  check(
    "上限を超えていても accept_gone の run は止めない",
    /上限/.test(err?.message ?? "") &&
      c.failures.length === 0 &&
      c.baseline === true,
    c.failures.join(" / "),
  );
}
{
  const { r2 } = fakeR2();
  const src = fakeSource({
    "sns-hub-media": {},
    "raw-pages": many("p", 3),
    analogy: {},
  });
  src.listError = "raw-pages";
  const a = await runMirror({ source: src, r2, now: t(21), initial: true });
  src.listError = null;
  let err = null;
  const b = await runMirror({
    source: src,
    r2,
    now: t(22),
    initial: true,
  }).catch((e) => (err = e));
  check(
    "初回で写し損ねたら基準にせず、次も initial で始め直せる",
    a.baseline === false &&
      !err &&
      b.failures.length === 0 &&
      b.baseline === true,
    err?.message,
  );
}
{
  const m = read("scripts/storage-mirror/mirror.js");
  check(
    "mirror.js は起動の判定を置かず main を呼ぶ（外れて何もせず success にならない）",
    /^main\(\)\.catch/m.test(m) && !/import\.meta\.url/.test(m),
  );
}

// 独立審査の指摘の再現テスト（GET の 404 の数・一覧0件と accept_gone・例外の文のパス）
{
  check("404 は2件か1%までなら削除の最中とみなす", !tooManyNotFound(2, 10) && tooManyNotFound(3, 10) && !tooManyNotFound(10, 1000) && tooManyNotFound(11, 1000));
  const { r2 } = fakeR2();
  const src = fakeSource({ "sns-hub-media": {}, "raw-pages": many("p", 10), analogy: many("a", 2) });
  await runMirror({ source: src, r2, now: t(21), initial: true });
  src.files["raw-pages"] = { ...src.files["raw-pages"], ...many("q", 5) };
  for (let i = 0; i < 5; i++) src.missing.add(`raw-pages/q/${i}.gz`);
  const a = await runMirror({ source: src, r2, now: t(22) });
  check("一覧に出たのに GET が 404 のものが多ければ失敗にする（黙って success にしない）", a.failures.some((f) => /404/.test(f)) && a.perBucket["raw-pages"].notFound === 5);
  src.missing.clear();
  src.files.analogy = {};
  const b = await runMirror({ source: src, r2, now: t(23) });
  const c = await runMirror({ source: src, r2, now: t(24), acceptGone: true });
  check("一覧0件も accept_gone で基準を進められる", b.failures.some((f) => /0件/.test(f)) && c.failures.length === 0 && c.baseline === true, c.failures.join(" / "));
  // 取り寄せの途中で上書きされた（大きさが同じ）もの
  const { r2: r2e } = fakeR2();
  const raced = fakeSource({ "sns-hub-media": {}, "raw-pages": many("p", 1), analogy: {} });
  const realDl = raced.download.bind(raced);
  raced.download = async (b, p) => ({ ...(await realDl(b, p)), etag: '"ffffffff"' });
  const e1 = await runMirror({ source: raced, r2: r2e, now: t(21), initial: true });
  check("取り寄せた eTag が一覧と違えば写し損ね（古い中身を新しい指紋で記録しない）", e1.failures.some((f) => /eTag/.test(f)) && e1.perBucket["raw-pages"].written === 0);
  raced.download = async (b, p) => ({ ...(await realDl(b, p)), etag: `W/"${sha256(raced.files[b][p].body).slice(0, 8)}"` });
  const { r2: r2f } = fakeR2();
  const e2 = await runMirror({ source: raced, r2: r2f, now: t(21), initial: true });
  check("eTag の W/ と引用符の違いは同じとみなす", e2.failures.length === 0, e2.failures.join(" / "));
  check("Supabase のオブジェクト単位の 403 は鍵の誤りにしない、5xx は一時的な失敗", classifyLog("::error::raw-pages: 1件: Supabase storage object error 403（get）") !== "config" && classifyLog("::error::raw-pages: 1件: Supabase storage object error 503（get）") === "transient");
  check("例外の文からパス（そのまま・符号化）を消す", scrubPath("Failed to parse URL from https://x/a%20b/%E7%A7%98.png", "a b/秘.png") === "Failed to parse URL from https://x/…");
}

// 412 からの復旧（前の run が manifest を書く前に落ちた）
{
  const { r2, store } = fakeR2();
  const src = fakeSource({
    "sns-hub-media": { "x.png": { body: Buffer.from("x"), type: "image/png" } },
    "raw-pages": {},
    analogy: {},
  });
  store.set("objects/sns-hub-media/x.png", {
    body: Buffer.from("x"),
    contentType: "image/png",
    sha: sha256(Buffer.from("x")),
  });
  const r = await runMirror({ source: src, r2, now: t(21), initial: true });
  check(
    "412: 既にある版が同じ sha256 なら採る",
    r.failures.length === 0 && store.size === 2,
  );
  const { r2: r2b, store: sb } = fakeR2();
  sb.set("objects/sns-hub-media/x.png", {
    body: Buffer.from("old"),
    contentType: "image/png",
    sha: sha256(Buffer.from("old")),
  });
  const rb = await runMirror({
    source: src,
    r2: r2b,
    now: t(21),
    initial: true,
  });
  check(
    "412: 既にある版と中身が違えば versions/ に書く",
    rb.failures.length === 0 &&
      sb.has(`versions/${rb.stamp}/sns-hub-media/x.png`),
  );
}

{
  let err = null;
  await runMirror({
    source: fakeSource({}),
    r2: fakeR2().r2,
    now: t(21),
    buckets: ["analogy-v16"],
    initial: true,
  }).catch((e) => (err = e));
  check(
    "analogy-v16 は写さない",
    /写さない/.test(err?.message ?? "") &&
      !SOURCE_BUCKETS.some((b) => EXCLUDED_BUCKETS.includes(b)),
  );
  check(
    "写す元は3バケット",
    JSON.stringify(SOURCE_BUCKETS) ===
      JSON.stringify(["sns-hub-media", "raw-pages", "analogy"]),
  );
}

// ---- 4. ログの分類 ----
{
  const { r2 } = fakeR2();
  const bad = createR2Client(
    {
      accountId: "0".repeat(32),
      bucket: "m",
      accessKeyId: "k",
      secretAccessKey: "s",
    },
    {
      fetchImpl: async () =>
        new Response("<Error><Code>InvalidAccessKeyId</Code></Error>", {
          status: 403,
        }),
    },
  );
  let e1 = null;
  await bad.listOne("manifests/").catch((e) => (e1 = e));
  check(
    "R2 の一覧の 403 は鍵・設定の誤りに分ける",
    classifyLog(`::error::${e1?.message}`) === "config",
    e1?.message,
  );
  let e2 = null;
  await bad
    .put("objects/a", Buffer.from("a"), {
      contentType: "text/plain",
      md5: "x",
      sha256: sha256(Buffer.from("a")),
    })
    .catch((e) => (e2 = e));
  check(
    "オブジェクト単位の 403 は鍵の誤りにしない（キーを含めない）",
    classifyLog(`::error::${e2?.message}`) !== "config" &&
      !/objects\/a/.test(e2?.message),
    e2?.message,
  );
  let e3 = null;
  try {
    r2EnvOrThrow({});
  } catch (e) {
    e3 = e;
  }
  check(
    "R2 の secret 未設定は鍵・設定の誤り",
    classifyLog(`::error::${e3?.message}`) === "config",
    e3?.message,
  );
  void r2;
}

// ---- 5. 鍵の role ----
{
  const jwt = (role) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
  check(
    "鍵の role: service_role の JWT",
    keyRole(jwt("service_role")) === "service_role",
  );
  check("鍵の role: anon の JWT を見分ける", keyRole(jwt("anon")) === "anon");
  check(
    "鍵の role: 新しい形",
    keyRole("sb_secret_x") === "service_role" &&
      keyRole("sb_publishable_x") === "anon",
  );
  check("鍵の role: 読めない形は null", keyRole("garbage") === null);
}

// ---- 7. 復元の試験 ----
{
  for (const b of [...SOURCE_BUCKETS, ...EXCLUDED_BUCKETS, "other"]) {
    let err = null;
    try {
      assertDrillTarget(b);
    } catch (e) {
      err = e;
    }
    check(`復元の試験: 戻す先 ${b} を拒む`, !!err);
  }
  let ok = true;
  try {
    assertDrillTarget(DRILL_BUCKET);
  } catch {
    ok = false;
  }
  check("復元の試験: 戻す先は storage-mirror-drill だけ", ok && DRILL_BUCKET === "storage-mirror-drill");

  const entries = {
    "raw-pages/a": { bucket: "raw-pages", size: 1, goneAt: null },
    "raw-pages/big": { bucket: "raw-pages", size: 99, goneAt: null },
    "raw-pages/gone": { bucket: "raw-pages", size: 500, goneAt: "2026-10-20T00:00:00Z" },
    ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`analogy/${i}`, { bucket: "analogy", size: i, goneAt: null }])),
  };
  const sample = pickDrillSample(entries, { n: 5, random: () => 0.5 });
  check("見本: バケットごとに一番大きいもの＋n件、消えたものは入れない",
    sample.some(([k]) => k === "raw-pages/big") && sample.some(([k]) => k === "analogy/29") &&
      sample.filter(([, e]) => e.bucket === "analogy").length === 6 && !sample.some(([k]) => k === "raw-pages/gone"));
  check("全部（all）: 元にあるもの全部", pickDrillSample(entries, { all: true }).length === 32);
  check("Content-Type の比べ方は大文字小文字・; の空白だけを揃える", sameType("text/plain; charset=utf-8", "Text/Plain;charset=UTF-8") && !sameType("image/png", "image/jpeg"));

  const { r2, store } = fakeR2();
  const src = fakeSource({
    "sns-hub-media": { [SECRET_PATH]: { body: Buffer.from("video"), type: "video/mp4" }, "t.txt": { body: Buffer.from("t"), type: "text/plain; charset=utf-8" } },
    "raw-pages": many("pit", 3),
    analogy: many("v1", 2),
  });
  let err = null;
  const fakeDrill = (mutate = (b) => b, typeOf = (t) => t) => {
    const d = new Map();
    return {
      d,
      bucket: DRILL_BUCKET,
      async upload(k, body, contentType) {
        d.set(k, { body: mutate(Buffer.from(body)), contentType: typeOf(contentType) });
      },
      async download(k) {
        return d.get(k);
      },
    };
  };
  await runDrill({ r2, drill: fakeDrill() }).catch((e) => (err = e));
  check("復元の試験: 写しがまだ無ければ止める", /基準の manifest が無い/.test(err?.message ?? ""));
  await runMirror({ source: src, r2, now: t(21), initial: true });
  const good = fakeDrill();
  const r = await runDrill({ r2, drill: good, all: true });
  check("復元の試験: 全部を戻し、sha256 と Content-Type が一致", r.failures.length === 0 && good.d.size === 7 && good.d.has(`sns-hub-media/${SECRET_PATH}`), r.failures.join(" / "));
  const badType = await runDrill({ r2, drill: fakeDrill(undefined, () => "application/octet-stream"), all: true });
  check("復元の試験: 戻した後の Content-Type が違えば失敗（文にパスを入れない）",
    badType.failures.length > 0 && !badType.failures.join("").includes("秘密"), badType.failures.join(" / "));
  const badBody = await runDrill({ r2, drill: fakeDrill((b) => Buffer.concat([b, Buffer.from("x")])), all: true });
  check("復元の試験: 戻した後の中身が違えば失敗", badBody.failures.some((f) => /sha256/.test(f)));
  store.get("objects/raw-pages/pit/0.gz").body = Buffer.from("rotten");
  const rot = await runDrill({ r2, drill: fakeDrill(), all: true });
  check("復元の試験: R2 の写しが壊れていれば失敗", rot.failures.some((f) => /R2 から読んだ/.test(f)));

  // R2 の Content-Type が manifest と違う
  store.get("objects/raw-pages/pit/1.gz").contentType = "text/html";
  const badR2Type = await runDrill({ r2, drill: fakeDrill(), all: true });
  check("復元の試験: R2 の Content-Type が manifest と違えば失敗", badR2Type.failures.some((f) => /R2 の Content-Type/.test(f)), badR2Type.failures.join(" / "));

  // 偽の manifest（R2 の token の漏れ）でも、試験用のバケットの外へ書かない
  const good1 = { bucket: "raw-pages", path: "p/a.gz", r2Key: "objects/raw-pages/p/a.gz" };
  const ok1 = (() => { try { assertDrillEntry("raw-pages/p/a.gz", good1); return true; } catch { return false; } })();
  const bad = [
    ["storage-mirror-drill/../raw-pages/x", { bucket: "raw-pages", path: "../raw-pages/x", r2Key: "objects/x" }],
    ["raw-pages/../../analogy/y", { bucket: "raw-pages", path: "../../analogy/y", r2Key: "objects/y" }],
    ["raw-pages/a/./b", { bucket: "raw-pages", path: "a/./b", r2Key: "objects/z" }],
    ["raw-pages/a//b", { bucket: "raw-pages", path: "a//b", r2Key: "objects/z" }],
    ["analogy/x", { bucket: "raw-pages", path: "x", r2Key: "objects/z" }],
    ["analogy-v16/x", { bucket: "analogy-v16", path: "x", r2Key: "objects/z" }],
    ["raw-pages/x", { bucket: "raw-pages", path: "x", r2Key: "manifests/z" }],
  ];
  const rejected = bad.filter(([k, e]) => { try { assertDrillEntry(k, e); return false; } catch { return true; } }).length;
  check("復元の試験: manifest の行の形（.. ・空の区切り・キーの不一致・写す元以外・R2 のキー）を拒む", ok1 && rejected === bad.length, `${rejected}/${bad.length}`);

  const sent = [];
  const fakeFetch = async (u, opt = {}) => {
    sent.push({ path: new URL(u).pathname, method: opt.method ?? "GET", headers: opt.headers ?? {} });
    if ((opt.method ?? "GET") === "POST") return new Response("{}", { status: 200 });
    return new Response(Buffer.from("x"), { status: 200, headers: { "content-type": "image/png" } });
  };
  const tgt = createDrillTarget({ url: "https://abc.supabase.co/", key: "k", fetchImpl: fakeFetch });
  await tgt.upload("raw-pages/秘 (1).gz", Buffer.from("x"), "application/gzip");
  await tgt.download("raw-pages/秘 (1).gz");
  check("復元の口: 上げると読み直しは同じ試験用のバケットのパス、x-upsert と no-cache",
    sent.length === 2 && sent.every((x) => x.path.startsWith("/storage/v1/object/storage-mirror-drill/raw-pages/")) &&
      sent[0].method === "POST" && sent[0].headers["x-upsert"] === "true" && sent[0].headers["cache-control"] === "no-cache" &&
      sent[0].path === sent[1].path);
  let escErr = null;
  await tgt.upload("../raw-pages/x", Buffer.from("x"), "application/gzip").catch((e) => (escErr = e));
  check("復元の口: 正規化で試験用のバケットの外になる URL は送らない", /外/.test(escErr?.message ?? "") && sent.length === 2);

  const forged = fakeR2();
  forged.store.set("manifests/20261021T194000Z.json.gz", {
    body: zlib.gzipSync(Buffer.from(JSON.stringify({ version: 1, baseline: true, entries: {
      "raw-pages/../../raw-pages/x": { bucket: "raw-pages", path: "../../raw-pages/x", r2Key: "objects/x", sha256: sha256(Buffer.from("x")), contentType: "image/png", size: 1, goneAt: null },
    } }))),
    contentType: "application/gzip",
  });
  forged.store.set("objects/x", { body: Buffer.from("x"), contentType: "image/png", sha: sha256(Buffer.from("x")) });
  sent.length = 0;
  const fr = await runDrill({ r2: forged.r2, drill: tgt, all: true });
  check("復元の試験: 偽の manifest の .. の行は失敗にし、Supabase に何も送らない", fr.failures.length === 1 && sent.length === 0, fr.failures.join(" / "));

  // URL は試験用のバケットの中に収まるが、行の形が正しくない（キーとバケットの不一致）
  const forged2 = fakeR2();
  forged2.store.set("manifests/20261021T194000Z.json.gz", {
    body: zlib.gzipSync(Buffer.from(JSON.stringify({ version: 1, baseline: true, entries: {
      "analogy/x": { bucket: "raw-pages", path: "x", r2Key: "objects/x", sha256: sha256(Buffer.from("x")), contentType: "image/png", size: 1, goneAt: null },
    } }))),
    contentType: "application/gzip",
  });
  forged2.store.set("objects/x", { body: Buffer.from("x"), contentType: "image/png", sha: sha256(Buffer.from("x")) });
  sent.length = 0;
  const fr2 = await runDrill({ r2: forged2.r2, drill: tgt, all: true });
  check("復元の試験: 行の形の検査は runDrill の中で効く（キーとバケットが合わない行は送らない）", fr2.failures.length === 1 && sent.length === 0, fr2.failures.join(" / "));

  const rs = read("scripts/storage-mirror/restore.js");
  check("restore.js: 消す呼び出し・自前の fetch が無く、戻す先は createDrillTarget（定数）だけ、失敗で exit 1",
    !/DELETE|\.remove\(|createBucket|deleteBucket|emptyBucket|fetch\(/.test(rs) &&
      !/process\.env\.\w*BUCKET|argv\[/.test(rs.replace(/process\.env\.GITHUB_STEP_SUMMARY/g, "")) &&
      /createDrillTarget\(supabaseEnv\(\)\)/.test(rs) &&
      /if \(result\.failures\.length\) \{[\s\S]{0,120}process\.exit\(1\)/.test(rs));
  const dl = read("scripts/lib/storageMirrorDrill.js");
  check("storageMirrorDrill.js: 消す呼び出しが無い", !/DELETE|\.remove\(|createBucket|deleteBucket|emptyBucket/.test(dl));
}

// ---- 6. 配線 ----
{
  const dir = "scripts/storage-mirror";
  // Supabase に触るのは supabase-source.js だけ（一覧は api/_lib/analogyV16.js の listObjects、読み取りは GET）。
  // ほかのファイルは Supabase の URL・鍵を読まない
  const sb = read(`${dir}/supabase-source.js`);
  check(
    "写しの側の Supabase の口は一覧と GET だけ（method の指定・upload・remove・createClient・x-upsert が無い）",
    !/method\s*:|\.upload\(|\.remove\(|createClient|x-upsert/.test(sb) &&
      /import \{ listObjects \} from "..\/..\/api\/_lib\/analogyV16.js"/.test(
        sb,
      ),
  );
  check(
    "Supabase の鍵を読むのは supabase-source.js だけ",
    readdirSync(path.join(ROOT, dir))
      .filter(
        (f) =>
          f.endsWith(".js") &&
          f !== "supabase-source.js",
      )
      .every((f) => !/SUPABASE_/.test(read(`${dir}/${f}`))),
  );
  check("R2 に消す呼び出しを持たない", !/DELETE/.test(read(`${dir}/r2.js`)));
  check(
    "R2 の PUT は必ず If-None-Match: *",
    /"if-none-match": "\*"/.test(read(`${dir}/r2.js`)),
  );

  for (const name of ["storage-mirror", "storage-mirror-restore-drill"]) {
    const wf = read(`.github/workflows/${name}.yml`);
    const body = wf.replace(/^\s*#.*\n/gm, "");
    check(
      `${name}: permissions は空、job は contents: read`,
      /^permissions: \{\}$/m.test(body) &&
        /permissions:\n\s+contents: read/.test(body),
    );
    check(
      `${name}: environment は prod-jobs`,
      /environment: prod-jobs/.test(body),
    );
    check(
      `${name}: action は SHA で固定・資格情報を残さない`,
      [...body.matchAll(/uses: (\S+)/g)].every((m) =>
        /@[0-9a-f]{40}$/.test(m[1]),
      ) && /persist-credentials: false/.test(body),
    );
    check(
      `${name}: npm ci をしない（依存を入れない）`,
      !/npm (ci|install)/.test(body),
    );
    const runs = [
      ...body.matchAll(
        /^( +)run: ([\s\S]*?)(?=^\1(?:- |[a-z-]+:)|^ {0,4}[a-z-]+:|(?![\s\S]))/gm,
      ),
    ].map((m) => m[2]);
    check(
      `${name}: run に \${{ }} を書かない`,
      runs.length > 0 && runs.every((r) => !r.includes("${{")),
    );
    check(
      `${name}: 手での起動の入力は boolean だけ`,
      [...body.matchAll(/type: (\w+)/g)].every((m) => m[1] === "boolean"),
    );
    check(
      `${name}: 同時に2本動かさない`,
      new RegExp(`concurrency:\\n\\s+group: ${name}\\n\\s+cancel-in-progress: false`).test(
        body,
      ),
    );
  }

  const canary = read(".github/workflows/key-canary.yml");
  check(
    "key-canary に R2 の job（prod-jobs）がある",
    /\n {2}r2:\n[\s\S]*?environment: prod-jobs[\s\S]*?storage-mirror\/canary\.js/.test(
      canary,
    ),
  );
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
