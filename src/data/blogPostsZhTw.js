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
  {
    id: "trifecta-betting-guide",
    title: "3連單投注方法完全攻略——從縮減投注組合到資金分配",
    description:
      "以數據解說提升3連單回收率的投注組合縮減方法、排列式與全組合的靈活運用、依點數分類的回收率數據、資金分配的思考方式。",
    category: "策略",
    tags: ["3連單", "投注方法", "排列式", "資金管理", "投注組合"],
    readTime: "10分鐘",
  },
  {
    id: "improve-recovery-rate",
    title: "如何將賽艇回收率提升至100%以上——1萬場比賽數據顯示的現實",
    description:
      "突破抽成率25%這道牆的5個策略。以數據解說比賽篩選・投注組合種類・點數管理・資金管理・AI活用。並公開BoatAI達成回收率104%的實績。",
    category: "策略",
    tags: ["回收率", "獲勝方法", "資金管理", "數據分析", "抽成率"],
    readTime: "10分鐘",
  },
  {
    id: "beginners-start-guide",
    title: "賽艇初學者入門指南——從投注方法到AI預測活用法",
    description:
      "給想開始玩賽艇的人的完全指南。基本規則、7種投注組合解說、TELEBOAT註冊方法、初學者推薦的投注方法、預算的思考方式。",
    category: "初學者向",
    tags: ["初學者", "入門方法", "投注組合", "TELEBOAT", "入門"],
    readTime: "10分鐘",
  },
  {
    id: "first-mark-prediction-guide",
    title: "什麼是1轉彎展開預測？AI解讀比賽走勢的機制",
    description:
      "徹底解說BoatAI的展開預測功能。介紹AI如何從選手的決勝技巧分布・ST・馬達性能統計預測1轉彎迴旋的走勢，以及活用於投注策略的方法。",
    category: "使用方法",
    tags: ["展開預測", "1轉彎", "決勝技巧", "AI預測", "使用方法"],
    readTime: "10分鐘",
  },
  {
    id: "picks-performance-report",
    title: "「今日精選」達成回收率104%——2,577場比賽的實績數據",
    description:
      "BoatAI的「今日精選」功能，累計2,577場比賽創下回收率104%的紀錄。公開逆轉25%抽成率、實現正收支的機制，以及誠實面對的課題。",
    category: "實績分析",
    tags: ["今日精選", "回收率", "數據挖掘", "實績公開"],
    readTime: "7分鐘",
  },
  {
    id: "venue-visit-guide",
    title: "賽艇場遊玩指南——初次造訪也能120%盡興的方法",
    description:
      "賽艇場不只有投注券！入場費100日圓、名物美食、夜間比賽觀戰、也很適合約會。從攜帶物品・預算・初學者注意事項，120%盡興現場觀戰的完全指南。",
    category: "初學者向",
    tags: ["賽艇場", "遊玩方式", "初學者", "美食", "夜間賽", "觀戰指南"],
    readTime: "12分鐘",
  },
  {
    id: "picks-guide",
    title: "「今日精選」功能使用方法——數據挖掘精選的高回收率比賽",
    description:
      "徹底解說BoatAI的「今日精選」功能。透過15個會場・34種模式的數據挖掘，自動抽取回收率超過100%的比賽。從畫面判讀方法、依投注方式的活用法，到值得關注比賽的使用方式。",
    category: "使用方法",
    tags: ["今日精選", "數據挖掘", "回收率", "使用方法", "模式配對"],
    readTime: "8分鐘",
  },
  {
    id: "10000-races-analysis",
    title: "BoatAI突破1萬場比賽——數據回顧AI預測的實力與極限",
    description:
      "BoatAI的累計分析比賽數突破1萬場。從12,324場數據看出單勝命中率47.4%・3連複命中率18.0%的實力，並誠實公開回收率的課題。",
    category: "實績分析",
    tags: ["1萬場比賽", "實績分析", "命中率", "回收率", "3連複", "數據公開"],
    readTime: "10分鐘",
  },
  {
    id: "suji-funaken-guide",
    title: "什麼是「筋投注」？依會場分類的鎖定模式速查表",
    description:
      "以速查表整理筋投注的基本模式。介紹依內道逃走・外攻・切入分類的投注組合、逆筋的分辨方法，以及大村・蘆屋・德山等內道逃走容易成功的會場、戶田・江戶川等容易外攻的會場傾向。",
    category: "策略",
    tags: ["筋投注", "投注組合", "走勢預測", "外攻", "切入", "內道逃走"],
    readTime: "12分鐘",
  },
];

export function getZhTwOverride(id) {
  return blogPostsZhTw.find((post) => post.id === id);
}

export function isZhTwAvailable(id) {
  return blogPostsZhTw.some((post) => post.id === id);
}
