/**
 * Supabase Storage → Cloudflare R2 の写し（ADR-0100）の純粋関数と、run の本体（取得・書き込みは引数で受け取る）。
 * 実際の Supabase・R2 の呼び出しは scripts/storage-mirror/ にある。verify-storage-mirror.js が偽の口で通しで検査する。
 *
 * R2 の中の置き方:
 *   objects/{bucket}/{path}            そのパスで最初に写した版
 *   versions/{stamp}/{bucket}/{path}   同じパスの中身が変わったときの新しい版（stamp はスクリプトの開始、UTC）
 *   manifests/{stamp}.json.gz          その run の終わりの状態の全部。元で消えたものも goneAt を付けて残す。
 *                                      前の基準から変わらない日は書かない
 * 全部の PUT は If-None-Match: * で、同じキーに2回書かない（bucket lock と両立する）。
 *
 * リポジトリは PUBLIC で Actions のログは外から見えるので、失敗の文にファイルのパスを入れない（バケット名と件数だけ）。
 */
import { createHash } from "node:crypto";
import { amzDate, sha256Hex } from "./awsSigV4.js";

/** 写す元のバケット。analogy-v16 は作り直せて量が大きいので写さない（ADR-0100） */
export const SOURCE_BUCKETS = Object.freeze([
  "sns-hub-media",
  "raw-pages",
  "analogy",
]);
export const EXCLUDED_BUCKETS = Object.freeze(["analogy-v16"]);

export const MANIFEST_PREFIX = "manifests/";
export const MANIFEST_VERSION = 1;

/** 1つのバケットで、基準の manifest にあったものがこの割合以上（かつ件数以上）消えたら大量の削除とみなす */
export const MASS_GONE_RATIO = 0.2;
export const MASS_GONE_MIN = 10;

/**
 * 1回の run で取り寄せてよい量（初回の initial だけ外す）。指紋が毎日変わる誤り・token の悪用で、
 * lock で消せない版を大量に積まないため。ふだんは1日 数十件・約3MB
 */
export const RUN_LIMITS = Object.freeze({ maxFetch: 500, maxBytes: 200e6 });

/** `20261021T194000Z`（キーに使う） */
export const runStamp = amzDate;

export const sourceKey = (bucket, path) => `${bucket}/${path}`;
export const objectKey = (key) => `objects/${key}`;
export const versionKey = (stamp, key) => `versions/${stamp}/${key}`;
export const manifestKey = (stamp) => `${MANIFEST_PREFIX}${stamp}.json.gz`;

export const sha256 = sha256Hex;
export const md5Base64 = (buf) =>
  createHash("md5").update(buf).digest("base64");

/** 元で見つからない（一覧に出たのに GET が 404。写している最中に消えた等） */
export class SourceNotFound extends Error {}

/** 一覧のキーから manifest のキーを新しい順に。stamp は辞書順と時刻順が一致する */
export const manifestKeysNewestFirst = (keys) =>
  keys
    .filter((k) => /^manifests\/\d{8}T\d{6}Z\.json\.gz$/.test(k))
    .sort()
    .reverse();

/**
 * 比べる基準の manifest を選ぶ。大量の削除・一覧0件で基準にしない（baseline: false）と印を付けた manifest は飛ばす。
 * 鍵の取り違え（anon の鍵だと非公開のバケットの一覧が 200 で空になる）で「全部消えた」状態を基準にすると、
 * 翌日から何も写らないまま success になるため。
 * @returns {Promise<{key: string, manifest: object} | null>}
 */
export async function findBaseline(keysNewestFirst, getManifest) {
  for (const key of keysNewestFirst) {
    const m = await getManifest(key);
    if (m.version !== MANIFEST_VERSION)
      throw new Error(`manifest の版 ${m.version} を読めない`);
    if (m.baseline !== false) return { key, manifest: m };
  }
  return null;
}

/** 元の指紋（中身を読まずに変わったかを見る） */
export const fingerprint = (f) =>
  `${f.etag ?? ""}|${f.size}|${f.updatedAt ?? ""}`;

/**
 * 元の一覧と基準の manifest から、取り寄せるものを決める。
 * @returns {{ unchanged: string[], fetch: Array<{key: string, file: object}> }}
 */
