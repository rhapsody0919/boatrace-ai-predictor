/**
 * 素材バンドル v1 を Storage に上げ、取り込みの RPC を呼ぶ（sns-pdca-loop tasks 7、plan §1、ADR 0090）。
 * hq が手元で実行する。鍵は本体の .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）を読み、Codex には渡さない。
 * Vercel を通らないので、管理画面の取り込み（4 MiB）の上限を受けない（動画は1本 32 MiB まで）。
 *
 * 使い方:
 *   npm run sns:push-bundle -- <素材フォルダ> [--dry-run]
 *
 * 1. フォルダの中の決まった名前のファイルだけを読む（それ以外は無視して名前を出す）
 * 2. x_thread[0] の媒体が draft-x.mp4 で、フォルダに無ければ draft.mp4 から ffmpeg で 720×1280 に書き出す（一時フォルダ。素材フォルダは変えない）
 * 3. validateBundle（v0 と同じ検査＋v1 の欄）。--dry-run はここまで
 * 4. Storage へ上げ、import_sns_preview_bundle を呼ぶ（同じ版なら同じ下書きを返す）
 *
 * 結果の見方は docs/operation/sns-pdca-loop-runbook.md。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  BUNDLE_LIMITS,
  BUNDLE_LIMITS_V1,
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_V1,
  BUNDLE_FILE_NAMES,
  X_VIDEO,
  validateBundle,
} from "../../api/_lib/snsBundleValidation.js";
import { validateV1Fields } from "../../api/_lib/snsBundleV1.js";
import { pathToFileURL } from "node:url";

const run = promisify(execFile);
const ALLOWED = [...BUNDLE_FILE_NAMES, X_VIDEO];

const mimeOf = (name) =>
  name.endsWith(".json")
    ? "application/json"
    : name.endsWith(".txt")
      ? "text/plain"
      : name.endsWith(".png")
        ? "image/png"
        : "video/mp4";

/** X 用の 720×1280（9:16）の書き出し。音声は AAC、先頭に moov を置く */
export async function exportXVideo(source, target, exec = run) {
  await exec("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    target,
  ]);
}

/**
 * フォルダを読み、必要なら X 用の動画を書き出して、検査済みの bundle を返す
 * @returns {Promise<{validated: object, ignored: string[], derived: string[]}>}
 */
export async function prepareBundle(
  folder,
  { riskRules = [], exec = run } = {},
) {
  const names = await readdir(folder);
  const ignored = names.filter(
    (n) => !ALLOWED.includes(n) && !n.startsWith("."),
  );
  const files = new Map();
  for (const name of names.filter((n) => ALLOWED.includes(n)))
    files.set(name, await readFile(path.join(folder, name)));
  const bundle = JSON.parse(
    files.get("bundle.json")?.toString("utf8") ?? "null",
  );
  const derived = [];
  let tmp;
  try {
    if (
      bundle?.schema_version === BUNDLE_SCHEMA_V1 &&
      bundle.x_thread?.[0]?.media === X_VIDEO &&
      !files.has(X_VIDEO)
    ) {
      if (!files.has("draft.mp4"))
        throw new Error(`draft.mp4 が無いので ${X_VIDEO} を作れません`);
      tmp = await mkdtemp(path.join(tmpdir(), "sns-push-bundle-"));
      const target = path.join(tmp, X_VIDEO);
      await exportXVideo(path.join(folder, "draft.mp4"), target, exec);
      files.set(X_VIDEO, await readFile(target));
      derived.push(X_VIDEO);
    }
    const form = new FormData();
    for (const [name, bytes] of files)
      form.append("files", new Blob([bytes], { type: mimeOf(name) }), name);
    const validated = await validateBundle(form, riskRules, {
      schemas: [BUNDLE_SCHEMA, BUNDLE_SCHEMA_V1],
      // 容量の上限は v1 だけ広げる（v0 は管理画面の取り込みと同じ上限のまま）
      limits:
        bundle?.schema_version === BUNDLE_SCHEMA_V1
          ? BUNDLE_LIMITS_V1
          : BUNDLE_LIMITS,
      derived,
      v1Fields: validateV1Fields,
    });
    return { validated, ignored, derived };
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

/** 結果の要約（鍵・本文は出さない） */
export function summarize({ validated, ignored, derived }, data = null) {
  return {
    schema_version: validated.bundle.schema_version,
    race_id: validated.bundle.race_id,
    version_hash: validated.versionHash,
    files: validated.manifest.length,
    derived,
    ignored,
    missing: validated.missing,
    holds: validated.holds,
    risk_flags: Object.fromEntries(
      Object.entries(validated.riskFlags).map(([k, v]) => [
        k,
        Array.isArray(v[0]) ? v.map((x) => x.length) : v.length,
      ]),
    ),
    ...(data ? { imported: data } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");
  if (!folder)
    throw new Error(
      "使い方: npm run sns:push-bundle -- <素材フォルダ> [--dry-run]",
    );
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  const prepared = await prepareBundle(folder, { riskRules });
  if (dryRun) {
    console.log(JSON.stringify(summarize(prepared), null, 2));
    console.log("--dry-run: Storage へは上げていません");
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw new Error(
      ".env.local に SUPABASE_URL・SUPABASE_SERVICE_KEY がありません",
    );
  // 鍵を読んだ後に import する（snsHubHelpers は読み込み時に環境変数を読む）
  const { importValidatedBundle, bundleStore } =
    await import("../../api/_lib/snsBundleImport.js");
  const data = await importValidatedBundle(prepared.validated, bundleStore);
  console.log(JSON.stringify(summarize(prepared, data), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`push-bundle を止めた: ${error.message}`);
    process.exitCode = 1;
  });
