/**
 * 朝の初期化スクリプト
 *
 * races テーブルに当日データがなければ scrape-to-json.js + generate-predictions.js を実行する。
 * 初期化済みの場合は何もしない（冪等）。
 *
 * scrape-scheduled.yml から5分毎に呼ばれるが、実際の処理は1日1回のみ。
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..");

// unifiedモデル（AI予想モデル大規模改修）の朝バッチが当日分未実行なら実行する。
// 冪等（当日分のpredictionsが既にあれば何もしない）なので、5分毎に呼ばれても安全
async function ensureUnifiedPredictions(date) {
  const { count, error } = await supabase
    .from("predictions")
    .select("*", { count: "exact", head: true })
    .eq("model_id", "unified")
    .gte("race_id", date)
    .lt("race_id", `${date}~`);

  if (error) {
    console.warn("⚠️ unified predictions確認エラー:", error.message);
    return;
  }
  if ((count || 0) > 0) {
    return;
  }

  console.log("\n🤖 unifiedモデルの日次予測を生成中...");
  try {
    execSync(
      `node ${path.join(ROOT, "scripts", "daily", "generate-unified-predictions.js")} --date=${date}`,
      { stdio: "inherit", env: { ...process.env } },
    );
  } catch (e) {
    console.warn(
      "⚠️ unified predictions生成で一部エラー（処理は継続）:",
      e.message,
    );
  }
}

async function main() {
  console.log("🌅 朝の初期化チェック");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  // 当日の races テーブルを確認
  const { count, error } = await supabase
    .from("races")
    .select("*", { count: "exact", head: true })
    .gte("race_id", date)
    .lt("race_id", `${date}~`);

  if (error) {
    console.error("❌ races テーブル確認エラー:", error.message);
    process.exit(1);
  }

  if ((count || 0) > 0) {
    // generate-predictions.js がDB更新後にコード変更されていた場合のみ予測を再生成する
    let shouldRegen = false;
    try {
      const gitTs = execSync(
        "git log -1 --format=%ct scripts/daily/generate-predictions.js",
        { encoding: "utf8", cwd: ROOT },
      ).trim();
      if (gitTs) {
        const scriptModifiedAt = new Date(parseInt(gitTs, 10) * 1000);

        const { data: latestRace } = await supabase
          .from("races")
          .select("updated_at")
          .gte("race_id", date)
          .lt("race_id", `${date}~`)
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        if (latestRace && scriptModifiedAt > new Date(latestRace.updated_at)) {
          shouldRegen = true;
          console.log(
            `🔄 予測スクリプトがDB更新後に変更されています（${scriptModifiedAt.toISOString()} > ${latestRace.updated_at}）`,
          );
        }
      }
    } catch {
      // git 未使用環境またはクエリ失敗の場合はスキップ
    }

    if (shouldRegen) {
      console.log("🤖 予測のみ再生成します...");
      // main() は races.json（git stale）を読むため使わない。
      // mainRefresh() は race_entries（DB）から読むため stale データを混入しない。
      const genPath = path.join(
        ROOT,
        "scripts",
        "daily",
        "generate-predictions.js",
      );
      const { mainRefresh } = await import(genPath);

      // 当日の全 race_entries から race_id を収集
      const { data: entries } = await supabase
        .from("race_entries")
        .select("race_id")
        .gte("race_id", date)
        .lt("race_id", `${date}~`);
      const allTodayRaceIds = [
        ...new Set((entries || []).map((e) => e.race_id)),
      ];

      if (allTodayRaceIds.length > 0) {
        await mainRefresh({
          isDryRun: false,
          specificRaceIds: allTodayRaceIds,
        });
      } else {
        console.log("⚠️ race_entries にデータなし — スキップ");
      }
      console.log("✅ 予測再生成完了");
    } else {
      console.log(`✅ 初期化済み（${count}レース）。スキップ。`);
    }
    await ensureUnifiedPredictions(date);
    return;
  }

  console.log("📋 未初期化のため朝の初期化を開始します...");

  // Step 1: scrape-to-json.js でレースデータを取得し races.json を生成
  console.log("\n📡 Step 1: scrape-to-json.js 実行中...");
  execSync(`node ${path.join(ROOT, "scripts", "scrape-to-json.js")}`, {
    stdio: "inherit",
    env: { ...process.env },
  });

  // Step 2: generate-predictions.js（フルモード）で初期予測を生成
  console.log("\n🤖 Step 2: generate-predictions.js 実行中...");
  execSync(
    `node ${path.join(ROOT, "scripts", "daily", "generate-predictions.js")}`,
    {
      stdio: "inherit",
      env: { ...process.env },
    },
  );

  // Step 2.5: unifiedモデルの日次予測を生成（複勝予想・展開予測・イン崩れバッジ）
  await ensureUnifiedPredictions(date);

  // Step 3: pcexpect 公式コンピュータ予想を全レース分取得
  // 失敗しても以降の処理（Deploy Hook）には影響させない
  console.log("\n🔮 Step 3: scrape-pcexpect.js 実行中...");
  try {
    execSync(
      `node ${path.join(ROOT, "scripts", "daily", "scrape-pcexpect.js")} --date ${date}`,
      {
        stdio: "inherit",
        env: { ...process.env },
      },
    );
  } catch (e) {
    console.warn(
      "⚠️ pcexpect スクレイプで一部エラー（処理は継続）:",
      e.message,
    );
  }

  console.log("\n✅ 朝の初期化完了");

  // Vercel Deploy Hook をトリガー（フロントエンドの CDN キャッシュをリセット）
  const deployHook = process.env.VERCEL_DEPLOY_HOOK;
  if (deployHook) {
    try {
      await fetch(deployHook, { method: "POST" });
      console.log("🚀 Vercel Deploy Hook トリガー済み");
    } catch (e) {
      console.warn("⚠️ Vercel Deploy Hook 失敗:", e.message);
    }
  }
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
