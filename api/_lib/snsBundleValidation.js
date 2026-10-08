import { matchRiskRules } from "../../scripts/lib/riskRuleMatcher.js";

/** v0専用。契約1の正式素材は、公開証拠・QA条件を別依頼で決めるまで受け入れない。 */
export const BUNDLE_SCHEMA = "ryujin-preview/0";
export const BUNDLE_LIMITS = {
  request: 4 * 1024 * 1024,
  json: 1536 * 1024,
  text: 64 * 1024,
  media: 2 * 1024 * 1024,
  files: 18,
};
const SOURCES = ["facts", "similar", "scenario", "layer"];
const REQUIRED = ["bundle.json", "qa.json", "integrity.json"];
const EXPECTED = [
  ...REQUIRED,
  "script.txt",
  "x-draft.txt",
  "draft.mp4",
  "scene-1.png",
  "scene-2.png",
  "scene-3.png",
  ...SOURCES.flatMap((s) => [`${s}.json`, `${s}.meta.json`]),
];
// qa.json・integrity.json・各*.meta.jsonは、manifestの外側でそれ自身のハッシュを
// 固定する手段が無い自己申告ファイル（integrity.jsonが自分自身を含むことはできず、
// meta.jsonはraw jsonを固定する側であってmeta.json自身を固定する側ではない）。
// これらを「外部manifestで固定されたハッシュがありません」の対象に含めると、
// 正しいv0 bundleでも毎回機械的に保留理由が6件付き、実際の異常と見分けが付かなく
// なるため、hold対象から除外する（2026-10-07、レビュー指摘の反映）。
const SELF_ATTESTED = new Set([
  "qa.json",
  "integrity.json",
  ...SOURCES.map((s) => `${s}.meta.json`),
]);
const SHA = /^[a-f0-9]{64}$/;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export class BundleValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function ensure(ok, message, status) {
  if (!ok) throw new BundleValidationError(message, status);
}
export async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Content-Lengthを信用せず、multipartを解析する前に実バイト数を制限する。 */
export async function readBundleForm(req) {
  const contentType = req.headers.get("content-type") || "";
  ensure(
    /^multipart\/form-data;\s*boundary=/i.test(contentType),
    "multipart/form-dataで添付してください",
  );
  ensure(req.body, "添付がありません");
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      ensure(
        size <= BUNDLE_LIMITS.request,
        "リクエスト全体は4 MiB以内にしてください",
        413,
      );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new BundleValidationError("multipartの構成が不正です");
  }
}

