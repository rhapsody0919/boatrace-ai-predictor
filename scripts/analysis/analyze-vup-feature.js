import { scrapeVupFeatures } from "./scrape-kyotei-vup.js";

// kyoteibiyori.com/vup/ から指定機能の生データを取得する。
// 評価・実装案・Linearチケット文面はここではなく、Claude自身が
// (.claude/commands/analyze-vup-feature.md の指示に従い) 現在のboatAIコードベースを
// 見た上で作成する。キーワードマッチによる機械的スコアリングは実際の適合度を
// 反映しないため廃止した。
async function findVupFeature(featureName) {
  const features = await scrapeVupFeatures();
  const target = features.find((f) => f.title.includes(featureName));

  if (!target) {
    return {
      error: `機能「${featureName}」が見つかりませんでした。`,
      suggestion:
        "正確な機能名を指定してください。/analyze-vup-features で全機能リストを確認できます。",
    };
  }

  return target;
}

const featureName = process.argv[2];
if (!featureName) {
  console.error('使用方法: node analyze-vup-feature.js "機能名"');
  process.exit(1);
}

const result = await findVupFeature(featureName);
console.log(JSON.stringify(result, null, 2));
