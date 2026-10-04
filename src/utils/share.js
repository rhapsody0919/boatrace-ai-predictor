/**
 * SNSシェア関数
 */

import { MODEL_NAMES } from "../constants";

/** panel.sharePrediction の文面の数（v1〜vN） */
const SHARE_PREDICTION_VARIANTS = 5;

// シェアで送る URL の基点。プレビュー環境・開発機から共有しても本番のページを指すようにする
const SITE_ORIGIN = "https://www.boat-ai.jp";

/**
 * シェアボタンで送る URL（BOA-691）。以前はどのページからでもトップ固定で、レース詳細から
 * 共有しても受け取った人はそのレースに戻れなかった
 * @param {string} pathWithSearch - 例 "/en/race/2026-10-02-02-09?tab=meet&boat=3"
 */
export const shareUrlFor = (pathWithSearch) =>
  `${SITE_ORIGIN}${pathWithSearch}`;

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
 *
 * 中止のレース（race.isCancelled。判定は呼び出し側で isRaceCancelled）と、
 * 予想データの無いレース（本命が無い）では、予想の文面を使わず t() の文面を返す。
 * 予想の文面のままだと、中止でも「本命: X号艇」、予想なしで「本命: ?号艇」になっていた。
 *
 * @param {{venue?: string, raceNo?: number|string, date?: string, isCancelled?: boolean,
 *   prediction?: {topPick?: number|null, top3?: number[]}}} race
 * @param {string} model
 * @param {(key: string, options?: object) => string} t - i18next の t
 */
export const generatePredictionShareText = (race, model = "standard", t) => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";

  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  // 見出し（日付・会場・R）は予想の文面と同じ形で残す
  const label = { date: dateStr, venue, raceNo };
  if (race.isCancelled) return t("panel.shareCancelled", label);
  if (race.prediction?.topPick == null) {
    return t("panel.shareNoPrediction", label);
  }

  const topPick = race.prediction.topPick;
  const top3 = race.prediction.top3?.join("-") || "?-?-?";

  // モデル名・文面とも表示中の言語で出す（以前は日本語固定で en/zh-TW/ko でも日本語になっていた）
  const modelName =
    model === "unified"
      ? t("raceTabs.aiPrediction")
      : t(`models.${model}`, { defaultValue: MODEL_NAMES[model] });

  // 5種類の文面から1つを選ぶ（panel.sharePrediction.v1〜v5）
  const variant = Math.floor(Math.random() * SHARE_PREDICTION_VARIANTS) + 1;
  return t(`panel.sharePrediction.v${variant}`, {
    ...label,
    model: modelName,
    topPick,
    top3,
  });
};

/**
 * 展開予測的中結果のシェアテキストを生成（react-share用、BOA-174）
 * unifiedモデルは複勝予想・展開予測の2種類のみのため、レース単位の的中は
 * 展開予測的中（予想パターンの艇が実際に1着）のみを扱う。展開予測は「その艇がその決まり手で
 * 1着になる確率」なので、「1マークで先頭」とは書かない（BOA-710）
 * @param {Object} race - { venue, raceNo, date, winnerBoat, winnerEntryCourse, technique, probability }
 *   technique は日本語の決まり手名。予想確率はその決まり手で1着になる確率なので、あれば添える
 */
export const generateTurnHitShareText = (race) => {
  const venue = race.venue || "不明";
  const raceNo = race.raceNo || "?";
  // 1着の艇番と、その艇が実際に入ったコース（BOA-708。以前は艇番を「Nコース」と書いていた）。
  // コースは艇番と違うときだけ書く。括弧を重ねないよう「Nコースから」を文に入れる
  const winnerBoat = race.winnerBoat;
  const fromCourse =
    race.winnerEntryCourse != null && race.winnerEntryCourse !== winnerBoat
      ? `${race.winnerEntryCourse}コースから`
      : "";
  // 決まり手は AI の予想として書く。実際の決まり手と違うことがあり、「2コース（まくり）が1着」と
  // 書くと結果を言い切ってしまう（的中の判定は1着の艇だけ。PR #1197 ファン評価3周目）
  const predictionStr =
    race.probability != null
      ? `（AIの予想: ${race.technique ? `${race.technique} ` : ""}${(race.probability * 100).toFixed(0)}%）`
      : "";

  let dateStr = "";
  if (race.date) {
    const parts = race.date.split("-");
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  const messages = [
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n${winnerBoat}号艇が${fromCourse}1着${predictionStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\nAIの分析力に驚いてます！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n${winnerBoat}号艇が${fromCourse}1着${predictionStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n無料でこの精度はすごい！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n${winnerBoat}号艇が${fromCourse}1着${predictionStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\nデータ分析の力を実感！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n${winnerBoat}号艇が${fromCourse}1着${predictionStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n今日もAI予想が当たった！`,
    `🌊 展開予測的中！【${dateStr}${venue}${raceNo}R】\n\n${winnerBoat}号艇が${fromCourse}1着${predictionStr}\n予想通りの展開でした ✅\n\n龍神レーダーで展開予測的中🎉\n的中率の高さに満足してます！`,
  ];

  return messages[Math.floor(Math.random() * messages.length)];
};
