/**
 * BOA-271 アナロジー・ファインダーの Supabase Storage 連携（バケット `analogy`）
 *
 * - `{model_version}/model_{win,top2,top3,win_racecard,top2_racecard,top3_racecard}.txt.gz`・`train_meta.json.gz`:
 *   学習した主モデル。
 *   次の週の品質ゲートで、参照版を同じ test で評価し直すのに使う
 * - `{model_version}/model_{win,win_racecard}.json.gz`・`per_race_meta.json.gz`・`parity_fixture.json.gz`:
 *   レースごとの寄与度（B、ADR 案（#1134「レースごとの寄与度」））。推論側の JS が読む（plan「学習側の設計」）
 * - `source/...`: 長期データの月ごとのキャッシュ（export_pool.js）
 * モデルの版は直近3つと表示中の版だけ残す（plan「Storage の版は直近3つだけ残す」）。表示中の版と同じ名前では
 * アップロードしない（規則は storageRules.js）。
 * `scripts/ml/storage-models.js`（ポアロ）と同じ流儀。
 *
 * 使い方:
 *   node scripts/ml/analogy/storage.js upload-model     # out/ → {version}/
 *   node scripts/ml/analogy/storage.js download-reference  # 参照版（reference.json）→ out/reference/
 *   node scripts/ml/analogy/storage.js download-active-meta  # 表示中の版の per_race_meta.json → out/active/（日次の特徴量ジョブ）
 *   node scripts/ml/analogy/storage.js upload-profiles  # out/ の profiles.json・profiles_record.json → {version}/
 *   node scripts/ml/analogy/storage.js download-trained 2026-10-05  # 学習済みの版の train_meta・profiles → out/（書き込みだけやり直す）
 *   node scripts/ml/analogy/storage.js download-trained-models 2026-10-05  # train_meta・モデル（seed ごと）→ out/（profiles だけやり直す）
 *   node scripts/ml/analogy/storage.js download-active-model # 表示中の版の model_win.txt → out/active/（v16 の朝のバッチ）
 */

