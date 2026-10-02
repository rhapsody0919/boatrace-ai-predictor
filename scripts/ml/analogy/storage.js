/**
 * BOA-271 アナロジー・ファインダーの Supabase Storage 連携（バケット `analogy`）
 *
 * - `{model_version}/model_{win,top2,top3}.txt.gz`・`train_meta.json.gz`: 学習した主モデル。
 *   次の週の品質ゲートで、今の is_active の版を同じ test で評価し直すのに使う
 * - `source/...`: 長期データの月ごとのキャッシュ（export_pool.js）
 * モデルの版は直近3つだけ残す（plan「Storage の版は直近3つだけ残す」）。
 * `scripts/ml/storage-models.js`（ポアロ）と同じ流儀。
 *
 * 使い方:
 *   node scripts/ml/analogy/storage.js upload-model     # out/ → {version}/
 *   node scripts/ml/analogy/storage.js download-active  # is_active の版 → out/prev/（無ければ何もしない）
 */

import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../../lib/supabaseClient.js";

export const BUCKET = "analogy";
const KEEP_MODEL_VERSIONS = 3;
const MODEL_FILES = [
  "model_win.txt",
  "model_top2.txt",
  "model_top3.txt",
  "train_meta.json",
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT =
  process.env.ANALOGY_DATA_DIR ||
  path.join(__dirname, "../../../data/ml/analogy");
const OUT_DIR = path.join(OUT, "out");

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

async function uploadModel() {
  const meta = JSON.parse(
    await fs.readFile(path.join(OUT_DIR, "train_meta.json"), "utf8"),
  );
  const version = meta.model_version;
  await ensureBucket();
  for (const name of MODEL_FILES) {
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
  await pruneModels();
}

/** 版のフォルダ（YYYY-MM-DD…）を新しい順に並べ、KEEP_MODEL_VERSIONS より古いものを消す */
async function pruneModels() {
  const { data, error } = await supabase.storage.from(BUCKET).list("", {
    limit: 1000,
  });
  if (error) throw new Error(`Storage の一覧取得に失敗: ${error.message}`);
  const versions = data
    .map((e) => e.name)
    .filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n))
    .sort()
    .reverse();
  for (const v of versions.slice(KEEP_MODEL_VERSIONS)) {
    const keys = MODEL_FILES.map((n) => `${v}/${n}.gz`);
    const { error: rmError } = await supabase.storage.from(BUCKET).remove(keys);
    if (rmError) throw new Error(`${v} の削除に失敗: ${rmError.message}`);
    console.log(`  🗑️ ${v}`);
  }
}

async function downloadActive() {
  const { data, error } = await supabase
    .from("analogy_models")
    .select("model_version")
    .eq("is_active", true);
  if (error)
    throw new Error(`analogy_models の読み取りに失敗: ${error.message}`);
  if (!data.length) {
    console.log("  is_active の版が無い（初回）。前の版との比較は省く");
    return;
  }
  const version = data[0].model_version;
  const dir = path.join(OUT_DIR, "prev");
  await fs.mkdir(dir, { recursive: true });
  for (const name of ["model_win.txt", "train_meta.json"]) {
    const key = `${version}/${name}.gz`;
    const { data: blob, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(key);
    // 表示中の版のモデルが無いのは異常（品質ゲートの比較が黙って省かれる）なので失敗させる
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
  else if (cmd === "download-active") await downloadActive();
  else
    throw new Error(
      "使い方: node scripts/ml/analogy/storage.js <upload-model|download-active>",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌", err.message || err);
    process.exit(1);
  });
}
