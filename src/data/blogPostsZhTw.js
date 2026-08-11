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
  {
    id: "ai-prediction-accuracy-review",
    title: "賽艇AI預測真的準嗎？3個月15,000場比賽的驗證結果",
    description:
      "以15,000場比賽驗證AI預測的命中率・回收率。誠實公開各模型的優缺點、與其他服務的差異、AI預測的極限。",
    category: "數據分析",
    tags: ["AI預測", "命中率", "回收率", "驗證", "透明度"],
    readTime: "10分鐘",
  },
  {
    id: "night-race-strategy",
    title: "夜間賽攻略法——與白天比賽不同的5個特徵與數據分析",
    description:
      "以數據解說夜間賽的5個特徵（氣溫變化・水面穩定・內道勝率提升等）與各舉辦會場的攻略要點。",
    category: "策略",
    tags: ["夜間賽", "攻略", "蒲郡", "丸龜", "大村", "馬達"],
    readTime: "9分鐘",
  },
  {
    id: "sg-race-guide-2026",
    title: "2026年SG比賽完全指南——各賽事特徵與投注攻略要點",
    description:
      "解說2026年SG比賽全8戰的特徵與攻略要點。從總理盃到總決賽，介紹SG特有的預測注意事項與BoatAI活用法。",
    category: "進階玩家",
    tags: ["SG", "總決賽", "全明星賽", "分級賽事", "2026年"],
    readTime: "10分鐘",
  },
  {
    id: "how-to-predict-races",
    title: "賽艇預測方法完全指南——用數據與AI提升命中率",
    description:
      "以超過1萬場比賽的數據解說賽艇預測所需的6個要素。以初學者也能理解的方式介紹選手勝率・馬達・航道・ST・展示・天候的判讀方法，以及AI預測的活用法。",
    category: "初學者向",
    tags: ["預測", "訣竅", "命中率", "初學者", "AI預測", "數據分析"],
    readTime: "12分鐘",
  },
];

export function getZhTwOverride(id) {
  return blogPostsZhTw.find((post) => post.id === id);
}

export function isZhTwAvailable(id) {
  return blogPostsZhTw.some((post) => post.id === id);
}
