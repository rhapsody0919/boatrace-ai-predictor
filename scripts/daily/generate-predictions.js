// AI予想生成スクリプト
// data/races.json を読み込んで、data/predictions/YYYY-MM-DD.json を生成
// Supabaseにも同時書き込み（デュアルライト）

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getTodayDateJST } from "../lib/dateUtils.js";
import { RACE_ID_CHUNK_SIZE } from "../lib/predictionRaceFetch.js";
import { mainRefresh, generateAndWriteFromRacesData } from "../lib/predictionRun.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// export の名は元のまま（RACE_ID_CHUNK_SIZE は predictionRaceFetch.js、processRacersWithScoreFn は predictionScoring.js が持つ）
export { RACE_ID_CHUNK_SIZE };
export { processRacersWithScoreFn } from "../lib/predictionScoring.js";

// メイン処理
async function main() {
  try {
    console.log("🚀 AI予想生成を開始します...");

    // data/races.json を読み込み
    const racesPath = path.join(__dirname, "..", "..", "data", "races.json");
    console.log(`📖 レースデータを読み込み中: ${racesPath}`);

    const racesData = JSON.parse(await fs.readFile(racesPath, "utf-8"));

    if (!racesData.success || !racesData.data) {
      throw new Error("races.json に有効なデータがありません");
    }

    // 今日の日付を取得
    const today = getTodayDateJST();

    // races.json の日付が今日と一致するか確認（古いファイルで誤挿入を防ぐ）
    if (racesData.date && racesData.date !== today) {
      throw new Error(
        `races.json の日付 (${racesData.date}) が今日 (${today}) と一致しません。scrape-to-json.js を先に実行してください。`,
      );
    }

    // CLI は morning-init.js の手順2から try なしの execSync で呼ばれる。書き込みの一部が失敗しただけで
    // 例外にすると、morning-init の後続（unified の生成・pcexpect・Deploy Hook）まで止まり、その日は
    // 作り直されない。CLI だけは従来どおりログに出して続行する（Vercel の races-init は true。BOA-391）
    await generateAndWriteFromRacesData({
      racesData,
      date: today,
      // 握りつぶし可（BOA-391）: CLI だけ。morning-init の後続（unified・pcexpect・Deploy Hook）を止めない（上のコメント）
      throwOnError: false,
    });

    console.log("✨ 予想生成が完了しました！");
  } catch (error) {
    console.error("❌ エラーが発生しました:", error);
    process.exit(1);
  }
}

// スタンドアローン実行時のみ実行する（import 時に実行させない）
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const isRefresh = args.includes("--refresh");
  const isDryRun = args.includes("--dry-run");
  const raceIdsArg = args.find((a) => a.startsWith("--race-ids="));
  const specificRaceIds = raceIdsArg
    ? raceIdsArg.split("=")[1].split(",")
    : null;

  if (isRefresh) {
    mainRefresh({ isDryRun, specificRaceIds }).catch((error) => {
      console.error("❌ エラー:", error);
      process.exit(1);
    });
  } else {
    main();
  }
}

export { mainRefresh, generateAndWriteFromRacesData } from "../lib/predictionRun.js";
