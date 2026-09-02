/**
 * ネタ種別→展開先チャネルの対応表（spec.md FR2）。
 * 全ネタ×全5チャネルの総当たりはしない。壁打ちセッション（2026-09-01）の
 * 合意に基づく初期値。運用しながら見直す想定のため、この定数を変更するだけで
 * チャネルレンダラー側のロジックには影響しない。
 *
 * 2026-09-02修正: 初期設計ではYouTubeを「新機能」ネタ限定にしていたが、
 * これは設計ミスと判断（チャネル品質検証フェーズでユーザー指摘）。
 * YouTubeもXと同じ基準で使ってよいチャネルとし、Xが使える系統には
 * すべてYouTubeも含める。
 */

export const CHANNEL_MATRIX = {
  // 新機能: 5チャネル全部に価値がある（解説動画・SNS訴求とも相性が良い）
  "new-feature": ["blog", "note", "x", "tiktok", "youtube"],

  // 会場特性: 既存の「会場攻略型」TikTokローテーションに乗る。YouTube解説動画も対象
  "venue-characteristic": ["blog", "note", "x", "tiktok", "youtube"],

  // データ知見: 数値・グラフが主役。TikTok用テンプレートは無いため見送るが、
  // YouTubeはXと同じ扱いとする
  "data-insight": ["blog", "note", "x", "youtube"],

  // 成績: 当日の速報性が価値。TikTok用の型は無いため見送るが、
  // YouTubeはXと同じ扱いとする
  "daily-result": ["blog", "note", "x", "youtube"],
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
