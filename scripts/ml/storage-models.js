/**
 * ポアロ予想モデルの Supabase Storage 連携（BOA-104）
 *
 * 学習済みモデル（scripts/ml/models/*.pkl）を Supabase Storage の
 * `poirot` バケットに置き、CI の学習ジョブ（週次）と推論ジョブ（日次）で
 * 受け渡す。モデルはバイナリで大きく頻繁に更新されるため、git ではなく
 * Storage で管理する（デプロイ肥大・履歴汚染の回避）。
 *
 * 使い方:
 *   node scripts/ml/storage-models.js upload     # models/*.pkl → Storage
 *   node scripts/ml/storage-models.js download   # Storage → models/*.pkl
 */

import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, "models");

const BUCKET = "poirot";
const MODEL_FILES = ["rf_v1.pkl", "lgbm_v2.pkl", "watson_v1.pkl"];
const PREFIX = "models";

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if ((buckets || []).some((b) => b.name === BUCKET)) return;
  // fileSizeLimit は指定しない（プロジェクトのグローバル上限を継承）。
  // gzip 後のモデルはこの上限（通常50MB）に収まるサイズに調整してある。
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: false,
  });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`バケット作成失敗: ${error.message}`);
  }
  console.log(`📦 バケット '${BUCKET}' を作成`);
}

async function upload() {
  await ensureBucket();
  for (const name of MODEL_FILES) {
    const local = path.join(MODELS_DIR, name);
    let buf;
    try {
      buf = await fs.readFile(local);
    } catch {
      console.warn(`  ⚠️ ${name} がローカルに無いためスキップ`);
      continue;
    }
    const gz = await gzip(buf);
    const key = `${PREFIX}/${name}.gz`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, gz, { upsert: true, contentType: "application/gzip" });
    if (error) throw new Error(`${key} upload失敗: ${error.message}`);
    console.log(
      `  ⬆️ ${key} (${(buf.length / 1e6).toFixed(1)}MB → gz ${(gz.length / 1e6).toFixed(1)}MB)`,
    );
  }
  console.log("✅ モデルアップロード完了");
}

async function download() {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  for (const name of MODEL_FILES) {
    const key = `${PREFIX}/${name}.gz`;
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (error) throw new Error(`${key} download失敗: ${error.message}`);
    const buf = await gunzip(Buffer.from(await data.arrayBuffer()));
    await fs.writeFile(path.join(MODELS_DIR, name), buf);
    console.log(`  ⬇️ ${key} → ${name} (${(buf.length / 1e6).toFixed(1)}MB)`);
  }
  console.log("✅ モデルダウンロード完了");
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase 環境変数が未設定です");
    process.exit(1);
  }
  const cmd = process.argv[2];
  if (cmd === "upload") await upload();
  else if (cmd === "download") await download();
  else {
    console.error(
      "使い方: node scripts/ml/storage-models.js <upload|download>",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ エラー:", err.message || err);
  process.exit(1);
});
