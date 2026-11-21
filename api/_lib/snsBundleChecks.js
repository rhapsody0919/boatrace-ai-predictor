// 素材バンドルの検査（snsBundleValidation.js の validateBundle）の段ごとの検査・保留・manifest・リスクの旗。元の順のまま取り出した。
import { matchRiskRules, bundleRiskFields } from "../../scripts/lib/riskRuleMatcher.js";
import {
  BUNDLE_SCHEMA_V1,
  EXPECTED,
  SELF_ATTESTED,
  SHA,
  SOURCES,
  X_VIDEO,
  ensure,
  record,
  text,
} from "./snsBundleValidationParts.js";

/** schema_version・race_id・stage の検査。v1 かを返す */
export function checkBundleHeader(bundle, { schemas, acceptsV1, files }) {
  ensure(
    record(bundle) && schemas.includes(bundle.schema_version),
    acceptsV1 ? "未対応のschema_versionです" : "未対応のschema_versionです（v0のみ）",
  );
  const v1 = bundle.schema_version === BUNDLE_SCHEMA_V1;
  ensure(v1 || !files.has(X_VIDEO), `${X_VIDEO}はv1だけです`);
  ensure(
    typeof bundle.race_id === "string" &&
      /^\d{4}-\d{2}-\d{2}-(0[1-9]|1\d|2[0-4])-(0[1-9]|1[0-2])$/.test(
        bundle.race_id,
      ),
    "race_idが不正です",
  );
  ensure(["racecard", "exhibition"].includes(bundle.stage), "stageが不正です");
  return v1;
}

/** v1 は欄の検査（v1Fields）、v0 は公開状態・本文・タイトル・型IDの検査 */
export function checkVersionFields(bundle, files, v1, v1Fields) {
  if (v1) {
    ensure(typeof v1Fields === "function", "v1の検査（v1Fields）が渡されていません", 500);
    v1Fields(bundle, files);
    return;
  }
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
}

const validScene = (s) =>
  record(s) &&
  Number.isFinite(s.seconds) &&
  s.seconds > 0 &&
  text(s.tab, 200) &&
  text(s.component, 500) &&
  Array.isArray(s.lines) &&
  s.lines.every((l) => text(l, 2000));

/** source_data・scenes の検査 */
export function checkScenes(bundle) {
  ensure(
    record(bundle.source_data) &&
      Array.isArray(bundle.scenes) &&
      bundle.scenes.length === 3 &&
      bundle.scenes.every(validScene),
    "scenes/source_dataが不正です",
  );
}

const validClaim = (c) =>
  record(c) &&
  SOURCES.includes(c.source) &&
  Array.isArray(c.path) &&
  c.path.length > 0 &&
  c.path.length <= 30 &&
  c.path.every((p) => typeof p === "string" || Number.isInteger(p)) &&
  Object.hasOwn(c, "value");

/** claims の形の検査（v1 は claims を公開 API の読み直しで照合するので見ない） */
export function checkClaimsShape(bundle, v1) {
  ensure(
    v1 ||
    (Array.isArray(bundle.claims) &&
      bundle.claims.length <= 100 &&
      bundle.claims.every(validClaim)),
    "claimsが不正です",
  );
}

/** qa.json の検査 */
export function checkQa(qa) {
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
}

/** integrity.json の検査と、添付のハッシュとの一致 */
export function checkIntegrity(integrity, allowedNames, files) {
  ensure(
    record(integrity) && SHA.test(integrity["bundle.json"]),
    "integrityのbundle.jsonハッシュは必須です",
  );
  for (const [name, hash] of Object.entries(integrity)) {
    ensure(
      allowedNames.includes(name) && SHA.test(hash),
      "integrityのファイル名・ハッシュが不正です",
    );
    if (files.has(name))
      ensure(files.get(name).hash === hash, `${name}: ハッシュ不一致です`);
  }
}

/** 添付されなかった名前（v1 は x-draft.txt を求めない） */
export const missingFiles = (files, v1) =>
  (v1 ? [...EXPECTED, X_VIDEO] : EXPECTED).filter(
    (n) => !files.has(n) && !(v1 && n === "x-draft.txt"),
  );

/** 検査の最初の保留。v0 は恒久の保留。v1 は検査（素材・QA・照合）の結果だけを保留にし、公開の可否は送信の側（auto-plan の検査）で決める */
export function initialHolds(v1, missing, qa) {
  const holds = v1
    ? []
    : [
        "v0素材はローカル保留専用です",
        "正式公開の証拠・確認主体・QA合格条件が未確定です",
        "ローカル型IDと既存の型の対応が未確定です",
      ];
  if (missing.length) holds.push(`不足ファイル: ${missing.join(", ")}`);
  if (!qa.pass || qa.numeric_claims_match === false || qa.L0_hits?.length > 0)
    holds.push("QA不合格です");
  return holds;
}

const isSourceMeta = (name) => SOURCES.some((s) => name === `${s}.meta.json`);
const isSourceJson = (name) => SOURCES.some((s) => name === `${s}.json`);

/** 出典メタの形（ハッシュ・URL・取得時刻・段・HTTP の状態）の検査 */
function checkMetaShape(name, meta, bundle) {
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
}

/** 出典メタの URL・取得時刻の検査（source は facts・similar・scenario・layer） */
function checkMetaUrl(name, meta, bundle, source) {
  let url;
  try {
    url = new URL(meta.url);
  } catch {
    /* 下で拒否 */
  }
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
}

