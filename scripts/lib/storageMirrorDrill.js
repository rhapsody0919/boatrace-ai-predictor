/**
 * Storage の写しの復元の試験（ADR-0098 の追記「復元の試験」）の本体。R2 の写しを Supabase の試験用のバケットへ戻し、
 * Supabase から読み直して、sha256 と Content-Type を manifest と照合する。取得・書き込みは引数で受け取る。
 *
 * 戻す先は DRILL_BUCKET の定数1つだけ（写す元の3バケット・analogy-v16 は拒む）。バケットはオーナーが作る（コードに作る呼び出しを
 * 置かない）。消す処理も置かない。毎回同じパス（{元のバケット}/{元のパス}）へ上書き（x-upsert）するので、容量は R2 の objects/ のパスの集合を超えない。
 */
import { encodeKeyPath } from "./awsSigV4.js";
import {
  EXCLUDED_BUCKETS,
  findBaseline,
  MANIFEST_PREFIX,
  manifestKeysNewestFirst,
  mapPool,
  scrubPath,
  sha256,
  SOURCE_BUCKETS,
} from "./storageMirror.js";

export const DRILL_BUCKET = "storage-mirror-drill";

/**
 * manifest の行を戻してよいか（R2 の token が漏れて偽の manifest を置かれても、試験用のバケットの外へ書かせない）。
 * キーは「元のバケット/元のパス」と一致し、元のバケットは写す元の3つのどれかで、パスの区切りに空・.・.. が無く、
 * R2 のキーは objects/ か versions/ の下。fetch の URL の正規化で .. が上の階層へ抜けるのを防ぐ
 */
export function assertDrillEntry(key, e) {
  const segs = String(e?.path ?? "").split("/");
  if (
    !SOURCE_BUCKETS.includes(e?.bucket) ||
    key !== `${e.bucket}/${e.path}` ||
    segs.some((x) => x === "" || x === "." || x === "..") ||
    !/^(?:objects|versions)\//.test(String(e.r2Key ?? ""))
  )
    throw new Error("manifest の行の形が正しくない（戻さない）");
}

/**
 * 試験用のバケットの口（Supabase の service key）。送る直前に、正規化した後の URL が試験用のバケットの下かを確かめる
 * @param {{url: string, key: string, fetchImpl?: typeof fetch}} cfg
 */
export function createDrillTarget({ url, key, fetchImpl = fetch }) {
  const base = `${url.replace(/\/$/, "")}/storage/v1/object/${DRILL_BUCKET}/`;
  const prefix = new URL(base).pathname;
  const target = (path) => {
    const u = `${base}${encodeKeyPath(path)}`;
    if (!new URL(u).pathname.startsWith(prefix) || new URL(u).pathname === prefix)
      throw new Error(`戻す先が ${DRILL_BUCKET} の外になる（戻さない）`);
    return u;
  };
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    bucket: DRILL_BUCKET,
    async upload(path, body, contentType) {
      const res = await fetchImpl(target(path), {
        method: "POST",
        headers: {
          ...auth,
          "Content-Type": contentType,
          "cache-control": "no-cache",
          "x-upsert": "true",
        },
        body,
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const hint = /Bucket not found/i.test(text)
          ? `（バケット ${DRILL_BUCKET} が無い。手順書の 10）`
          : "";
        // HTTP 403 の形にしない（鍵の Issue に分けない。カナリアの成功で閉じて見えなくなるため）
        throw new Error(`Supabase storage object error ${res.status}（drill upload）${hint}`);
      }
      await res.arrayBuffer().catch(() => null);
    },
    async download(path) {
      const res = await fetchImpl(target(path), {
        headers: { ...auth, "cache-control": "no-cache" },
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok)
        throw new Error(`Supabase storage object error ${res.status}（試験用のバケットから読み直し）`);
      return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"),
      };
    },
  };
}

/** 月1回の見本: バケットごとに一番大きいファイルと、ほかから最大 n 件 */
export const DRILL_SAMPLE_PER_BUCKET = 20;

export function assertDrillTarget(bucket) {
  if (
    bucket !== DRILL_BUCKET ||
    SOURCE_BUCKETS.includes(bucket) ||
    EXCLUDED_BUCKETS.includes(bucket)
  )
    throw new Error(`戻す先は ${DRILL_BUCKET} だけ（${bucket} は拒む）`);
}

