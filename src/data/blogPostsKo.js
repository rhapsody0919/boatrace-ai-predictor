/**
 * ブログ記事の韓国語版メタデータ。
 * 本文は public/blog/{id}-ko.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使うため持たない。
 * imageは記事に埋め込む図解の文言が言語ごとに異なるため、韓国語版の画像パスを明示している。
 * 2026-08-17時点、パイロットとして2記事のみ展開（zh-TWの需要確認前だが、記事単位の
 * 動的言語判定設計のため小規模な追加は技術的リスクが無いと判断）。
 * 詳細: docs/design/blog-i18n/spec.md「拡張: zh-TW版」, docs/adr/0008-blog-multilingual-partial-translation.md
 */
export const blogPostsKo = [
  {
    id: "first-mark-prediction-guide",
    title: "1마크 전개 예측이란? AI가 읽어내는 레이스 전개의 원리",
    description:
      "BoatAI의 전개 예측 기능을 철저히 해설. 선수의 결정기술 분포・ST・모터 성능으로부터 1마크 회전 시의 전개를 AI가 통계적으로 예측하는 원리와 마권 전략 활용법을 소개합니다.",
    category: "사용법",
    tags: ["전개예측", "1마크", "결정기술", "AI예측", "사용법"],
    readTime: "10분",
    image: "/images/blog/first-mark-kimarite-donut-ko.jpg",
  },
  {
    id: "suji-funaken-guide",
    title:
      "스지 마권이란? 경기장별 노림수 패턴까지 조견표로 해설【오무라 1번정 승률 약 60% 등】",
    description:
      "스지 마권의 기본 패턴을 조견표로 정리. 인코스 도주・마쿠리・사시별 구매 조합, 역스지 판별법에 더해 오무라・아시야・도쿠야마 등 인코스 도주가 잘 나오는 경기장, 도다・에도가와 등 마쿠리가 잘 나오는 경기장의 경향도 해설합니다.",
    category: "전략",
    tags: ["스지마권", "구매조합", "전개예측", "마쿠리", "사시", "인코스도주"],
    readTime: "12분",
    image: "/images/blog/suji-funaken-chart-ko.jpg",
  },
];

export function getKoreanOverride(id) {
  return blogPostsKo.find((post) => post.id === id);
}

export function isKoreanAvailable(id) {
  return blogPostsKo.some((post) => post.id === id);
}
