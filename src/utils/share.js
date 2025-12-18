/**
 * SNSシェア関数
 */

/**
 * AI予想をXでシェア
 * @param {Object} race - レースデータ
 */
export const shareRacePredictionToX = (race) => {
  const venue = race.venue || '不明';
  const raceNo = race.raceNo || '?';
  const topPick = race.prediction?.topPick || '?';
  const top3 = race.prediction?.top3?.join('-') || '?-?-?';
  const aiScore = race.prediction?.aiScores?.[0]?.toFixed(1) || '?';

  // 日付をフォーマット (YYYY-MM-DD -> MM/DD)
  let dateStr = '';
  if (race.date) {
    const parts = race.date.split('-');
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  const text = `🏁 BoatAI予想【${dateStr}${venue}${raceNo}R】

本命: ${topPick}号艇
推奨: ${top3}

AIスコア: ${aiScore}

▼詳細を見る
https://boat-ai.jp/

#競艇 #ボートレース #AI予想 #BoatAI`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};

/**
 * 的中結果をXでシェア
 * @param {Object} race - レースデータ（結果含む）
 */
export const shareHitRaceToX = (race) => {
  const venue = race.venue || '不明';
  const raceNo = race.raceNo || '?';
  const prediction = race.prediction?.top3?.join('-') || '?-?-?';
  const result = race.result?.join('-') || '?-?-?';
  const payout = race.totalPayout || 0;

  // 日付をフォーマット (YYYY-MM-DD -> MM/DD)
  let dateStr = '';
  if (race.date) {
    const parts = race.date.split('-');
    if (parts.length === 3) {
      dateStr = `${parts[1]}/${parts[2]} `;
    }
  }

  const text = `🎯 的中！【${dateStr}${venue}${raceNo}R】

予想: ${prediction}
結果: ${result} ✅
配当: ${payout.toLocaleString()}円

BoatAIで予想的中🎉

▼予想を見る
https://boat-ai.jp/

#競艇 #ボートレース #的中 #BoatAI`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};

/**
 * 統計データをXでシェア
 * @param {Object} stats - 統計データ
 */
export const shareDailyStatsToX = (stats) => {
  const date = stats.date || new Date().toISOString().split('T')[0];
  const tanWins = stats.tanWins || 0;
  const fukuWins = stats.fukuWins || 0;
  const total = stats.total || 1;
  const tanRate = ((tanWins / total) * 100).toFixed(1);
  const fukuRate = ((fukuWins / total) * 100).toFixed(1);

  const text = `📊 本日の実績【${date}】

✅ 単勝: ${tanWins}/${total}（${tanRate}%）
✅ 複勝: ${fukuWins}/${total}（${fukuRate}%）

BoatAIのAI予想で的中率UP📈

▼無料で使える
https://boat-ai.jp/

#競艇 #ボートレース #AI予想`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'width=600,height=400');
};
