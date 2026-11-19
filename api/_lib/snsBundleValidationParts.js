// 素材バンドルの検査（snsBundleValidation.js）から移した、定数・小さな道具・添付ファイルの読み込み（validateBundle の最初の段）。
/** v0 は恒久の公開保留。管理画面の手取り込み（import-bundle）は v0 だけを受け付ける。 */
export const BUNDLE_SCHEMA = "ryujin-preview/0";
/** v1（sns-pdca-loop tasks 6、plan §1）。scripts/sns/push-bundle.js だけが受け付ける（Vercel を通らないので容量の上限が違う） */
export const BUNDLE_SCHEMA_V1 = "ryujin-preview/1";
export const BUNDLE_LIMITS = {
  request: 4 * 1024 * 1024,
  json: 1536 * 1024,
  text: 64 * 1024,
  media: 2 * 1024 * 1024,
  files: 18,
};
// v1: 動画は送信契約と同じ 32 MiB まで（X 用の 720×1280 と YouTube 用の 1080×1920 の2本）
export const BUNDLE_LIMITS_V1 = {
  ...BUNDLE_LIMITS,
  request: 96 * 1024 * 1024,
  media: 32 * 1024 * 1024,
  files: 19,
};
export const SOURCES = ["facts", "similar", "scenario", "layer"];
// v1 だけのファイル。X 用の動画（push-bundle が draft.mp4 から ffmpeg で書き出す。tasks 6、2026-10-13 オーケストレーター判断）
export const X_VIDEO = "draft-x.mp4";
export const X_THREAD_MAX = 6;
export const REQUIRED = ["bundle.json", "qa.json", "integrity.json"];
export const EXPECTED = [
  ...REQUIRED,
  "script.txt",
  "x-draft.txt",
  "draft.mp4",
  "scene-1.png",
  "scene-2.png",
  "scene-3.png",
  ...SOURCES.flatMap((s) => [`${s}.json`, `${s}.meta.json`]),
];
/** v0・v1 共通のファイル名（v1 はこれに X_VIDEO を足す） */
export const BUNDLE_FILE_NAMES = EXPECTED;
// qa.json・integrity.json・各*.meta.jsonは、manifestの外側でそれ自身のハッシュを
// 固定する手段が無い自己申告ファイル（integrity.jsonが自分自身を含むことはできず、
// meta.jsonはraw jsonを固定する側であってmeta.json自身を固定する側ではない）。
// これらを「外部manifestで固定されたハッシュがありません」の対象に含めると、
// 正しいv0 bundleでも毎回機械的に保留理由が6件付き、実際の異常と見分けが付かなく
// なるため、hold対象から除外する（2026-10-07、レビュー指摘の反映）。
export const SELF_ATTESTED = new Set([
  "qa.json",
  "integrity.json",
  ...SOURCES.map((s) => `${s}.meta.json`),
]);
export const SHA = /^[a-f0-9]{64}$/;
export const record = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const text = (v, max) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max;

export class BundleValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function ensure(ok, message, status) {
  if (!ok) throw new BundleValidationError(message, status);
}
export async function sha256(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const kindOf = (name) =>
  name.endsWith(".json") ? "json" : name.endsWith(".txt") ? "text" : "media";

/** 添付1件の入口の検査（field・名前・重複・件数）。kind を返す */
function checkEntry(field, file, files, allowedNames, limits) {
  ensure(
    field === "files" && typeof file !== "string",
    "filesにファイルだけを添付してください",
  );
  ensure(
    allowedNames.includes(file.name) && !files.has(file.name),
    "未対応または重複したファイル名です",
  );
  ensure(files.size < limits.files, "添付数が上限を超えています");
  return kindOf(file.name);
}

/** json・text の添付を UTF-8 で読む。json は parse した値も返す */
function readTextFile(file, kind, bytes) {
  const allowed =
    kind === "json"
      ? ["application/json", "text/plain", "application/octet-stream", ""]
      : ["text/plain", "application/octet-stream", ""];
  ensure(allowed.includes(file.type), `${file.name}: 不正な型です`);
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { value, json: kind === "json" ? JSON.parse(value) : undefined };
  } catch {
    throw new BundleValidationError(`${file.name}: UTF-8/JSONが不正です`);
  }
}

/** png・mp4 の添付の型を見て mime を返す */
function mediaMime(file, bytes) {
  if (file.name.endsWith(".png")) {
    ensure(
      ["image/png", "application/octet-stream", ""].includes(file.type) &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b),
      `${file.name}: PNGの型が不正です`,
    );
    return "image/png";
  }
  ensure(
    ["video/mp4", "application/octet-stream", ""].includes(file.type) &&
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(4, 8)) === "ftyp",
    `${file.name}: MP4の型が不正です`,
  );
  return "video/mp4";
}

/** FormData の添付を全部読み、files（名前→{bytes, mime, hash}）・parsed（json の値）・decoded（text・json の文字列）を返す */
export async function readFormFiles(form, allowedNames, limits) {
  const files = new Map();
  const parsed = new Map();
  const decoded = new Map();
  let total = 0;
  for (const [field, file] of form.entries()) {
    const kind = checkEntry(field, file, files, allowedNames, limits);
    ensure(file.size > 0, `${file.name}: 空のファイルです`);
    ensure(file.size <= limits[kind], `${file.name}: 容量超過です`, 413);
    total += file.size;
    ensure(total <= limits.request, "添付の合計容量超過です", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let mime;
    if (kind === "json" || kind === "text") {
      const { value, json } = readTextFile(file, kind, bytes);
      if (kind === "json") parsed.set(file.name, json);
      decoded.set(file.name, value);
      mime = kind === "json" ? "application/json" : "text/plain; charset=utf-8";
    } else mime = mediaMime(file, bytes);
    files.set(file.name, { bytes, mime, hash: await sha256(bytes) });
  }
  return { files, parsed, decoded };
}
