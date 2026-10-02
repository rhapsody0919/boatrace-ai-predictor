/**
 * BOA-271 アナロジー・ファインダーの Supabase Storage 連携（バケット `analogy`）
 *
 * - `{model_version}/model_{win,top2,top3,win_racecard}.txt.gz`・`train_meta.json.gz`: 学習した主モデル。
 *   次の週の品質ゲートで、参照版を同じ test で評価し直すのに使う
 * - `{model_version}/model_{win,win_racecard}.json.gz`・`per_race_meta.json.gz`・`parity_fixture.json.gz`:
 *   レースごとの寄与度（B、ADR-0083）。推論側の JS が読む（plan「学習側の設計」）
 * - `source/...`: 長期データの月ごとのキャッシュ（export_pool.js）
 * モデルの版は直近3つと表示中の版だけ残す（plan「Storage の版は直近3つだけ残す」）。表示中の版と同じ名前では
 * アップロードしない（規則は storageRules.js）。
 * `scripts/ml/storage-models.js`（ポアロ）と同じ流儀。
 *
 * 使い方:
 *   node scripts/ml/analogy/storage.js upload-model     # out/ → {version}/
 *   node scripts/ml/analogy/storage.js download-reference  # 参照版（reference.json）→ out/reference/
 */

import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../../lib/supabaseClient.js";
import { assertUploadable, versionsToPrune } from "./storageRules.js";

export const BUCKET = "analogy";
const KEEP_MODEL_VERSIONS = 3;
// 参照版の評価し直しに使うファイル
const MODEL_FILES = [
  "model_win.txt",
  "model_top2.txt",
  "model_top3.txt",
  "train_meta.json",
];
// 参照版に無くても止めないファイル（この版で足したモデル。train.py の OPTIONAL_REFERENCE と同じ）
const OPTIONAL_REFERENCE_FILES = ["model_win_racecard.txt"];
// レースごとの寄与度（B）のために置くファイル
const PER_RACE_FILES = [
  "model_win.json",
  "model_win_racecard.json",
  "per_race_meta.json",
  "parity_fixture.json",
];
const UPLOAD_FILES = [
  ...MODEL_FILES,
  ...OPTIONAL_REFERENCE_FILES,
  ...PER_RACE_FILES,
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT =
  process.env.ANALOGY_DATA_DIR ||
  path.join(__dirname, "../../../data/ml/analogy");
const OUT_DIR = path.join(OUT, "out");
const REFERENCE_FILE = path.join(__dirname, "reference.json");

/** 品質ゲートの比較の相手（reference.json）。未設定なら null（初回） */
async function referenceVersion() {
  try {
    return (
      JSON.parse(await fs.readFile(REFERENCE_FILE, "utf8")).model_version ||
      null
    );
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function ensureBucket() {
  const { data: buckets, error: listError } =
    await supabase.storage.listBuckets();
  if (listError)
    throw new Error(`バケット一覧の取得に失敗: ${listError.message}`);
  if ((buckets || []).some((b) => b.name === BUCKET)) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  });
  if (error && !/already exists/i.test(error.message))
    throw new Error(`バケット作成失敗: ${error.message}`);
  console.log(`📦 バケット '${BUCKET}' を作成`);
}

async function activeVersion() {
  const { data, error } = await supabase
    .from("analogy_models")
    .select("model_version")
    .eq("is_active", true);
  if (error)
    throw new Error(`analogy_models の読み取りに失敗: ${error.message}`);
  return data[0]?.model_version ?? null;
}

async function uploadModel() {
  const meta = JSON.parse(
    await fs.readFile(path.join(OUT_DIR, "train_meta.json"), "utf8"),
  );
  const version = meta.model_version;
  const active = await activeVersion();
  assertUploadable(version, active);
  await ensureBucket();
  for (const name of UPLOAD_FILES) {
    const buf = await fs.readFile(path.join(OUT_DIR, name));
    const key = `${version}/${name}.gz`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, zlib.gzipSync(buf), {
        upsert: true,
        contentType: "application/gzip",
      });
    if (error) throw new Error(`${key} の保存に失敗: ${error.message}`);
    console.log(`  ⬆️ ${key}`);
  }
  await pruneModels(active);
}

/** 新しい順に KEEP_MODEL_VERSIONS 個と、表示中の版を残して消す（storageRules.js） */
async function pruneModels(active) {
  const { data, error } = await supabase.storage.from(BUCKET).list("", {
    limit: 1000,
  });
  if (error) throw new Error(`Storage の一覧取得に失敗: ${error.message}`);
  const reference = await referenceVersion();
  const old = versionsToPrune(
    data.map((e) => e.name),
    active,
    KEEP_MODEL_VERSIONS,
    reference ? [reference] : [],
  );
  for (const v of old) {
    // 古い版にファイルが無くても remove は失敗しない（足す前の版を含めて消せる）
    const keys = UPLOAD_FILES.map((n) => `${v}/${n}.gz`);
    const { error: rmError } = await supabase.storage.from(BUCKET).remove(keys);
    if (rmError) throw new Error(`${v} の削除に失敗: ${rmError.message}`);
    console.log(`  🗑️ ${v}`);
  }
}

async function downloadReference() {
  const version = await referenceVersion();
  if (!version) {
    console.log("  参照版が未設定（初回）。参照版との比較は省く");
    return;
  }
  const dir = path.join(OUT_DIR, "reference");
  await fs.mkdir(dir, { recursive: true });
  for (const name of [...MODEL_FILES, ...OPTIONAL_REFERENCE_FILES]) {
    const key = `${version}/${name}.gz`;
    const { data: blob, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(key);
    // この版で足したモデルは、参照版に無くてよい（train.py がその比較だけを「比較なし」と記録する）
    if (dlError && OPTIONAL_REFERENCE_FILES.includes(name)) {
      console.log(`  参照版 ${version} に ${name} が無い。その比較は省く`);
      continue;
    }
    // それ以外の参照版のモデルが無いのは異常（品質ゲートの比較が黙って省かれる）なので失敗させる
    if (dlError)
      throw new Error(`${key} が Storage にありません: ${dlError.message}`);
    const buf = zlib.gunzipSync(Buffer.from(await blob.arrayBuffer()));
    await fs.writeFile(path.join(dir, name), buf);
    console.log(`  ⬇️ ${key}`);
  }
}

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabase 環境変数が未設定です");
  const cmd = process.argv[2];
  if (cmd === "upload-model") await uploadModel();
  else if (cmd === "download-reference") await downloadReference();
  else
    throw new Error(
      "使い方: node scripts/ml/analogy/storage.js <upload-model|download-reference>",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌", err.message || err);
    process.exit(1);
  });
}
