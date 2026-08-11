/**
 * マイクロフト予想 日次バッチ
 *
 * 学習済み Transformer（mycroft_v1.pt）で当日レースを予測し、
 * mycroft_predictions テーブルに upsert する。/holmes マイクロフトタブが読み取る。
 *
 * 前提:
 *   - PyTorch が入った Python（ローカルは scripts/ml/.venv-torch、CI は setup-python）
 *   - scripts/ml/models/mycroft_v1.pt が学習済み（train_mycroft.py）
 *   - data/ml/dataset.csv 等の履歴（export-training-data.js）
 *
 * 使い方:
 *   node scripts/daily/generate-mycroft-predictions.js                # 今日（JST）
 *   node scripts/daily/generate-mycroft-predictions.js --date=YYYY-MM-DD
 *   node scripts/daily/generate-mycroft-predictions.js --skip-export
 *     （ポアロ/ワトソン直後に実行する場合。inference.csv を再利用）
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

// PyTorch はローカルの .venv（Python 3.14）に入らないため専用 venv を優先する。
// CI は setup-python の 3.12 に requirements.txt を入れるので python3 で足りる。
function resolvePython() {
  if (process.env.MYCROFT_PYTHON) return process.env.MYCROFT_PYTHON;
  const candidates = [
    path.join(ROOT, "scripts/ml/.venv-torch/bin/python"),
    path.join(ROOT, "scripts/ml/.venv/bin/python"),
  ];
  return candidates.find((p) => existsSync(p)) || "python3";
}

async function main() {
  if (!supabase) {
    console.error("❌ Supabase 環境変数が未設定です");
    process.exit(1);
  }
  const date = parseDateArg() || getTodayDateJST();
  const skipExport = process.argv.includes("--skip-export");
  console.log(`🏛️ マイクロフト予想生成: ${date}`);

  // モデル未学習（Storage未配置）の間は日次ジョブを失敗させずスキップする
  const modelPath = path.join(ROOT, "scripts/ml/models/mycroft_v1.pt");
  if (!existsSync(modelPath)) {
    console.log("⏭️ mycroft_v1.pt がありません（未学習）→ スキップ");
    return;
  }

  // 1. 当日レースの特徴量ソースを輸出（ポアロ/ワトソン直後なら再利用）
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
    resolvePython(),
    [path.join(ROOT, "scripts/ml/predict_mycroft.py")],
    { cwd: path.join(ROOT, "scripts/ml"), maxBuffer: 64 * 1024 * 1024 },
  );
  process.stdout.write(pred.stdout);

  // 3. 結果を upsert
  const json = await fs.readFile(
    path.join(ROOT, "data/ml/mycroft-predictions.json"),
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
    .from("mycroft_predictions")
    .upsert(rows, { onConflict: "race_id" });
  if (error) {
    console.error("❌ mycroft_predictions 書き込みエラー:", error.message);
    process.exit(1);
  }
  console.log(`✅ mycroft_predictions: ${rows.length}件 upsert 完了`);
}

main().catch((err) => {
  console.error("❌ エラー:", err.stderr || err.message || err);
  process.exit(1);
});