/**
 * 試す行を選ぶ。all なら元にあるもの全部。そうでなければバケットごとに一番大きいものと、乱数で選んだ n 件
 * @param {Record<string, object>} entries manifest の entries
 * @param {{all?: boolean, n?: number, random?: () => number}} opts
 * @returns {Array<[string, object]>}
 */
export function pickDrillSample(
  entries,
  { all = false, n = DRILL_SAMPLE_PER_BUCKET, random = Math.random } = {},
) {
  const present = Object.entries(entries).filter(([, e]) => !e.goneAt);
  if (all) return present;
  const out = [];
  for (const b of SOURCE_BUCKETS) {
    const rows = present.filter(([, e]) => e.bucket === b);
    if (!rows.length) continue;
    const largest = rows.reduce((a, r) => (r[1].size > a[1].size ? r : a));
    const rest = rows.filter((r) => r !== largest);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    out.push(largest, ...rest.slice(0, n));
  }
  return out;
}

/** Content-Type の比べ方（大文字小文字と ; の前後の空白だけを揃える） */
export const sameType = (a, b) =>
  String(a ?? "")
    .toLowerCase()
    .replace(/\s*;\s*/g, ";") ===
  String(b ?? "")
    .toLowerCase()
    .replace(/\s*;\s*/g, ";");

/**
 * 1件を戻して照合する。失敗の文にパスを入れない（ログは公開）
 * @returns {Promise<{bytes: number}>}
 */
export async function drillOne(key, entry, { r2, drill }) {
  assertDrillEntry(key, entry);
  const got = await r2.get(entry.r2Key);
  if (sha256(got.body) !== entry.sha256)
    throw new Error("R2 から読んだ中身の sha256 が manifest と違う");
  if (!sameType(got.contentType, entry.contentType))
    throw new Error(
      `R2 の Content-Type（${got.contentType}）が manifest（${entry.contentType}）と違う`,
    );
  await drill.upload(key, got.body, got.contentType);
  const back = await drill.download(key);
  if (sha256(back.body) !== entry.sha256)
    throw new Error(
      "戻した後に Supabase から読んだ中身の sha256 が manifest と違う",
    );
  if (!sameType(back.contentType, entry.contentType))
    throw new Error(
      `戻した後の Content-Type（${back.contentType}）が manifest（${entry.contentType}）と違う`,
    );
  return { bytes: got.body.length };
}

/**
 * 試験の本体
 * @param {{ r2: {list: Function, get: Function, getManifest: Function},
 *           drill: {bucket: string, upload: (key: string, body: Buffer, contentType: string) => Promise<void>, download: (key: string) => Promise<{body: Buffer, contentType: string}>},
 *           all?: boolean, n?: number, random?: () => number, concurrency?: number }} deps
 */
export async function runDrill({
  r2,
  drill,
  all = false,
  n,
  random,
  concurrency = 4,
}) {
  assertDrillTarget(drill.bucket);
  const keys = manifestKeysNewestFirst(
    (await r2.list(MANIFEST_PREFIX)).map((o) => o.key),
  );
  const base = await findBaseline(keys, (k) => r2.getManifest(k));
  if (!base)
    throw new Error("基準の manifest が無い（写しがまだ動いていない）");
  const sample = pickDrillSample(base.manifest.entries, { all, n, random });
  if (!sample.length) throw new Error("試すファイルが0件");
  const results = await mapPool(sample, concurrency, ([key, e]) =>
    drillOne(key, e, { r2, drill }),
  );
  const perBucket = {};
  const errs = {};
  results.forEach((r, i) => {
    const b = sample[i][1].bucket;
    const s = (perBucket[b] ??= { tried: 0, ok: 0, bytes: 0, failed: 0 });
    s.tried += 1;
    if (r.ok) {
      s.ok += 1;
      s.bytes += r.value.bytes;
    } else {
      s.failed += 1;
      const msg = `${b}: ${scrubPath(r.error.message, sample[i][0])}`;
      errs[msg] = (errs[msg] ?? 0) + 1;
    }
  });
  return {
    manifestKey: base.key,
    perBucket,
    failures: Object.entries(errs).map(([m, c]) => `${c}件: ${m}`),
  };
}
