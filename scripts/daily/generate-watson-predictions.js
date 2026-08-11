/**
 * ワトソン予想 日次バッチ
 *
 * 学習済み LambdaRank モデル（watson_v1.pkl）で当日レースを予測し、
 * watson_predictions テーブルに upsert する。/holmes ワトソンタブが読み取る。
 *
 * 前提:
 *   - scripts/ml/.venv がセットアップ済み（requirements.txt）
 *   - scripts/ml/models/watson_v1.pkl が学習済み（train_watson.py）
 *   - data/ml/dataset.csv 等の履歴（export-training-data.js）
 *
 * 使い方:
 *   node scripts/daily/generate-watson-predictions.js                # 今日（JST）
 *   node scripts/daily/generate-watson-predictions.js --date=YYYY-MM-DD
 *   node scripts/daily/generate-watson-predictions.js --skip-export
 *     （generate-poirot-predictions.js 直後に実行する場合。inference.csv を再利用）
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { supabase } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const VENV_PYTHON = path.join(ROOT, "scripts/ml/.venv/bin/python");
const PYTHON =
  process.env.POIROT_PYTHON ||
  (existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3");

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です");
    process.exit(1);
  }
  const date = parseDateArg() || getTodayDateJST();
  const skipExport = process.argv.includes("--skip-export");
  console.log(`🩺 ワトソン予想生成: ${date}`);

  // モデル未学習（Storage未配置）の間は日次ジョブを失敗させずスキップする
  const modelPath = path.join(ROOT, "scripts/ml/models/watson_v1.pkl");
  if (!existsSync(modelPath)) {
    console.log("⏭️ watson_v1.pkl がありません（未学習）→ スキップ");
    return;
  }

  // 1. 当日レースの特徴量ソースを輸出（ポアロ直後なら再利用）
  if (skipExport) {
    console.log("⏭️ inference.csv の輸出をスキップ（既存を再利用）");
  } else {
    const exp = await execFileAsync(
      "node",
      [
        path.join(ROOT, "scripts/ml/export-inference-data.js"),
        `--date=${date}`,
      ],
      { cwd: ROOT },
    );
    process.stdout.write(exp.stdout);
  }

  // 2. Python 推論
  const pred = await execFileAsync(
    PYTHON,
    [path.join(ROOT, "scripts/ml/predict_watson.py")],
    {
      cwd: path.join(ROOT, "scripts/ml"),
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  process.stdout.write(pred.stdout);

  // 3. 結果を upsert
  const json = await fs.readFile(
    path.join(ROOT, "data/ml/watson-predictions.json"),
    "utf-8",
  );
  const rows = JSON.parse(json).map((r) => ({
    ...r,
    predicted_at: new Date().toISOString(),
  }));
  if (rows.length === 0) {
    console.log("📭 書き込みデータなし");
    return;
  }

  const { error } = await supabase
    .from("watson_predictions")
    .upsert(rows, { onConflict: "race_id" });
  if (error) {
    console.error("❌ watson_predictions 書き込みエラー:", error.message);
    process.exit(1);
  }
  console.log(`✅ watson_predictions: ${rows.length}件 upsert 完了`);
}

main().catch((err) => {
  console.error("❌ エラー:", err.stderr || err.message || err);
  process.exit(1);
});
