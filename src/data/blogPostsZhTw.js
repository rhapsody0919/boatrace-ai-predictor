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
  {
    id: "sg-g1-race-strategy",
    title: "贏得SG比賽・G1比賽的策略【分級賽事攻略】",
    description:
      "SG、G1等分級賽事與一般賽事完全不同。解說預賽與決賽的投注方式區分、得點率的活用法、夢幻戰的鎖定要點。",
    category: "進階玩家",
    tags: ["SG", "G1", "分級賽事", "策略", "得點率"],
    readTime: "12分鐘",
  },
  {
    id: "special-planned-races",
    title: "什麼是企劃比賽？推薦初學者的理由【分辨穩健比賽的方法】",
    description:
      "1號艇A級固定等企劃比賽，即使初學者也容易命中。詳細解說企劃比賽的種類、尋找方法、活用法。",
    category: "初學者向",
    tags: ["企劃比賽", "初學者", "1號艇", "A級", "穩健比賽"],
    readTime: "9分鐘",
  },
  {
    id: "venue-ashiya",
    title: "蘆屋賽艇場攻略指南——標準模型3連單回收率1259%",
    description:
      "蘆屋賽艇場的特徵與攻略法，附BoatAI實績數據。日本內道最強的會場之一，標準模型的3連單回收率達1259%。",
    category: "會場攻略",
    tags: ["蘆屋", "賽艇場", "攻略", "標準", "內道強"],
    readTime: "5分鐘",
  },
  {
    id: "how-we-measure-accuracy",
    title: "BoatAI的實績是真的嗎？徹底解說計測方法與透明度",
    description:
      "BoatAI的命中率・回收率是如何計測的？為什麼要公開所有數據？徹底解說實績的可信度與透明度。",
    category: "數據分析",
    tags: ["實績", "命中率", "回收率", "透明度", "計測方法"],
    readTime: "12分鐘",
  },
  {
    id: "ai-vs-human",
    title: "AI預測vs人類預測，1個月實測驗證結果【數據公開】",
    description:
      "AI預測的投注券與人類預測的投注券，哪個比較準？2025年12月整整1個月，我們實施了實測驗證。",
    category: "數據分析",
    tags: ["AI預測", "驗證", "數據", "比較"],
    readTime: "11分鐘",
  },
  {
    id: "rough-race-signals",
    title: "分辨容易爆冷的賽艇比賽的5個信號——AI從1,899場比賽中發現",
    description:
      "以數據解說爆冷比賽的5個特徵（氣溫變化・水面穩定・內道勝率上升等）與各舉辦會場的攻略要點。",
    category: "初學者向",
    tags: ["爆冷比賽", "預測", "信號", "分辨方法"],
    readTime: "10分鐘",
  },
  {
    id: "stadium-strategy-guide",
    title: "依會場分類的賽艇攻略指南——24會場的特徵與鎖定要點",
    description:
      "依賽艇會場不同，獲勝模式完全不同。完整介紹全國24處會場的特徵、1號艇勝率、內道強弱勢的會場。",
    category: "策略",
    tags: ["賽艇場", "攻略", "特徵", "1號艇勝率"],
    readTime: "15分鐘",
  },
  {
    id: "monthly-50k-roadmap",
    title: "用賽艇賺取每月5萬日圓副業收入的路線圖【重視再現性】",
    description:
      "以每月5萬日圓為目標的資金管理方法，以及活用BoatAI數據分析的投注思考方式。",
    category: "策略",
    tags: ["賽艇", "資金管理", "每月5萬日圓", "數據活用"],
    readTime: "12分鐘",
  },
  {
    id: "why-you-lose",
    title: "賽艇輸家的5個共通點與AI預測的解決方案",
    description:
      "為什麼您總是無法在賽艇中獲勝？傳達從1,899場比賽數據分析中看出的「輸家模式」，以及運用AI預測的解決方案。",
    category: "初學者向",
    tags: ["賽艇", "AI預測", "無法獲勝", "輸家模式"],
    readTime: "10分鐘",
  },
  {
    id: "odds-expected-value-guide",
    title: "賽艇賠率的判讀方法——用期望值選擇投注券的方法",
    description:
      "以數據解說賽艇賠率的機制與期望值的思考方式——過剩人氣的陷阱、鎖定賠率歪曲、依投注組合種類的損益平衡賠率。",
    category: "數據分析",
    tags: ["賠率", "期望值", "過剩人氣", "投注策略", "數據分析"],
    readTime: "9分鐘",
  },
];

export function getZhTwOverride(id) {
  return blogPostsZhTw.find((post) => post.id === id);
}

export function isZhTwAvailable(id) {
  return blogPostsZhTw.some((post) => post.id === id);
}
