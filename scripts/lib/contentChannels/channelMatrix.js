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
 *
 * 2026-09-02追加修正（TikTokギャンブルポリシー対応、docs/proposal/
 * tiktok-non-gambling-content-ideas.md・BOA-237）: TikTok広告ポリシーは
 * 「賭けの結果に影響する統計・インサイト」自体を規制対象にしており、表現を
 * 工夫しても回避できないと判明した（`docs/operation/sns-video-producer-prompt.md`
 * 絶対厳守ルール12）。このため、TikTokへの展開可否は**ネタ種別（カテゴリ）
 * 単位ではなく、個別ネタごとの判定**に変更する。
 * - `new-feature`・`venue-characteristic`・`data-insight`・`daily-result`の
 *   4系統は、成績・確率・回収率等の「賭けの判断材料になりうる数値」を扱うのが
 *   前提のネタ種別のため、CHANNEL_MATRIX上ではTikTokを含めない
 *   （個別ネタが例外的に安全な場合の判定はgetChannelsForTopicの
 *   isGamblingRelevantフラグで行う。既定値は「危険側」＝TikTok除外）
 * - `new-feature`は「使い方ライフハック型」（docs/proposal/
 *   tiktok-non-gambling-content-ideas.md案4）を吸収する形で対象を拡大した。
 *   新機能に限らず、既存機能（言語切替・レース間ナビゲーション・選手ニュース・
 *   会場ガイド等、成績・確率と無関係なUI機能）の使い方紹介も`new-feature`
 *   ネタとして扱ってよい。この場合のみisGamblingRelevant:falseを渡すことで
 *   TikTokにも展開できる
 * - 新設3系統（`competition-trivia`・`overseas-intro`・`service-trust`）は、
 *   同ドキュメントの案1・2・3に対応する常磐（evergreen）ネタ種別。日々の実
 *   データに紐づかず、成績・確率・回収率を一切扱わない設計のため、TikTokを
 *   既定で含める（isGamblingRelevantを渡す必要はない）
 * - 案5「観戦体験型」は実レース映像素材が必要で、現行パイプライン
 *   （Remotionによるデータ可視化中心の制作フロー）では制作できないため、
 *   CHANNEL_MATRIXには追加しない（企画のみdocs/proposal/に残す）
 */

export const CHANNEL_MATRIX = {
  // 新機能・既存機能の使い方紹介: 成績・確率に触れない機能紹介のみTikTok可
  // （個別ネタでisGamblingRelevant:falseを明示した場合のみ）
  "new-feature": ["blog", "note", "x", "youtube"],

  // 会場特性: 決まり手傾向・勝率等の成績データを扱うのが前提のためTikTok対象外。
  // 観光・設備・歴史等の成績と無関係な切り口に限り個別ネタで安全判定できる
  "venue-characteristic": ["blog", "note", "x", "youtube"],

  // データ知見: 数値・グラフが主役で、性質上ほぼ確実に「賭けの判断材料」に
  // 該当するためTikTok対象外
  "data-insight": ["blog", "note", "x", "youtube"],

  // 成績: 当日の勝敗・回収率速報そのものがTikTokポリシーの対象になるため対象外
  "daily-result": ["blog", "note", "x", "youtube"],

  // 競技解説・技術トリビア型（案1、2026-09-02新設）: 全艇同一規格・ターンの
  // 遠心力・進入コースが決まる仕組み等、成績・確率に一切触れない競技解説。
  // 常磐ネタのためblog/noteのSEO記事とは別枠（重複コンテンツを避ける）
  "competition-trivia": ["tiktok", "x", "youtube"],

  // 海外向けKyotei入門型（案2、2026-09-02新設）: 英語字幕、競技解説の海外版。
  // 既存i18n調査で「観戦教育コンテンツ」需要が中心と判明済み
  "overseas-intro": ["tiktok", "x", "youtube"],

  // サービス信頼性・スケール訴求型（案3、2026-09-02新設）: 収集レース数・
  // 分析指標数等のインフラ規模を可視化。的中率等の精度指標は使わない
  "service-trust": ["tiktok", "x", "youtube"],
};

/**
 * @param {string} sourceId - CHANNEL_MATRIXのキー
 * @param {{isGamblingRelevant?: boolean}} [options] - 既定の4系統
 *   （new-feature/venue-characteristic/data-insight/daily-result）でのみ
 *   意味を持つ。個別ネタが「賭けの判断材料になる数値・統計を扱っていない」と
 *   明確に判定できた場合のみisGamblingRelevant:falseを渡すと、そのネタに
 *   限りTikTokを展開先に含める。判断に迷う場合は既定値（true=除外）のまま
 *   にする（`docs/proposal/tiktok-non-gambling-content-ideas.md`の判断基準:
 *   「この数字・情報は、視聴者が今日の賭け目を選ぶ判断材料に直結するか？」
 *   にYesと言えないなら安全側に倒す）
 */
export function getChannelsForTopic(sourceId, { isGamblingRelevant } = {}) {
  const channels = CHANNEL_MATRIX[sourceId];
  if (!channels) {
    throw new Error(
      `未知のネタ種別 "${sourceId}" に対するチャネルマトリクスが定義されていません。CHANNEL_MATRIXに追記してください`,
    );
  }
  if (isGamblingRelevant === false && !channels.includes("tiktok")) {
    return [...channels, "tiktok"];
  }
  return channels;
}
