/**
 * SNSシェア関数
 */

import { MODEL_NAMES } from "../constants";

/**
 * AI予想をXでシェア
 * @param {Object} race - レースデータ
 * @param {string} model - 使用したモデル (standard/safeBet/upsetFocus)
 */
export const shareRacePredictionToX = (race, model = "standard") => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";
  const topPick = race.prediction?.topPick || "?";
  const top3 = race.prediction?.top3?.join("-") || "?-?-?";

  const modelName = MODEL_NAMES[model] || "スタンダード";

  // 日付をフォーマット (YYYY-MM-DD -> MM/DD)
  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  // 5種類のメッセージバリエーション
  const messages = [
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
本命: ${topPick}号艇
推奨: ${top3}

展開予測から分析した結果、この並びが来そう！
データ的にも期待できるかも👀

#ボートレース #AI予想 #龍神レーダー`,

    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
本命: ${topPick}号艇
推奨: ${top3}

1マーク展開予測とモーター性能を分析した結果、
この組み合わせに注目してます📊

#ボートレース #AI予想 #龍神レーダー`,

    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
本命: ${topPick}号艇
推奨: ${top3}

無料でここまで精度の高い予想が見られるのは嬉しい✨
今日も当たりますように！

#ボートレース #AI予想 #龍神レーダー`,

    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
本命: ${topPick}号艇
推奨: ${top3}

展開予測から見て、この予想は信頼できそう！
皆さんはどう思いますか？🤔

#ボートレース #AI予想 #龍神レーダー`,

    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
本命: ${topPick}号艇
推奨: ${top3}

最近的中率が上がってきてて嬉しい😊
AIの予想、参考にしてみてください！

#ボートレース #AI予想 #龍神レーダー`,
  ];

  // ランダムにメッセージを選択
  const randomIndex = Math.floor(Math.random() * messages.length);
  const text = messages[randomIndex];

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.boat-ai.jp/")}`;
  window.open(tweetUrl, "_blank", "width=600,height=400");
};

/**
 * 的中結果をXでシェア
 * @param {Object} race - レースデータ（結果含む）
 * @param {string} model - 使用したモデル (standard/safeBet/upsetFocus)
 */
export const shareHitRaceToX = (race, model = "standard") => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";
  const prediction = race.prediction?.top3?.join("-") || "?-?-?";
  const result = race.result?.join("-") || "?-?-?";
  const payout = race.totalPayout || 0;
  const hitTypes = race.hitTypes || [];

  const modelName = MODEL_NAMES[model] || "スタンダード";

  // 的中券種を文字列化
  let hitTypesStr = "";
  if (hitTypes.length > 0) {
    const hitTypeNames = hitTypes.map((h) => h.type);
    hitTypesStr = hitTypeNames.join("・");
  }

  // 日付をフォーマット (YYYY-MM-DD -> MM/DD)
  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  // 5種類のメッセージバリエーション
  const messages = [
    `🎯 的中！【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
予想: ${prediction}
結果: ${result}
的中: ${hitTypesStr} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉
AIの精度に驚いてます！

#ボートレース #的中 #龍神レーダー`,

    `🎯 的中！【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
予想: ${prediction}
結果: ${result}
的中: ${hitTypesStr} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉
無料でこの精度はすごい！

#ボートレース #的中 #龍神レーダー`,

    `🎯 的中！【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
予想: ${prediction}
結果: ${result}
的中: ${hitTypesStr} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉
データ分析の力を実感！

#ボートレース #的中 #龍神レーダー`,

    `🎯 的中！【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
予想: ${prediction}
結果: ${result}
的中: ${hitTypesStr} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉
今日もAI予想が当たった！

#ボートレース #的中 #龍神レーダー`,

    `🎯 的中！【${dateStr}${venue}${raceNo}R】

モデル: ${modelName}
予想: ${prediction}
結果: ${result}
的中: ${hitTypesStr} ✅
配当: ${payout.toLocaleString()}円

龍神レーダーで予想的中🎉
的中率の高さに満足してます！

#ボートレース #的中 #龍神レーダー`,
  ];

  // ランダムにメッセージを選択
  const randomIndex = Math.floor(Math.random() * messages.length);
  const text = messages[randomIndex];

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.boat-ai.jp/")}`;
  window.open(tweetUrl, "_blank", "width=600,height=400");
};

