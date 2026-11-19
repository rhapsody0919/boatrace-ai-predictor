import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_V1,
  BUNDLE_LIMITS,
  EXPECTED,
  REQUIRED,
  X_VIDEO,
  BundleValidationError,
  ensure,
  readFormFiles,
  sha256,
} from "./snsBundleValidationParts.js";
import { bundleConsistencyWarnings } from "./snsBundleConsistency.js";
import {
  buildManifest,
  buildRiskFlags,
  checkBundleHeader,
  checkClaimsShape,
  checkDraftTexts,
  checkIntegrity,
  checkQa,
  checkScenes,
  checkTags,
  checkVersionFields,
  claimHolds,
  initialHolds,
  missingFiles,
} from "./snsBundleChecks.js";

// 定数・小さな道具・検査の段は snsBundleValidationParts.js・snsBundleChecks.js・snsBundleConsistency.js へ移した。今までの名前はここから import できる
export {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_V1,
  BUNDLE_LIMITS,
  BUNDLE_LIMITS_V1,
  X_VIDEO,
  X_THREAD_MAX,
  BUNDLE_FILE_NAMES,
  record,
  text,
  BundleValidationError,
  ensure,
  sha256,
} from "./snsBundleValidationParts.js";

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

/**
 * @param {FormData} form
 * @param {object[]} riskRules
 * @param {{schemas?: string[], limits?: typeof BUNDLE_LIMITS, derived?: string[], v1Fields?: Function}} [options]
 *   schemas: 受け付ける版（既定は v0 だけ）。limits: 容量の上限。derived: 取り込み側が元のファイルから作ったファイル
 *   （integrity.json に無いのが正しいので、ハッシュの保留にしない）。v1Fields: v1 の欄の検査（snsBundleV1.js）。
 *   twitter-text を使うので、Edge の管理 API（isBundlePublicationBlocked だけを使う）に入れないよう、ここでは import しない
 */
export async function validateBundle(
  form,
  riskRules = [],
  {
    schemas = [BUNDLE_SCHEMA],
    limits = BUNDLE_LIMITS,
    derived = [],
    v1Fields = null,
  } = {},
) {
  const acceptsV1 = schemas.includes(BUNDLE_SCHEMA_V1);
  const allowedNames = acceptsV1 ? [...EXPECTED, X_VIDEO] : EXPECTED;
  const { files, parsed, decoded } = await readFormFiles(form, allowedNames, limits);
  for (const name of REQUIRED) ensure(files.has(name), `${name}は必須です`);
  const bundle = parsed.get("bundle.json");
  const qa = parsed.get("qa.json");
  const integrity = parsed.get("integrity.json");
  const v1 = checkBundleHeader(bundle, { schemas, acceptsV1, files });
  checkVersionFields(bundle, files, v1, v1Fields);
  checkScenes(bundle);
  checkClaimsShape(bundle, v1);
  checkQa(qa);
  checkIntegrity(integrity, allowedNames, files);
  const missing = missingFiles(files, v1);
  const holds = initialHolds(v1, missing, qa);
  const built = buildManifest(files, parsed, { bundle, integrity, derived });
  const { manifest } = built;
  holds.push(...built.holds);
  checkDraftTexts(bundle, decoded);
  holds.push(...claimHolds(bundle, parsed, v1));
  // 入力順に依存しない実ファイル版。QA・原文・追加添付を変えた場合も別版にする。
  manifest.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const versionHash = await sha256(
    new TextEncoder().encode(
      JSON.stringify(manifest.map((m) => [m.name, m.sha256])),
    ),
  );
  checkTags(bundle);
  const warnings = bundleConsistencyWarnings(bundle, parsed, files);
  holds.push(...warnings.map(w => w.description));
  const riskFlags = buildRiskFlags(bundle, v1, warnings, riskRules);
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