import fs from "fs/promises";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../../lib/supabaseClient.js";
import {
  assertUploadable,
  isNotFound,
  listingHas,
  versionsToPrune,
} from "./storageRules.js";

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
const OPTIONAL_REFERENCE_FILES = [
  "model_win_racecard.txt",
  "model_top2_racecard.txt",
  "model_top3_racecard.txt",
];
// レースごとの寄与度（B）のために置くファイル
const PER_RACE_FILES = [
  "model_win.json",
  "model_win_racecard.json",
  "per_race_meta.json",
  "parity_fixture.json",
  "perrace_record.json",
];
// DB に書く寄与度の行。書き込み（db.py write）が失敗したとき、学習をやり直さずに書き込みだけやり直すため
// （train-analogy.yml の write_only_version）に、書き込みの前に置く
const PROFILE_FILES = ["profiles.json", "profiles_record.json"];
// 学習の段（train.py --train-only）が置くファイル。seed を変えたモデルは train_meta.seed_model_files に並ぶ。
// profiles の計算だけやり直すとき（train-analogy.yml の profiles_only_version）に読む
const UPLOAD_FILES = [
  ...MODEL_FILES,
  ...OPTIONAL_REFERENCE_FILES,
  ...PER_RACE_FILES,
];
const MAIN_MODEL_FILES = [
  "model_win.txt",
  "model_top2.txt",
  "model_top3.txt",
  ...OPTIONAL_REFERENCE_FILES,
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

async function readMeta() {
  return JSON.parse(
    await fs.readFile(path.join(OUT_DIR, "train_meta.json"), "utf8"),
  );
}

async function uploadModel() {
  const meta = await readMeta();
  await uploadFiles(meta.model_version, [
    ...UPLOAD_FILES,
    ...(meta.seed_model_files ?? []),
  ]);
  await pruneModels(await activeVersion());
}

/** profiles の段（train.py --profiles-only）の出力。書き込み（db.py write）の前に置く */
async function uploadProfiles() {
  const meta = await readMeta();
  await uploadFiles(meta.model_version, PROFILE_FILES);
}

async function uploadFiles(version, names) {
  const active = await activeVersion();
  assertUploadable(version, active);
  await ensureBucket();
  for (const name of names) {
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
    // 版のフォルダのファイルを全部消す（seed のモデル等、版によって数が違うので一覧から）
    const { data: files, error: lsError } = await supabase.storage
      .from(BUCKET)
      .list(v, { limit: 1000 });
    if (lsError) throw new Error(`${v} の一覧の取得に失敗: ${lsError.message}`);
    const keys = files.map((f) => `${v}/${f.name}`);
    if (keys.length === 0) continue;
    const { error: rmError } = await supabase.storage.from(BUCKET).remove(keys);
    if (rmError) throw new Error(`${v} の削除に失敗: ${rmError.message}`);
    console.log(`  🗑️ ${v}`);
  }
}

/** 参照版のフォルダにファイルがあるか（一覧で確かめる。一覧の取得の失敗は失敗させる） */
async function referenceHasFile(version, fileName) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(version, { limit: 100, search: fileName });
  if (error)
    throw new Error(`${version}/ の一覧の取得に失敗: ${error.message}`);
  return listingHas(data, fileName);
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
    // 無いときだけ。通信・権限のエラーで飛ばすと、参照版との比較が黙って省かれる
    if (
      dlError &&
      OPTIONAL_REFERENCE_FILES.includes(name) &&
      (isNotFound(dlError) || !(await referenceHasFile(version, `${name}.gz`)))
    ) {
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

/**
 * 表示中の版（is_active）のファイルを out/active/ に置き、版の名前を out/active/version.txt に書く。
 * per_race_meta.json は日次の特徴量ジョブ（特徴量の並び・支部の対応表・版）、model_win.txt は v16 の朝のバッチ
 * （類似レースの距離の重み）が使う
 */
async function downloadActive(names) {
  const version = await activeVersion();
  if (!version)
    throw new Error("表示中の版（analogy_models.is_active）がありません");
  const dir = path.join(OUT_DIR, "active");
  await downloadVersion(version, names, dir);
  await fs.writeFile(path.join(dir, "version.txt"), version);
}

/** 学習済みの版の train_meta.json・profiles.json を out/ に置く（書き込みだけやり直す。train-analogy.yml の write_only_version） */
async function downloadTrained(version) {
  if (!version) throw new Error("版の名前を指定する（例: 2026-10-05）");
  await downloadVersion(version, ["train_meta.json", ...PROFILE_FILES], OUT_DIR);
}

/** 学習済みの版の train_meta.json とモデル（seed ごと）を out/ に置く（profiles の計算だけやり直す。profiles_only_version） */
async function downloadTrainedModels(version) {
  if (!version) throw new Error("版の名前を指定する（例: 2026-10-05）");
  await downloadVersion(version, ["train_meta.json"], OUT_DIR);
  const meta = await readMeta();
  if (!Array.isArray(meta.seed_model_files))
    throw new Error(
      `版 ${version} の train_meta に seed_model_files が無い（seed のモデルを置く前の版。profiles だけのやり直しはできない）`,
    );
  await downloadVersion(
    version,
    [...MAIN_MODEL_FILES, ...meta.seed_model_files],
    OUT_DIR,
  );
}

async function downloadVersion(version, names, dir) {
  await fs.mkdir(dir, { recursive: true });
  for (const name of names) {
    const key = `${version}/${name}.gz`;
    const { data: blob, error } = await supabase.storage
      .from(BUCKET)
      .download(key);
    if (error)
      throw new Error(
        `${key} を取れません（その版の学習の前か、Storage の不具合）: ${error.message}`,
      );
    await fs.writeFile(
      path.join(dir, name),
      zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())),
    );
    console.log(`  ⬇️ ${key}`);
  }
}

async function main() {
  if (!isSupabaseEnabled()) throw new Error("Supabase 環境変数が未設定です");
  const cmd = process.argv[2];
  if (cmd === "upload-model") await uploadModel();
  else if (cmd === "download-reference") await downloadReference();
  else if (cmd === "download-active-meta")
    await downloadActive(["per_race_meta.json"]);
  else if (cmd === "download-active-model")
    await downloadActive(["model_win.txt"]);
  else if (cmd === "download-trained") await downloadTrained(process.argv[3]);
  else if (cmd === "download-trained-models")
    await downloadTrainedModels(process.argv[3]);
  else if (cmd === "upload-profiles") await uploadProfiles();
  else
    throw new Error(
      "使い方: node scripts/ml/analogy/storage.js <upload-model|upload-profiles|download-reference|download-active-meta|download-active-model|download-trained <版>|download-trained-models <版>>",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌", err.message || err);
    process.exit(1);
  });
}