export async function validateBundle(form, riskRules = []) {
  const files = new Map();
  const parsed = new Map();
  const decoded = new Map();
  let total = 0;
  for (const [field, file] of form.entries()) {
    ensure(
      field === "files" && typeof file !== "string",
      "filesにファイルだけを添付してください",
    );
    ensure(
      EXPECTED.includes(file.name) && !files.has(file.name),
      "未対応または重複したファイル名です",
    );
    ensure(files.size < BUNDLE_LIMITS.files, "添付数が上限を超えています");
    const kind = file.name.endsWith(".json")
      ? "json"
      : file.name.endsWith(".txt")
        ? "text"
        : "media";
    ensure(file.size > 0, `${file.name}: 空のファイルです`);
    ensure(file.size <= BUNDLE_LIMITS[kind], `${file.name}: 容量超過です`, 413);
    total += file.size;
    ensure(total <= BUNDLE_LIMITS.request, "添付の合計容量超過です", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime;
    if (kind === "json" || kind === "text") {
      const allowed =
        kind === "json"
          ? ["application/json", "text/plain", "application/octet-stream", ""]
          : ["text/plain", "application/octet-stream", ""];
      ensure(allowed.includes(file.type), `${file.name}: 不正な型です`);
      let value;
      try {
        value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (kind === "json") parsed.set(file.name, JSON.parse(value));
      } catch {
        throw new BundleValidationError(`${file.name}: UTF-8/JSONが不正です`);
      }
      decoded.set(file.name, value);
      mime = kind === "json" ? "application/json" : "text/plain; charset=utf-8";
    } else if (file.name.endsWith(".png")) {
      ensure(
        ["image/png", "application/octet-stream", ""].includes(file.type) &&
          [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b),
        `${file.name}: PNGの型が不正です`,
      );
      mime = "image/png";
    } else {
      ensure(
        ["video/mp4", "application/octet-stream", ""].includes(file.type) &&
          bytes.length >= 12 &&
          String.fromCharCode(...bytes.slice(4, 8)) === "ftyp",
        `${file.name}: MP4の型が不正です`,
      );
      mime = "video/mp4";
    }
    files.set(file.name, { bytes, mime, hash: await sha256(bytes) });
  }
  for (const name of REQUIRED) ensure(files.has(name), `${name}は必須です`);
  const bundle = parsed.get("bundle.json");
  const qa = parsed.get("qa.json");
  const integrity = parsed.get("integrity.json");
  ensure(
    record(bundle) && bundle.schema_version === BUNDLE_SCHEMA,
    "未対応のschema_versionです（v0のみ）",
  );
  ensure(
    typeof bundle.race_id === "string" &&
      /^\d{4}-\d{2}-\d{2}-(0[1-9]|1\d|2[0-4])-(0[1-9]|1[0-2])$/.test(
        bundle.race_id,
      ),
    "race_idが不正です",
  );
  ensure(["racecard", "exhibition"].includes(bundle.stage), "stageが不正です");
  ensure(
    typeof bundle.local_only === "boolean" &&
      typeof bundle.release_verified === "boolean" &&
      text(bundle.approval_status, 30),
    "v0の公開状態が不正です",
  );
  ensure(
    text(bundle.title, 200) &&
      text(bundle.script, 20000) &&
      text(bundle.x_text, 20000) &&
      text(bundle.format, 50) &&
      text(bundle.template_variant_id, 100),
    "v0の本文・タイトル・型IDが不正です",
  );
  ensure(
    record(bundle.source_data) &&
      Array.isArray(bundle.scenes) &&
      bundle.scenes.length === 3 &&
      bundle.scenes.every(
        (s) =>
          record(s) &&
          Number.isFinite(s.seconds) &&
          s.seconds > 0 &&
          text(s.tab, 200) &&
          text(s.component, 500) &&
          Array.isArray(s.lines) &&
          s.lines.every((l) => text(l, 2000)),
      ),
    "scenes/source_dataが不正です",
  );
  ensure(
    Array.isArray(bundle.claims) &&
      bundle.claims.length <= 100 &&
      bundle.claims.every(
        (c) =>
          record(c) &&
          SOURCES.includes(c.source) &&
          Array.isArray(c.path) &&
          c.path.length > 0 &&
          c.path.length <= 30 &&
          c.path.every((p) => typeof p === "string" || Number.isInteger(p)) &&
          Object.hasOwn(c, "value"),
      ),
    "claimsが不正です",
  );
  ensure(
    record(qa) && typeof qa.pass === "boolean",
    "qa.passはbooleanで必須です",
  );
  ensure(
    (qa.L0_hits === undefined || Array.isArray(qa.L0_hits)) &&
      (qa.numeric_claims_match === undefined ||
        typeof qa.numeric_claims_match === "boolean") &&
      (qa.rate_recalculation === undefined ||
        typeof qa.rate_recalculation === "boolean") &&
      (qa.human_review === undefined || typeof qa.human_review === "string") &&
      (qa.L2 === undefined || typeof qa.L2 === "string"),
    "QA各項目の型が不正です",
  );
  ensure(
    record(integrity) && SHA.test(integrity["bundle.json"]),
    "integrityのbundle.jsonハッシュは必須です",
  );
  for (const [name, hash] of Object.entries(integrity)) {
    ensure(
      EXPECTED.includes(name) && SHA.test(hash),
      "integrityのファイル名・ハッシュが不正です",
    );
    if (files.has(name))
      ensure(files.get(name).hash === hash, `${name}: ハッシュ不一致です`);
  }
  const missing = EXPECTED.filter((n) => !files.has(n));
  const holds = [
    "v0素材はローカル保留専用です",
    "正式公開の証拠・確認主体・QA合格条件が未確定です",
    "ローカル型IDと既存の型の対応が未確定です",
  ];
  if (missing.length) holds.push(`不足ファイル: ${missing.join(", ")}`);
  if (!qa.pass || qa.numeric_claims_match === false || qa.L0_hits?.length > 0)
    holds.push("QA不合格です");
  const manifest = [];
  for (const [name, file] of files) {
    let verified = integrity[name] === file.hash;
    if (SOURCES.some((s) => name === `${s}.meta.json`)) {
      const meta = parsed.get(name);
      ensure(
        record(meta) &&
          SHA.test(meta.sha256) &&
          text(meta.url, 2048) &&
          text(meta.fetched_at, 100) &&
          (meta.stage === bundle.stage ||
            (name === "layer.meta.json" &&
              meta.stage === "racecard (fixed)")) &&
          meta.http_status === 200,
        `${name}: 出典メタが不正です`,
      );
      let url;
      try {
        url = new URL(meta.url);
      } catch {
        /* 下で拒否 */
      }
      const source = name.split(".")[0];
      // layerは出走表時点で固定して取得するため、bundle全体がexhibition段で
      // 組まれてもlayerの実際の取得URLは?stage=racecardのまま
      // （2026-10-07レビュー対応。固定前はbundle.stageと一致を要求していたため、
      // 展示後bundleに固定段layerを添えると常に拒否されていた）。
      const expectedUrlStage =
        source === "layer" && meta.stage === "racecard (fixed)"
          ? "racecard"
          : bundle.stage;
      ensure(
        url?.origin === "https://www.boat-ai.jp" &&
          url.pathname === `/api/analogy/${source}/${bundle.race_id}` &&
          url.searchParams.get("stage") === expectedUrlStage &&
          Number.isFinite(Date.parse(meta.fetched_at)),
        `${name}: URL・取得時刻が不正です`,
      );
      const raw = files.get(`${source}.json`);
      if (source === "layer" && meta.stage === "racecard (fixed)")
        holds.push("layer原文は出走表の固定段です（取得条件を保存）");
      if (raw)
        ensure(
          raw.hash === meta.sha256,
          `${source}.json: 出典ハッシュ不一致です`,
        );
    }
    if (SOURCES.some((s) => name === `${s}.json`)) {
      ensure(
        record(parsed.get(name)),
        `${name}: 原文はJSONオブジェクトで添付してください`,
      );
      const meta = parsed.get(name.replace(".json", ".meta.json"));
      verified ||= Boolean(meta?.sha256 === file.hash);
    }
    const selfAttested = SELF_ATTESTED.has(name);
    if (!verified && !selfAttested)
      holds.push(`${name}: 外部manifestで固定されたハッシュがありません`);
    const sourceMeta = SOURCES.some((s) => name === `${s}.json`)
      ? parsed.get(name.replace(".json", ".meta.json"))
      : null;
    manifest.push({
      name,
      sha256: file.hash,
      bytes: file.bytes.length,
      mime: file.mime,
      hash_verified: verified,
      ...(selfAttested && { verification: "self_attested" }),
      ...(record(sourceMeta) && {
        source_url: sourceMeta.url,
        fetched_at: sourceMeta.fetched_at,
        stage: sourceMeta.stage,
      }),
    });
  }
  for (const [name, value] of [
    ["script.txt", bundle.script],
    ["x-draft.txt", bundle.x_text],
  ]) {
    if (decoded.has(name))
      ensure(
        decoded.get(name).trim() === value.trim(),
        `${name}: bundle本文と一致しません`,
      );
  }
  for (const claim of bundle.claims) {
    const raw = parsed.get(`${claim.source}.json`);
    if (!raw) continue;
    const value = claim.path.reduce(
      (v, p) => (v != null && Object.hasOwn(v, p) ? v[p] : undefined),
      raw,
    );
    if (JSON.stringify(value) !== JSON.stringify(claim.value))
      holds.push(`数値照合不合格: ${claim.source}/${claim.path.join("/")}`);
  }
  // 入力順に依存しない実ファイル版。QA・原文・追加添付を変えた場合も別版にする。
  manifest.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const versionHash = await sha256(
    new TextEncoder().encode(
      JSON.stringify(manifest.map((m) => [m.name, m.sha256])),
    ),
  );
  const riskFlags = {};
  const shared = [bundle.title, ...bundle.scenes.flatMap((s) => s.lines)].join(
    "\n",
  );
  for (const platform of ["x", "youtube"]) {
    const content =
      shared + "\n" + (platform === "x" ? bundle.x_text : bundle.script);
    riskFlags[platform] = matchRiskRules(content, platform, riskRules);
  }
  return {
    bundle,
    qa,
    files,
    manifest,
    missing,
    holds,
    versionHash,
    riskFlags,
  };
}

/** 入力のreleaseフラグやQA.passを書き換えてもv0を公開可能にしない。 */
export function isBundlePublicationBlocked(draft) {
  return Boolean(
    draft.publish_blocked ||
    draft.bundle_import_id ||
    draft.bundle_version_hash,
  );
}
