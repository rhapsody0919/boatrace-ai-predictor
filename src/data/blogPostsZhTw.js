/**
 * ブログ記事の繁體中文版メタデータ。
 * 本文は public/blog/{id}-zh-tw.md、日本語版メタデータは blogPosts.js の該当 id と対応する。
 * date/image 等、翻訳不要なフィールドは blogPosts.js 側の値をそのまま使う想定のため持たない。
 * 詳細: docs/design/blog-i18n/spec.md「拡張: zh-TW版」, docs/adr/0008-blog-multilingual-partial-translation.md
 */
export const blogPostsZhTw = [
  {
    id: "winning-technique-analysis-guide",
    title: "什麼是決勝技巧數據分析？依會場、艇號查看獲勝模式的新功能",
    description:
      "新功能：依會場、艇號分析過去90天數據中，各艇以哪種決勝技巧（逃走・切入・外攻等）奪得第一名。介紹如何運用於投注組合選擇、排除判斷的依據。",
    category: "數據分析",
    tags: ["決勝技巧", "新功能", "數據分析", "依據", "依會場分類"],
    readTime: "7分鐘",
  },
  {
    id: "motor-condition-guide",
    title: "什麼是馬達狀況？查看今日比賽各艇號2連率的新功能",
    description:
      "新功能：只要選擇今日舉行的比賽，即可一覽各艇馬達的2連率・3連率。並非抽象的馬達編號排名，而是設計成能直接用於實際下注判斷。",
    category: "數據分析",
    tags: ["馬達", "新功能", "數據分析", "依據", "2連率"],
    readTime: "7分鐘",
  },
];

export function getZhTwOverride(id) {
  return blogPostsZhTw.find((post) => post.id === id);
}

export function isZhTwAvailable(id) {
  return blogPostsZhTw.some((post) => post.id === id);
}