/** 出典メタ（*.meta.json）の検査と、原文のハッシュとの一致。layer が固定段なら保留の理由を返す */
function sourceMetaHolds(name, parsed, bundle, files) {
  const meta = parsed.get(name);
  checkMetaShape(name, meta, bundle);
  const source = name.split(".")[0];
  checkMetaUrl(name, meta, bundle, source);
  const raw = files.get(`${source}.json`);
  const holds = [];
  if (source === "layer" && meta.stage === "racecard (fixed)")
    holds.push("layer原文は出走表の固定段です（取得条件を保存）");
  if (raw)
    ensure(
      raw.hash === meta.sha256,
      `${source}.json: 出典ハッシュ不一致です`,
    );
  return holds;
}

/** 原文（*.json）の形の検査と、出典メタのハッシュによる固定（固定されていれば true） */
function sourceJsonVerified(name, file, parsed) {
  ensure(
    record(parsed.get(name)),
    `${name}: 原文はJSONオブジェクトで添付してください`,
  );
  const meta = parsed.get(name.replace(".json", ".meta.json"));
  return Boolean(meta?.sha256 === file.hash);
}

/** 添付1件の manifest の行と、その保留の理由 */
function manifestEntry(name, file, parsed, { bundle, integrity, derived, files }) {
  let verified = integrity[name] === file.hash;
  const holds = [];
  if (isSourceMeta(name)) holds.push(...sourceMetaHolds(name, parsed, bundle, files));
  // 原文の形の検査は、ハッシュが integrity で固定済みでも必ず行う
  if (isSourceJson(name)) {
    const pinnedByMeta = sourceJsonVerified(name, file, parsed);
    verified ||= pinnedByMeta;
  }
  const selfAttested = SELF_ATTESTED.has(name);
  const isDerived = derived.includes(name);
  if (!verified && !selfAttested && !isDerived)
    holds.push(`${name}: 外部manifestで固定されたハッシュがありません`);
  const sourceMeta = isSourceJson(name)
    ? parsed.get(name.replace(".json", ".meta.json"))
    : null;
  const item = {
    name,
    sha256: file.hash,
    bytes: file.bytes.length,
    mime: file.mime,
    hash_verified: verified,
    ...(selfAttested && { verification: "self_attested" }),
    ...(isDerived && !verified && { verification: "derived" }),
    ...(record(sourceMeta) && {
      source_url: sourceMeta.url,
      fetched_at: sourceMeta.fetched_at,
      stage: sourceMeta.stage,
    }),
  };
  return { item, holds };
}

/** 添付ごとの manifest と保留の理由（添付の順） */
export function buildManifest(files, parsed, context) {
  const manifest = [];
  const holds = [];
  for (const [name, file] of files) {
    const entry = manifestEntry(name, file, parsed, { ...context, files });
    holds.push(...entry.holds);
    manifest.push(entry.item);
  }
  return { manifest, holds };
}

/** script.txt・x-draft.txt が bundle の本文と一致するか */
export function checkDraftTexts(bundle, decoded) {
  for (const [name, value] of [
    ["script.txt", bundle.script],
    ["x-draft.txt", bundle.x_text],
  ]) {
    ensure(value !== undefined || !decoded.has(name), `${name}: bundle本文がありません`);
    if (decoded.has(name))
      ensure(
        decoded.get(name).trim() === value.trim(),
        `${name}: bundle本文と一致しません`,
      );
  }
}

/** claims を原文と照合し、合わないものの保留の理由を返す。v1 の claims は公開 API の読み直しで照合する（tasks 9、送信の側）ので、ここでは照合しない */
export function claimHolds(bundle, parsed, v1) {
  const holds = [];
  for (const claim of v1 ? [] : bundle.claims) {
    const raw = parsed.get(`${claim.source}.json`);
    if (!raw) continue;
    const value = claim.path.reduce(
      (v, p) => (v != null && Object.hasOwn(v, p) ? v[p] : undefined),
      raw,
    );
    if (JSON.stringify(value) !== JSON.stringify(claim.value))
      holds.push(`数値照合不合格: ${claim.source}/${claim.path.join("/")}`);
  }
  return holds;
}

/** タグ・YouTube の説明欄の検査 */
export function checkTags(bundle) {
  for (const name of ['x_hashtags','youtube_tags']) {
    ensure(bundle[name] === undefined || (Array.isArray(bundle[name]) && bundle[name].length <= 30 && bundle[name].every(tag => text(tag,200))), `${name}: タグ欄が不正です`);
  }
  ensure(bundle.youtube_description === undefined || text(bundle.youtube_description,20000), 'youtube_description: 説明欄が不正です');
}

/** v1 の X のスレッドの1投稿の、下書きに付くリスクの欄 */
const threadFields = (bundle, post) => [
  // 下書きに付くのは投稿の本文だけでなく、共通のタイトルと添付の動画の場面の文字も（全体の riskFlags.x と同じ欄）
  { text: bundle.title, field: "body" },
  ...(bundle.scenes || []).flatMap((scene) => (scene.lines || []).map((line) => ({ text: line, field: "body" }))),
  { text: post.text, field: "body" },
  ...(post.index === 0 ? bundle.x_hashtags || [] : []).map((tag) => ({ text: tag, field: "hashtags" })),
];

/** 媒体ごと（x・youtube）と、v1 は X のスレッドの投稿ごと（取り込み関数が x_thread[index] を下書きの risk に入れる）のリスクの旗 */
export function buildRiskFlags(bundle, v1, warnings, riskRules) {
  const riskFlags = {};
  for (const platform of ['x', 'youtube']) {
    riskFlags[platform] = [
      ...matchRiskRules(bundleRiskFields(bundle, platform), platform, riskRules),
      ...warnings,
    ];
  }
  if (v1)
    riskFlags.x_thread = bundle.x_thread.map((post) => [
      ...matchRiskRules(threadFields(bundle, post), "x", riskRules),
      ...warnings,
    ]);
  return riskFlags;
}