/**
 * 統計データをXでシェア
 * @param {Object} stats - 統計データ
 */
export const shareDailyStatsToX = (stats) => {
  const date = stats.date || new Date().toISOString().split("T")[0];
  const tanWins = stats.tanWins || 0;
  const fukuWins = stats.fukuWins || 0;
  const total = stats.total || 1;
  const tanRate = ((tanWins / total) * 100).toFixed(1);
  const fukuRate = ((fukuWins / total) * 100).toFixed(1);

  const text = `📊 本日の実績【${date}】

✅ 単勝: ${tanWins}/${total}（${tanRate}%）
✅ 複勝: ${fukuWins}/${total}（${fukuRate}%）

龍神レーダーのAI予想で的中率UP📈

#ボートレース #AI予想`;

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://www.boat-ai.jp/")}`;
  window.open(tweetUrl, "_blank", "width=600,height=400");
};

/**
 * AI予想のシェアテキストを生成（react-share用）
 */
export const generatePredictionShareText = (race, model = "standard") => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";
  const topPick = race.prediction?.topPick || "?";
  const top3 = race.prediction?.top3?.join("-") || "?-?-?";

  const modelName = MODEL_NAMES[model] || "スタンダード";

  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  const messages = [
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】\n\nモデル: ${modelName}\n本命: ${topPick}号艇\n推奨: ${top3}\n\n展開予測から分析した結果、この並びが来そう！\nデータ的にも期待できるかも👀`,
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】\n\nモデル: ${modelName}\n本命: ${topPick}号艇\n推奨: ${top3}\n\n1マーク展開予測とモーター性能を分析した結果、\nこの組み合わせに注目してます📊`,
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】\n\nモデル: ${modelName}\n本命: ${topPick}号艇\n推奨: ${top3}\n\n無料でここまで精度の高い予想が見られるのは嬉しい✨\n今日も当たりますように！`,
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】\n\nモデル: ${modelName}\n本命: ${topPick}号艇\n推奨: ${top3}\n\n展開予測から見て、この予想は信頼できそう！\n皆さんはどう思いますか？🤔`,
    `🏁 龍神レーダー予想【${dateStr}${venue}${raceNo}R】\n\nモデル: ${modelName}\n本命: ${topPick}号艇\n推奨: ${top3}\n\n最近的中率が上がってきてて嬉しい😊\nAIの予想、参考にしてみてください！`,
  ];

  return messages[Math.floor(Math.random() * messages.length)];
};

/**
 * 展開予測的中結果のシェアテキストを生成（react-share用、BOA-174）
 * unifiedモデルは複勝予想・展開予測の2種類のみのため、レース単位の的中は
 * 展開予測的中（1マークでの予想パターンが実際の1着コースと一致）のみを扱う
 * @param {Object} race - { venue, raceNo, date, winnerCourse, probability }
 */
export const generateTurnHitShareText = (race) => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";
  const winnerCourse = race.winnerCourse;
  const probabilityStr =
    race.probability != null
      ? `（予想確率${(race.probability * 100).toFixed(0)}%）`
      : "";

  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  const messages = [
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n1マークで${winnerCourse}コースが先頭に${probabilityStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\nAIの分析力に驚いてます！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n1マークで${winnerCourse}コースが先頭に${probabilityStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n無料でこの精度はすごい！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n1マークで${winnerCourse}コースが先頭に${probabilityStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\nデータ分析の力を実感！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n1マークで${winnerCourse}コースが先頭に${probabilityStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n今日もAI予想が当たった！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n1マークで${winnerCourse}コースが先頭に${probabilityStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n的中率の高さに満足してます！`,
  ];

  return messages[Math.floor(Math.random() * messages.length)];
};