export function planBucket(bucket, files, prevEntries) {
  const unchanged = [];
  const fetch = [];
  for (const file of files) {
    const key = sourceKey(bucket, file.path);
    const prev = prevEntries[key];
    if (prev && !prev.goneAt && prev.fingerprint === fingerprint(file))
      unchanged.push(key);
    else fetch.push({ key, file });
  }
  return { unchanged, fetch };
}

/** 基準にあって今回の一覧に無いもの（このバケットの、まだ消えた印の無いもの） */
export function goneKeys(bucket, listedKeys, prevEntries) {
  const listed = new Set(listedKeys);
  return Object.entries(prevEntries)
    .filter(([k, e]) => e.bucket === bucket && !e.goneAt && !listed.has(k))
    .map(([k]) => k);
}

export const presentCount = (bucket, entries) =>
  Object.values(entries).filter((e) => e.bucket === bucket && !e.goneAt).length;

/** 大量に消えたか（基準にあった件数に対して） */
export const isMassGone = (prevPresent, gone) =>
  gone >= MASS_GONE_MIN &&
  prevPresent > 0 &&
  gone / prevPresent >= MASS_GONE_RATIO;

/** eTag の比べ方（W/ と引用符を外す） */
export const normEtag = (e) => String(e).replace(/^W\//, "").replace(/"/g, "");

/** 一覧に出たのに GET が 404 のものが、写している最中の削除で説明できる数（2件か1%）を超えたか */
export const tooManyNotFound = (notFound, listed) =>
  notFound > Math.max(2, Math.floor(listed * 0.01));

/** 例外の文からファイルのパス（そのままと URL の符号化）を消す */
export function scrubPath(message, path) {
  let m = String(message);
  for (const p of [path, encodeURI(path), encodeURIComponent(path)])
    if (p) m = m.split(p).join("…");
  return m;
}

/** 並べて動かす（同時に n 個まで）。各要素の失敗は結果に入れ、全体は止めない */
export async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const j = i++;
      try {
        out[j] = { ok: true, value: await fn(items[j]) };
      } catch (e) {
        out[j] = { ok: false, error: e };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/**
 * 1つのファイルを写す。中身が前の版と同じなら書かない。元で見つからなければ { gone: true }。
 * known は最新の manifest（基準にしない run を含む）の同じパスの行。基準にしない run で既に書いた版と同じなら、それを採る
 * （lock で消せない重複を作らない）。既にあるキー（412）は、R2 の x-amz-meta-sha256 が同じなら採り、違えば次の候補へ進む。
 * @returns {Promise<{entry?: object, wrote: string|null, gone?: boolean}>}
 */
export async function mirrorOne({
  key,
  file,
  bucket,
  prev,
  known,
  stamp,
  source,
  r2,
}) {
  let got;
  try {
    got = await source.download(bucket, file.path);
  } catch (e) {
    if (e instanceof SourceNotFound) return { gone: true, wrote: null };
    throw e;
  }
  const { body, contentType } = got;
  // 一覧の後・取り寄せの前に上書きされた（大きさが同じ）ものを、新しい指紋で古い中身として記録しない
  if (got.etag && file.etag && normEtag(got.etag) !== normEtag(file.etag))
    throw new Error("取り寄せた eTag が一覧と違う（途中で上書きされた。翌日の run で取り直す）");
  if (typeof file.size === "number" && body.length !== file.size)
    throw new Error(
      "取り寄せた大きさが一覧と違う（途中で上書きされたか、壊れている）",
    );
  const hash = sha256(body);
  const base = {
    bucket,
    path: file.path,
    size: body.length,
    sha256: hash,
    contentType: contentType || file.contentType || "application/octet-stream",
    fingerprint: fingerprint(file),
    goneAt: null,
  };
  if (prev && prev.sha256 === hash)
    return {
      entry: { ...base, r2Key: prev.r2Key, firstSeen: prev.firstSeen },
      wrote: null,
    };
  if (known && known.sha256 === hash && known.r2Key)
    return {
      entry: {
        ...base,
        r2Key: known.r2Key,
        firstSeen: prev?.firstSeen ?? known.firstSeen ?? stamp,
      },
      wrote: null,
    };
  const candidates = prev
    ? [versionKey(stamp, key)]
    : [objectKey(key), versionKey(stamp, key)];
  for (const target of candidates) {
    const res = await r2.put(target, body, {
      contentType: base.contentType,
      md5: md5Base64(body),
      sha256: hash,
      meta: { sha256: hash, source: encodeURIComponent(key) },
    });
    const adopt =
      res === "created" || (await r2.head(target))?.meta?.sha256 === hash;
    if (adopt)
      return {
        entry: { ...base, r2Key: target, firstSeen: prev?.firstSeen ?? stamp },
        wrote: res === "created" ? target : null,
      };
  }
  throw new Error(
    "書く先が全部既にあり、中身が違う（同じ時刻の run が2本動いた）",
  );
}

/**
 * run の本体。
 * @param {{ source: {list: (bucket: string) => Promise<object[]>, download: (bucket: string, path: string) => Promise<{body: Buffer, contentType?: string}>},
 *           r2: {list: Function, put: Function, head: Function, getManifest: Function, putManifest: Function},
 *           now: Date, buckets?: readonly string[], concurrency?: number, initial?: boolean, acceptGone?: boolean,
 *           limits?: {maxFetch: number, maxBytes: number}, log?: (s: string) => void }} deps
 *   initial    初回（基準の manifest が無いときだけ。あれば拒む）。取り寄せの上限を外す
 *   acceptGone 大量の削除を「消したのは正しい」と認め、この run を基準にする（手での起動の入力）。取り寄せの上限も外す
 */
export async function runMirror({
  source,
  r2,
  now,
  buckets = SOURCE_BUCKETS,
  concurrency = 4,
  initial = false,
  acceptGone = false,
  limits = RUN_LIMITS,
  log = () => {},
}) {
  for (const b of buckets)
    if (EXCLUDED_BUCKETS.includes(b))
      throw new Error(`${b} は写さない（ADR-0100）`);
  const stamp = runStamp(now);
  const keys = manifestKeysNewestFirst(
    (await r2.list(MANIFEST_PREFIX)).map((o) => o.key),
  );
  const base = await findBaseline(keys, (k) => r2.getManifest(k));
  if (!base && !initial)
    throw new Error(
      "基準の manifest が無い。初回は手での起動で initial を付ける（docs/operation/storage-mirror-r2-owner-steps.md）",
    );
  if (base && initial)
    throw new Error("既に manifest があるので initial は付けない");
  const prevEntries = base?.manifest.entries ?? {};
  // 最新の manifest（基準にしない run でも）。そこで既に書いた版を重ねて書かないため
  const latestEntries =
    keys.length && keys[0] !== base?.key
      ? (await r2.getManifest(keys[0])).entries
      : prevEntries;
  log(
    base
      ? `基準の manifest: ${base.key}（${Object.keys(prevEntries).length}件）`
      : "初回（基準の manifest なし）",
  );

  const failures = [];
  const perBucket = {};
  const listed = {};
  let baseline = true;
  // 1. 一覧を全部取る
  for (const bucket of buckets) {
    const stat = {
      listed: 0,
      bytes: 0,
      unchanged: 0,
      fetched: 0,
      written: 0,
      writtenBytes: 0,
      gone: 0,
      failed: 0,
      massGone: false,
      notFound: 0,
    };
    perBucket[bucket] = stat;
    let files;
    try {
      files = await source.list(bucket);
    } catch (e) {
      // 一覧が取れないバケットは基準の状態のまま残す（消えた扱いにしない）
      // 一覧の口のエラーの文はフォルダのパスを含むので、状態の番号だけを出す
      const http = String(e.message).match(/HTTP \d{3}/)?.[0];
      const net = String(e.message).match(
        /fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|aborted/,
      )?.[0];
      failures.push(
        `${bucket}: Supabase storage の一覧の取得に失敗（${http ?? net ?? e.name}）`,
      );
      stat.failed += 1;
      continue;
    }
    if (
      files.length === 0 &&
      presentCount(bucket, prevEntries) > 0 &&
      !acceptGone
    ) {
      failures.push(
        `${bucket}: 一覧が0件（基準では ${presentCount(bucket, prevEntries)}件）。鍵の取り違え（anon の鍵）か、元が全部消えた。消えた扱いにしない。本当に空にしたのなら accept_gone を付ける`,
      );
      stat.failed += 1;
      baseline = false;
      continue;
    }
    stat.listed = files.length;
    stat.bytes = files.reduce((a, f) => a + (f.size ?? 0), 0);
    listed[bucket] = { files, ...planBucket(bucket, files, prevEntries) };
  }

  // 2. 量の上限（書く前に止める）
  const fetchAll = Object.values(listed).flatMap((l) => l.fetch);
  const fetchBytes = fetchAll.reduce((a, f) => a + (f.file.size ?? 0), 0);
  // accept_gone は人が確かめて起動するので外す（基準にしない日が続くと、古い基準との差が上限を超え、基準を進められなくなる）
  if (
    !initial &&
    !acceptGone &&
    (fetchAll.length > limits.maxFetch || fetchBytes > limits.maxBytes)
  )
    throw new Error(
      `取り寄せが ${fetchAll.length}件・${(fetchBytes / 1e6).toFixed(1)}MB で、1回の上限（${limits.maxFetch}件・${limits.maxBytes / 1e6}MB）を超える。指紋が毎日変わる誤りか、元で大量に書き換わった。何も書かずに止める`,
    );

  // 3. 写す
  const entries = { ...prevEntries };
  for (const [bucket, l] of Object.entries(listed)) {
    const stat = perBucket[bucket];
    stat.unchanged = l.unchanged.length;
    const results = await mapPool(l.fetch, concurrency, ({ key, file }) =>
      mirrorOne({
        key,
        file,
        bucket,
        prev: prevEntries[key],
        known: latestEntries[key],
        stamp,
        source,
        r2,
      }),
    );
    const gotGone = new Set();
    const errs = {};
    results.forEach((r, i) => {
      const { key } = l.fetch[i];
      stat.fetched += 1;
      if (!r.ok) {
        stat.failed += 1;
        // URL の解析の失敗などで例外の文にパスが混ざっても、公開のログに出さない
        const msg = scrubPath(r.error.message, l.fetch[i].file.path);
        errs[msg] = (errs[msg] ?? 0) + 1;
        return;
      }
      if (r.value.gone) {
        gotGone.add(key);
        stat.notFound += 1;
        return;
      }
      entries[key] = r.value.entry;
      if (r.value.wrote) {
        stat.written += 1;
        stat.writtenBytes += r.value.entry.size;
      }
    });
    for (const [msg, n] of Object.entries(errs))
      failures.push(`${bucket}: ${n}件: ${msg}`);
    if (tooManyNotFound(stat.notFound, l.files.length))
      failures.push(
        `${bucket}: 一覧に出たのに GET が 404 のものが ${stat.notFound}件（写している最中の削除にしては多い。キーの符号化の誤りを疑う）`,
      );
    const listedKeys = l.files
      .map((f) => sourceKey(bucket, f.path))
      .filter((k) => !gotGone.has(k));
    const gone = goneKeys(bucket, listedKeys, prevEntries);
    for (const k of gone)
      entries[k] = { ...prevEntries[k], goneAt: now.toISOString() };
    stat.gone = gone.length;
    const prevPresent = presentCount(bucket, prevEntries);
    stat.massGone = isMassGone(prevPresent, gone.length);
    if (stat.massGone && !acceptGone) {
      baseline = false;
      failures.push(
        `${bucket}: 基準の ${prevPresent}件のうち ${gone.length}件が元から消えた（写しには残っている）。この run は基準にしない。消したのが正しければ、手での起動で accept_gone を付ける`,
      );
    }
  }

  // 初回で写し損ねがあれば基準にしない（次も initial で始め直す。空に近い基準から毎日上限で落ちないため）
  if (initial && failures.length) baseline = false;

  // 4. manifest（変わらない日は書かない）
  const changed =
    !base || JSON.stringify(entries) !== JSON.stringify(prevEntries);
  const mKey = manifestKey(stamp);
  if (changed || !baseline) {
    const manifest = {
      version: MANIFEST_VERSION,
      stamp,
      createdAt: now.toISOString(),
      basedOn: base?.key ?? null,
      baseline,
      buckets: [...buckets],
      entries,
    };
    if ((await r2.putManifest(mKey, manifest)) === "exists")
      throw new Error(
        "同じ時刻の manifest が既にある（同じ時刻の run が2本動いた）",
      );
  }
  return {
    stamp,
    manifestKey: changed || !baseline ? mKey : null,
    baseline,
    perBucket,
    failures,
  };
}
