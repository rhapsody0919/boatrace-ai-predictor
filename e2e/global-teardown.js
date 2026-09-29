import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  BODIES_DIR,
  E2E_MODE,
  HAR_PATH,
  META_PATH,
  RAW_EXTERNAL_PREFIX,
  RECORD_CACHE_DIR,
  RECORD_PARTIAL_ENV,
  RECORDED_AT_ENV,
  RECORDINGS_DIR,
} from "./fixtures.js";
import { harKey, mergeHarLogs } from "./har-merge.js";

/**
 * record モードの後始末。録画中に取った応答（RECORD_CACHE_DIR に1件ずつ）を
 * 1本に束ねて e2e/recordings/api.har に置き、録画時刻を meta.json に残す。
 */
export default function globalTeardown(config) {
  if (E2E_MODE !== "record") return;
  const outputDir = config.projects[0]?.outputDir;
  if (!outputDir) throw new Error("outputDir が取得できません");
  bundleRecordings(outputDir, process.env[RECORDED_AT_ENV], {
    partial: process.env[RECORD_PARTIAL_ENV] === "1",
  });
}

/**
 * 既存の録画のエントリを、本文を埋め込んだ形で読み出す（部分録画で残す分）。
 * 本文は bodies/ から読み、base64 で持つ（externalizeBodies が同じ sha1 名で書き戻す）
 */
function readExistingEntries() {
  if (!existsSync(HAR_PATH)) return [];
  const har = JSON.parse(readFileSync(HAR_PATH, "utf8"));
  return har.log.entries.map((entry) => {
    const { _file, ...content } = entry.response.content;
    if (!_file) return entry;
    const body = readFileSync(path.join(RECORDINGS_DIR, _file));
    return {
      ...entry,
      response: {
        ...entry.response,
        content: {
          ...content,
          text: body.toString("base64"),
          encoding: "base64",
        },
      },
    };
  });
}

export function bundleRecordings(
  outputDir,
  recordedAt,
  { partial = false } = {},
) {
  if (!recordedAt) throw new Error("録画時刻がありません");

  const files = listFiles(outputDir);
  const named = (prefix, ext) =>
    files.filter((f) => {
      const base = path.basename(f);
      return base.startsWith(prefix) && base.endsWith(ext);
    });
  const harFiles = existsSync(RECORD_CACHE_DIR)
    ? readdirSync(RECORD_CACHE_DIR)
        .filter((f) => f.endsWith(".har"))
        .map((f) => path.join(RECORD_CACHE_DIR, f))
    : [];
  if (harFiles.length === 0) {
    throw new Error(
      `${RECORD_CACHE_DIR} に録画した応答が1つもありません。録画に失敗しています`,
    );
  }

  const logs = harFiles.map((f) => JSON.parse(readFileSync(f, "utf8")).log);
  let merged = mergeHarLogs(logs);
  let kept = 0;
  if (partial) {
    // 対象を絞った録画（spec・-g・--project 指定）で全体を置き換えると、今回走らせて
    // いないテストの応答が録画から消え、以降のPRゲートでまとめて abort される。
    // 今回取った応答で既存の録画を上書きし、それ以外は残す
    const fresh = new Set(
      merged.har.log.entries.map((e) =>
        harKey(e.request.method, e.request.url, e.request.postData?.text),
      ),
    );
    const old = readExistingEntries().filter(
      (e) =>
        !fresh.has(
          harKey(e.request.method, e.request.url, e.request.postData?.text),
        ),
    );
    kept = old.length;
    merged = mergeHarLogs([merged.har.log, { entries: old }]);
  }
  const { har, supabaseOrigin, stats } = merged;

  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const bodyBytes = externalizeBodies(har);
  writeFileSync(HAR_PATH, JSON.stringify(har, null, 1) + "\n");
  const meta = {
    recordedAt,
    supabaseOrigin,
    entries: har.log.entries.length,
  };
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + "\n");
  // 手元で撮った録画は、まだ Release のどのポインタとも一致しない。目印を「local」にして、
  // 次の再生がポインタの録画で黙って上書きしないようにする（e2e-recording.js ensureRecording）
  writeFileSync(path.join(RECORDINGS_DIR, ".source-sha256"), "local\n");

  const external = new Set(
    named(RAW_EXTERNAL_PREFIX, ".json").flatMap((f) =>
      JSON.parse(readFileSync(f, "utf8")),
    ),
  );

  console.log(
    [
      `[e2e record] ${harFiles.length}件の応答を束ねました → ${path.relative(process.cwd(), HAR_PATH)}`,
      `  録画時刻: ${meta.recordedAt}`,
      `  応答: ${stats.unique}件（重複 ${stats.duplicates}件・失敗応答 ${stats.skippedFailed}件を除外）${partial ? `。部分録画のため既存の${kept}件を残した` : ""}`,
      `  本文: ${readdirSync(BODIES_DIR).length}ファイル・${(bodyBytes / 1024 / 1024).toFixed(1)}MB → ${path.relative(process.cwd(), BODIES_DIR)}/`,
      `  replay で止める外部通信: ${external.size === 0 ? "なし" : [...external].sort().join(", ")}`,
    ].join("\n"),
  );
}

/**
 * 応答本文を HAR から切り出し、内容の sha1 を名前にしたファイルに置く
 * （HAR 側は content._file で参照する。routeFromHAR は HAR からの相対パスで読む）。
 *
 * 1本の HAR に本文を埋め込むと 100MB を超え、GitHub の1ファイル上限に掛かる。
 * 本文ごとのファイルにすると、撮り直しで変わらなかった本文（過去日付の予測データ等）は
 * 同じ名前・同じ中身になり、リポジトリの履歴が増えない。前回の本文は全て消してから書く。
 */
function externalizeBodies(har) {
  rmSync(BODIES_DIR, { recursive: true, force: true });
  mkdirSync(BODIES_DIR, { recursive: true });
  let total = 0;
  for (const entry of har.log.entries) {
    const content = entry.response.content;
    if (content.text === undefined) continue;
    const buffer = Buffer.from(
      content.text,
      content.encoding === "base64" ? "base64" : "utf8",
    );
    const ext = (content.mimeType ?? "").includes("json") ? "json" : "txt";
    const name = `${createHash("sha1").update(buffer).digest("hex")}.${ext}`;
    const file = path.join(BODIES_DIR, name);
    if (!existsSync(file)) {
      writeFileSync(file, buffer);
      total += buffer.length;
    }
    delete content.text;
    delete content.encoding;
    content._file = `${path.basename(BODIES_DIR)}/${name}`;
  }
  return total;
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath ?? d.path, d.name));
}
