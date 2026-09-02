/**
 * ネタ種別→展開先チャネルの対応表（spec.md FR2）。
 * 全ネタ×全5チャネルの総当たりはしない。壁打ちセッション（2026-09-01）の
 * 合意に基づく初期値。運用しながら見直す想定のため、この定数を変更するだけで
 * チャネルレンダラー側のロジックには影響しない。
 */

export const CHANNEL_MATRIX = {
  // 新機能: 5チャネル全部に価値がある（解説動画・SNS訴求とも相性が良い）
  "new-feature": ["blog", "note", "x", "tiktok", "youtube"],

  // 会場特性: 動画（TikTok）は既存の「会場攻略型」ローテーションに乗るため、
  // ここでは軽量な文字/画像系チャネルのみ。YouTube解説動画は毎回は作らない
  "venue-characteristic": ["blog", "note", "x", "tiktok"],

  // データ知見: 数値・グラフが主役。動画化は既存テンプレートが無い型もあるため
  // 初期値はblog/note/xのみに留める（TikTok用テンプレートが揃ったら追加検討）
  "data-insight": ["blog", "note", "x"],

  // 成績: 当日の速報性が価値。動画制作コストに見合わないため軽量チャネルのみ
  "daily-result": ["blog", "note", "x"],
};

export function getChannelsForTopic(sourceId) {
  const channels = CHANNEL_MATRIX[sourceId];
  if (!channels) {
    throw new Error(
      `未知のネタ種別 "${sourceId}" に対するチャネルマトリクスが定義されていません。CHANNEL_MATRIXに追記してください`,
    );
  }
  return channels;
}
