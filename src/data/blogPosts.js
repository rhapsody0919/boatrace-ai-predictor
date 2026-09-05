import {
  blogPostsEn,
  getEnglishOverride,
  isEnglishAvailable,
} from "./blogPostsEn.js";
import {
  blogPostsZhTw,
  getZhTwOverride,
  isZhTwAvailable,
} from "./blogPostsZhTw.js";
import {
  blogPostsKo,
  getKoreanOverride,
  isKoreanAvailable,
} from "./blogPostsKo.js";

// 言語別ブログ翻訳データの設定。新言語追加時はここに1エントリ足すだけで良い
// （BlogPost.jsx/Blog.jsxはこのマップ経由でのみ言語別データにアクセスする）
const BLOG_LANG_CONFIG = {
  en: {
    posts: blogPostsEn,
    getOverride: getEnglishOverride,
    isAvailable: isEnglishAvailable,
    mdSuffix: "-en",
  },
  "zh-TW": {
    posts: blogPostsZhTw,
    getOverride: getZhTwOverride,
    isAvailable: isZhTwAvailable,
    mdSuffix: "-zh-tw",
  },
  ko: {
    posts: blogPostsKo,
    getOverride: getKoreanOverride,
    isAvailable: isKoreanAvailable,
    mdSuffix: "-ko",
  },
};

// Blog post metadata
export const blogPosts = [
  {
    id: "edogawa-course1-win-rate",
    title: "江戸川の1コース勝率は45.5%、全国平均54.3%より8.8ポイント低い理由を実データで検証",
    description:
      "過去90日間の実レース結果で、江戸川の1コース勝率は45.5%（444レース中202勝）、全国平均54.3%より8.8ポイント低く24会場中下から3番目という結果に。潮の影響が強い水面特性がなぜ1コース勝率を下げるのかを実データで解説します。",
    date: "2026-09-05",
    category: "データ分析",
    tags: ["1コース勝率", "会場特性", "江戸川", "データ分析"],
    readTime: "5分",
    featured: false,
    image: "/images/blog/edogawa-course1-win-rate.jpg",
  },
  {
    id: "language-switcher-guide",
    title: "4言語切替とは？海外からのアクセスにも対応する龍神レーダーの言語機能",
    description:
      "ヘッダー右上の🌐ボタンから日本語・English・繁體中文・한국어の4言語をワンタップで切り替えられる機能を解説。言語ごとの専用URL、ブックマーク・SNSシェアへの対応、対応ページの範囲まで使い方を紹介します。",
    date: "2026-09-03",
    category: "使い方",
    tags: ["言語切替", "多言語対応", "使い方", "UI機能"],
    readTime: "5分",
    featured: false,
    image: "/images/blog/language-switcher-guide.jpg",
  },
  {
    id: "volatility-top5-0905",
    title: "本日9/5、132レース中「イン崩れ警戒」トップは戸田6R（99%） — 本日のイン崩れ警戒レースTOP5",
    description:
      "2026年9月5日開催132レース中、イン崩れ指数トップは戸田6R（99.2%）。1号艇の今節平均ST0.248秒・AI逃げ確率20%という発走前データを基に、本日のイン崩れ警戒レースTOP5と会場ごとの効きやすさの違いを実データで解説します。",
    date: "2026-09-05",
    category: "データ分析",
    tags: ["イン崩れ指数", "データ分析", "戸田", "AI予想"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/volatility-top5-0905.jpg",
  },
  {
    id: "toda-course1-winrate-low",
    title: "戸田の1コース勝率は41.5%、全国平均54.4%より12.9ポイント低い理由を実データで検証",
    description:
      "龍神レーダーの実レース結果データで、戸田の1コース勝率を全国24会場と比較。戸田41.5%は全国平均54.4%より12.9ポイント低く、全国ワースト2位という結果に。全国最狭コースという物理的な理由と、舟券への活かし方を解説します。",
    date: "2026-09-05",
    category: "データ分析",
    tags: ["会場特性", "戸田", "1コース勝率", "データ分析"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/toda-course1-winrate-low.jpg",
  },
  {
    id: "kiryu-freshwater-nige-rate",
    title: "桐生のイン逃げ率は51.7%、汽水会場より最大10ポイント高い理由を実データで検証",
    description:
      "決まり手データ分析の実データで、淡水会場の桐生と汽水会場の江戸川・浜名湖のイン逃げ率を比較。桐生51.7%に対し汽水会場平均は45.8%（江戸川41.7%・浜名湖49.8%）で、同じ汽水でも河口型と湖型で8ポイントの差がある理由を解説します。",
    date: "2026-09-04",
    category: "データ分析",
    tags: ["イン逃げ", "決まり手データ分析", "桐生", "江戸川", "浜名湖", "会場特性"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/kiryu-freshwater-nige-rate.jpg",
  },
  {
    id: "volatility-index-fukuoka-0904",
    title: "イン崩れ指数100%のレースの見方 - 本日9/4福岡5Rを実例に判定根拠を解説",
    description:
      "龍神レーダーのレース詳細ページに表示される「イン崩れ指数」。2026年9月4日・福岡5Rの発走前データを実例に、指数の算出根拠と会場ごとの効きやすさの違いを実データで解説します。",
    date: "2026-09-04",
    category: "データ分析",
    tags: ["イン崩れ指数", "データ分析", "福岡", "AI予想"],
    readTime: "5分",
    featured: false,
    image: "/images/blog/volatility-index-fukuoka-0904.jpg",
  },
  {
    id: "volatility-index-case-study",
    title: "イン崩れ指数100%は当たるのか？9/3住之江6Rの実例で検証",
    description:
      "龍神レーダーのレース詳細ページに表示される「イン崩れ指数」。2026年9月3日・住之江6Rで表示された「イン崩れ指数100%」という予測が、実際のレース結果とどう対応したのかを実データで検証します。",
    date: "2026-09-03",
    category: "データ分析",
    tags: ["イン崩れ指数", "データ分析", "予想的中検証", "住之江", "AI予想"],
    readTime: "5分",
    featured: false,
    image: "/images/blog/volatility-index-case-study.jpg",
  },
  {
    id: "boat-number-technique-consistency",
    title: "1号艇はどこでも「逃げ」、4号艇の決まり手は会場でバラバラ",
    description:
      "決まり手データ分析の実データで、1号艇と4号艇の「会場による決まり手のブレやすさ」を比較。1号艇は全24会場で逃げ率90%超と安定する一方、4号艇はまくり・差し・まくり差しと会場ごとに主役の決まり手が変わり、そのブレ幅は5倍以上でした。",
    date: "2026-09-02",
    category: "データ分析",
    tags: ["決まり手", "まくり", "逃げ", "会場別データ", "データ分析"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/boat-number-technique-consistency.jpg",
  },
  {
    id: "venue-grid-navigation",
    title: "開催場一覧ページを刷新！24会場から2タップで目的のレース分析へ",
    description:
      "トップページを24会場の開催場一覧にリニューアル。開催状況・グレード・時間帯アイコン・次のレース時刻が一目でわかり、会場→レース→データ分析へ最短2タップ。レースごとの専用URLでブックマーク・シェアにも対応した新しい使い方を解説します。",
    date: "2026-08-29",
    category: "新機能",
    tags: ["新機能", "UI改善", "開催場一覧", "使い方"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/venue-list-grid.jpg",
  },
  {
    id: "race-mood-effect-guide",
    title:
      "イン崩れ注意度に波紋アニメーションを追加。荒れそうなレースがひと目でわかる",
    description:
      "イン崩れ注意度のアイコン背後に、荒れ度合いに応じて強弱が変わる波紋アニメーションを追加した新機能を解説。数値を読む前に、波紋の勢いで大まかな荒れ度合いをつかむ使い方を紹介します。",
    date: "2026-08-18",
    category: "新機能",
    tags: ["イン崩れ指数", "新機能", "UI改善", "アニメーション"],
    readTime: "5分",
    featured: false,
    image: "/images/blog/race-mood-effect-badge.jpg",
  },
  {
    id: "race-ai-copy-guide",
    title: "AI用にコピーとは？ボートレースのデータをChatGPTで検証する新機能",
    description:
      "龍神レーダーのデータ出走表を、ChatGPTやGeminiなど外部のAIチャットツールにそのまま貼り付けて分析できる新機能を解説。単勝・3連単・3連複の3種類の質問文から選んで、複数のAIで見比べる使い方を紹介します。",
    date: "2026-08-18",
    category: "新機能",
    tags: ["AI予想", "新機能", "外部連携", "ChatGPT"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/race-ai-copy-banner.jpg",
  },
  {
    id: "data-race-table-guide",
    title: "データ出走表とは？6選手の分析データを一覧比較できる新機能",
    description:
      "レース予想ページをリニューアルし、出走6選手×7つの分析データ（モーター・調子・ST安定度・展示タイム・決まり手型・回収率）を一覧比較できるデータ出走表を追加。自分で予想を組み立てるための作業台としての使い方を解説します。",
    date: "2026-08-08",
    category: "データ分析",
    tags: ["出走表", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/data-race-table.jpg",
  },
  {
    id: "race-review-guide",
    title: "データで振り返るとは？レース結果を分析データで検証する新機能",
    description:
      "レース結果確定後、勝った艇を龍神レーダーの分析データと機械的に照合し「整合した点・違った点」を表示する新機能を解説。AI予想の当否も毎レース誠実に検証します。",
    date: "2026-08-08",
    category: "データ分析",
    tags: ["レース結果", "新機能", "データ分析", "検証", "振り返り"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/race-review.jpg",
  },
  {
    id: "racer-boat-return-rate-guide",
    title: "選手×艇番別回収率分析とは？勝率だけでなく儲かるかを見る新機能",
    description:
      "出走選手ごとに過去180日間・同じ艇番で出走した際の単勝・複勝回収率を分析する新機能を解説。勝率だけでなく実際の収益性の視点を買い目判断に加える方法を紹介します。",
    date: "2026-08-08",
    category: "データ分析",
    tags: ["回収率", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/racer-boat-return-rate-table.jpg",
  },
  {
    id: "exhibition-time-trend-guide",
    title: "選手別展示タイム推移とは？調子の波を展示タイムから読み解く新機能",
    description:
      "出走選手ごとの展示タイム（周回タイム）が過去90日でどう推移しているかを分析する新機能を解説。展示タイムの悪化傾向を選手コンディションの警戒材料として活用する方法を紹介します。",
    date: "2026-08-05",
    category: "データ分析",
    tags: ["展示タイム", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/exhibition-time-trend-table.jpg",
  },
  {
    id: "racer-technique-profile-guide",
    title: "選手別決まり手傾向とは？選手の勝ちパターンを見抜く新機能",
    description:
      "出走選手ごとに過去90日間の勝利時決まり手（逃げ・差し・まくり等）構成比を分析する新機能を解説。選手個人の勝ちパターンを買い目判断の根拠に加える方法を紹介します。",
    date: "2026-08-06",
    category: "データ分析",
    tags: ["決まり手", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/racer-technique-profile-table.jpg",
  },
  {
    id: "racer-form-ranking-guide",
    title:
      "本日の好調・不調選手ランキングとは？レースを選ばず注目選手を発見する新機能",
    description:
      "会場・レースを選ばずに、本日出走する全選手の中から全国勝率の急上昇・急下降選手をランキング表示する新機能を解説。狙い目・除外判断の発見導線として活用する方法を紹介します。",
    date: "2026-08-07",
    category: "データ分析",
    tags: ["選手調子", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/racer-form-ranking-table.jpg",
  },
  {
    id: "winning-technique-analysis-guide",
    title: "決まり手データ分析とは？会場・枠番別の勝ちパターンを見る新機能",
    description:
      "会場・枠番ごとにどの決まり手（逃げ・差し・まくり等）で1着になっているかを過去90日データから分析する新機能を解説。買い目選定・除外判断の根拠として活用する方法を紹介します。",
    date: "2026-07-30",
    category: "データ分析",
    tags: ["決まり手", "新機能", "データ分析", "根拠", "会場別"],
    readTime: "7分",
    featured: true,
    image: "/images/blog/winning-technique-chart.jpg",
  },
  {
    id: "motor-condition-guide",
    title: "モーター2連率とは？本日のレースの枠番別データでわかる新機能",
    description:
      "モーター2連率・3連率とは、そのモーターの成績を表す指標です。本日開催中のレースを選ぶだけで、各艇のモーターの2連率・3連率が一覧でわかる新機能を解説。抽象的なモーター番号ランキングではなく、実際に賭ける判断にそのまま使える設計にしました。",
    date: "2026-07-30",
    category: "データ分析",
    tags: ["モーター", "新機能", "データ分析", "根拠", "2連率"],
    readTime: "7分",
    featured: true,
    image: "/images/blog/motor-condition-table.jpg",
  },
  {
    id: "exhibition-time-top-guide",
    title:
      "展示タイム最速艇の1着転換率とは？「展示が速い艇」の信頼度を見抜く新機能",
    description:
      "会場・枠番ごとに展示タイム最速率と、最速時の1着率を過去90日データから分析する新機能を解説。展示タイムの速さが本番の勝利にどれだけ直結するかを見極める材料として活用する方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["展示タイム", "新機能", "データ分析", "根拠", "会場別"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/exhibition-time-top-chart.jpg",
  },
  {
    id: "nige-outcome-guide",
    title:
      "逃げ成功時の複勝分布とは？「イン逃げが決まった後」の買い目を絞り込む新機能",
    description:
      "逃げで1着が決まったレースに絞って2着・3着のパターンを過去90日データから分析する新機能を解説。展示で逃げが濃厚な時の3連単・3連複の買い目絞り込みに活用する方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["逃げ", "新機能", "データ分析", "根拠", "会場別"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/nige-outcome-table.jpg",
  },
  {
    id: "losing-technique-guide",
    title:
      "負け決まり手データ分析とは？「負け方」から会場・枠番の弱点を見抜く新機能",
    description:
      "1着を逃した際、勝者がどの決まり手で勝っているかを枠番別に過去90日データから分析する新機能を解説。決まり手データ分析（勝ち方）と組み合わせた除外判断の材料として活用する方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["決まり手", "新機能", "データ分析", "根拠", "会場別"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/losing-technique-chart.jpg",
  },
  {
    id: "top-start-guide",
    title: "枠番別トップスタート分析とは？「先に出るだけ」の枠番を見抜く新機能",
    description:
      "会場・枠番ごとにトップスタート率と、トップスタート時の1着率を過去90日データから分析する新機能を解説。スタートを取った時の押し切り力が高い枠番・会場を見分ける方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["トップスタート", "新機能", "データ分析", "根拠", "会場別"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/top-start-chart.jpg",
  },
  {
    id: "st-timing-gap-guide",
    title:
      "展示ST/本番STのズレとは？「展示は速いのに本番で出遅れる」選手を見抜く新機能",
    description:
      "選手ごとに展示STと本番STがどれだけ一致してきたかを過去実績から分析する新機能を解説。展示STが本番の参考になる「安定」した選手を見極める方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["展示ST", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/st-timing-gap-table.jpg",
  },
  {
    id: "racer-form-guide",
    title: "選手調子とは？全国勝率の変化から「今が旬」の選手を見抜く新機能",
    description:
      "出走選手の全国勝率が直近90日でどう変化しているかを分析する新機能を解説。番組表の勝率だけでは見えない選手の「今の調子」を判断材料に加える方法を紹介します。",
    date: "2026-08-03",
    category: "データ分析",
    tags: ["選手調子", "新機能", "データ分析", "根拠", "選手"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/racer-form-table.jpg",
  },
  {
    id: "ai-prediction-accuracy-review",
    title:
      "ボートレースAI予想は本当に当たるのか？ — 3ヶ月15,000レースの検証結果",
    description:
      "AI予想の的中率・回収率を15,000レースで検証。強み・弱み、他サービスとの違い、AI予想の限界まで正直に公開。",
    date: "2026-03-12",
    category: "データ分析",
    tags: ["AI予想", "的中率", "回収率", "検証", "透明性"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/ai-accuracy-comparison-ja.jpg",
  },
  {
    id: "popular-patterns-analysis",
    title: "出目買いは有効か？ — 全24場の出目データをAIが分析した結果",
    description:
      "出目買いの回収率を全24場のデータで検証。出目ランキング、会場別の傾向、出目買いよりデータ分析が有効な理由を解説。",
    date: "2026-03-12",
    category: "データ分析",
    tags: ["出目", "出目買い", "データ分析", "会場別", "回収率"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "win-place-comparison",
    title:
      "2連単と2連複、どちらが儲かるか？ — 控除率・的中率・回収率のデータ比較",
    description:
      "2連単と2連複の違いをデータで徹底比較。的中確率、控除率、回収率から初心者〜中級者に最適な舟券種別を解説。",
    date: "2026-03-12",
    category: "初心者向け",
    tags: ["2連単", "2連複", "舟券", "初心者", "回収率"],
    readTime: "7分",
    featured: false,
  },
  {
    id: "weather-wind-impact",
    title: "天候・風向きがレースを変える — 気象データとボートレース予想の関係",
    description:
      "追い風・向かい風でイン勝率が変わる？風速・波高・雨がレース展開に与える影響を会場別データで解説。",
    date: "2026-03-12",
    category: "データ分析",
    tags: ["天候", "風", "波", "気象", "データ分析"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "motor-performance-deep-dive",
    title:
      "モーター抽選日から勝負が始まる — モーター2連率の正しい読み方と落とし穴",
    description:
      "モーター2連率の正しい見方、節序盤の信頼性問題、部品交換の読み方、展示タイムとの組み合わせ評価をデータで解説。",
    date: "2026-03-12",
    category: "データ分析",
    tags: ["モーター", "2連率", "部品交換", "展示タイム", "データ分析"],
    readTime: "9分",
    featured: false,
  },
  {
    id: "odds-expected-value-guide",
    title: "ボートレースのオッズとは？見方と期待値で舟券を選ぶ方法",
    description:
      "ボートレースのオッズとは何か、見方の基本から期待値の考え方までデータで解説。過剰人気の罠、オッズの歪みを狙う方法、舟券種別ごとの損益分岐オッズまで。",
    date: "2026-03-12",
    category: "データ分析",
    tags: ["オッズ", "期待値", "過剰人気", "舟券", "データ分析"],
    readTime: "9分",
    featured: true,
    image: "/images/blog/odds-expected-value-matrix-ja.jpg",
  },
  {
    id: "night-race-strategy",
    title: "ナイターレース攻略法 — 昼間とは違う5つの特徴とデータ分析",
    description:
      "ナイターレースの5つの特徴（気温変化・水面安定・イン勝率上昇など）と各開催場の攻略ポイントをデータで解説。",
    date: "2026-03-12",
    category: "戦略",
    tags: ["ナイター", "攻略", "蒲郡", "丸亀", "大村", "モーター"],
    readTime: "9分",
    featured: true,
    image: "/images/blog/night-venues-grid-ja.jpg",
  },
  {
    id: "sg-race-guide-2026",
    title: "2026年SGレース完全ガイド — 各レースの特徴と舟券攻略のポイント",
    description:
      "2026年のSGレース全8戦の特徴と攻略ポイントを解説。総理杯からグランプリまで、SG特有の予想の注意点と龍神レーダー活用法。",
    date: "2026-03-12",
    category: "上級者向け",
    tags: ["SG", "グランプリ", "オールスター", "グレードレース", "2026年"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/sg-race-timeline-ja.jpg",
  },
  {
    id: "womens-race-strategy",
    title:
      "女子レーサー戦（ヴィーナスシリーズ）の予想法 — 混合戦との違いとデータ分析",
    description:
      "女子戦は混合戦とここが違う！イン勝率・決まり手傾向・モーター依存度の差をデータで解説。ヴィーナスシリーズの攻略法。",
    date: "2026-03-12",
    category: "戦略",
    tags: ["女子戦", "ヴィーナスシリーズ", "オールレディース", "攻略"],
    readTime: "9分",
    featured: false,
  },
  {
    id: "how-to-predict-races",
    title: "ボートレース予想の仕方 完全ガイド — データとAIで的中率を上げる方法",
    description:
      "ボートレース予想に必要な6つの要素を1万レース超のデータで解説。選手勝率・モーター・コース・ST・展示・天候の見方と、AI予想の活用法を初心者にもわかりやすく紹介。",
    date: "2026-03-12",
    category: "初心者向け",
    tags: ["予想", "コツ", "的中率", "初心者", "AI予想", "データ分析"],
    readTime: "12分",
    featured: true,
    image: "/images/blog/predict-steps-flow-ja.jpg",
  },
  {
    id: "trifecta-betting-guide",
    title: "3連単の買い方 完全攻略 — 買い目の絞り方から資金配分まで",
    description:
      "3連単で回収率を上げるための買い目の絞り方、フォーメーション・ボックスの使い分け、点数別の回収率データ、資金配分の考え方をデータで解説。",
    date: "2026-03-12",
    category: "戦略",
    tags: ["3連単", "買い方", "フォーメーション", "資金管理", "舟券"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/trifecta-formation-matrix-ja.jpg",
  },
  {
    id: "improve-recovery-rate",
    title:
      "ボートレースの回収率を100%以上にする方法 — 1万レースのデータが示す現実",
    description:
      "控除率25%の壁を越えるための5つの戦略。レース選び・舟券種別・点数管理・資金管理・AI活用をデータで解説。龍神レーダーが回収率104%を達成した実績も公開。",
    date: "2026-03-12",
    category: "戦略",
    tags: ["回収率", "勝ち方", "資金管理", "データ分析", "控除率"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/improve-recovery-rate-hitrate-ja.jpg",
  },
  {
    id: "beginners-start-guide",
    title:
      "ボートレース初心者の始め方ガイド — 舟券の買い方からAI予想の活用まで",
    description:
      "ボートレースを始めたい人向けの完全ガイド。基本ルール、舟券7種類の解説、テレボート登録方法、初心者おすすめの買い方、予算の考え方まで。",
    date: "2026-03-12",
    category: "初心者向け",
    tags: ["初心者", "始め方", "舟券", "テレボート", "入門"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/beginners-bet-types-ja.jpg",
  },
  {
    id: "first-mark-prediction-guide",
    title: "1マーク展開予測とは？AIが読み解くレース展開の仕組み",
    description:
      "龍神レーダーの展開予測機能を徹底解説。選手の決まり手分布・ST・モーター性能から1マーク旋回の展開をAIが統計予測する仕組みと、舟券戦略への活用法を紹介。",
    date: "2026-03-12",
    category: "使い方",
    tags: ["展開予測", "1マーク", "決まり手", "AI予想", "使い方"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/first-mark-kimarite-donut-ja.jpg",
  },
  {
    id: "picks-performance-report",
    title: "「今日のおすすめ」が回収率104%を達成 - 2,577レースの実績データ",
    description:
      "龍神レーダーの「今日のおすすめ」機能が累計2,577レースで回収率104%を記録。25%の控除率を逆転してプラス収支を実現した仕組みと、正直な課題を公開。",
    date: "2026-03-02",
    category: "実績分析",
    tags: ["今日のおすすめ", "回収率", "データマイニング", "実績公開"],
    readTime: "7分",
    featured: true,
    image: "/images/blog/picks-performance-funnel-ja.jpg",
  },
  {
    id: "monthly-report-202604",
    title:
      "【2026年4月】龍神レーダー 月間実績レポート - 3モデル×4,278レースの全成績公開",
    description:
      "2026年4月の龍神レーダー実績を3モデル別に徹底分析。本命狙い単勝的中率55.4%、複勝回収率90.8%、スタンダードモデル複勝87.8%で堅実。多摩川・常滑で単勝・3連単ともに100%超え達成。",
    date: "2026-05-07",
    category: "月間レポート",
    tags: ["月間レポート", "2026年4月", "実績公開", "3モデル", "回収率"],
    readTime: "8分",
    featured: true,
  },
  {
    id: "monthly-report-202602",
    title:
      "【2026年2月】龍神レーダー 月間実績レポート - 3モデル×4,165レースの全成績公開",
    description:
      "2026年2月の龍神レーダー実績を3モデル別に徹底分析。スタンダードモデル単勝的中率54.5%（過去最高）、本命狙い3連複回収率92.3%など全データを公開。",
    date: "2026-03-02",
    category: "月間レポート",
    tags: ["月間レポート", "2026年2月", "実績公開", "3モデル", "回収率"],
    readTime: "8分",
    featured: true,
  },
  {
    id: "venue-visit-guide",
    title: "ボートレース場の楽しみ方ガイド - 初めてでも120%満喫する方法",
    description:
      "ボートレース場は舟券だけじゃない！入場料100円、名物グルメ、ナイター観戦、デートにも最適。持ち物・予算・初心者の注意点まで、現地観戦を120%楽しむ完全ガイド。",
    date: "2026-02-21",
    category: "初心者向け",
    tags: [
      "ボートレース場",
      "楽しみ方",
      "初心者",
      "グルメ",
      "ナイター",
      "観戦ガイド",
    ],
    readTime: "12分",
    featured: true,
    image: "/images/blog/venue-visit-timeline-ja.jpg",
  },
  {
    id: "picks-guide",
    title:
      "「今日のおすすめ」機能の使い方 - データマイニングが選ぶ高回収率レース",
    description:
      "龍神レーダーの「今日のおすすめ」機能を徹底解説。15会場・34パターンのデータマイニングで回収率100%超えのレースを自動抽出。画面の見方、賭け方別の活用法、注目レースの使い方まで。",
    date: "2026-02-17",
    category: "使い方",
    tags: [
      "今日のおすすめ",
      "データマイニング",
      "回収率",
      "使い方",
      "ルールマッチ",
    ],
    readTime: "8分",
    featured: true,
    image: "/images/blog/picks-compare-table-ja.jpg",
  },
  {
    id: "10000-races-analysis",
    title: "龍神レーダー 1万レース突破 - データで振り返るAI予想の実力と限界",
    description:
      "龍神レーダーの累計分析レース数が1万を突破。12,324レースのデータから見えた単勝的中率47.4%・3連複的中率18.0%の実力と、回収率の課題を正直に公開。",
    date: "2026-02-16",
    category: "実績分析",
    tags: ["1万レース", "実績分析", "的中率", "回収率", "3連複", "データ公開"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/10000-races-hitrate-ja.jpg",
  },
  {
    id: "monthly-report-202601",
    title:
      "【2026年1月】龍神レーダー 月間実績レポート - 3モデル×5,160レースの全成績",
    description:
      "2026年1月の龍神レーダー実績を3モデル別に徹底分析。スタンダードモデル単勝的中率52.8%、本命狙い回収率91.1%など全データを公開。",
    date: "2026-02-16",
    category: "月間レポート",
    tags: ["月間レポート", "2026年1月", "実績公開", "3モデル", "回収率"],
    readTime: "8分",
    featured: true,
  },
  {
    id: "suji-funaken-guide",
    title: "スジ舟券とは？狙い目パターン早見表で解説【イン逃げ・まくり】",
    description:
      "スジ舟券とは何か、狙い目パターンを早見表で整理。イン逃げ・まくり・差し別の買い目、逆スジの見分け方に加え、大村1号艇60%などイン逃げが決まりやすい会場、戸田・江戸川などまくりが出やすい会場の傾向も解説します。",
    date: "2026-01-30",
    category: "戦略",
    tags: ["スジ舟券", "買い目", "展開予想", "まくり", "差し", "イン逃げ"],
    readTime: "12分",
    featured: true,
    image: "/images/blog/suji-funaken-chart-ja.jpg",
  },
  {
    id: "start-exhibition-guide",
    title: "スタート展示の見方 - 本番結果を読み解く3つのポイント",
    description:
      "展示タイムだけでなく、スタート展示の見方を徹底解説。STタイミング、進入、ターンの安定感から本番の結果を予測する方法をお伝えします。",
    date: "2026-01-23",
    category: "初心者向け",
    tags: ["スタート展示", "展示タイム", "進入", "ターン", "予想"],
    readTime: "10分",
    featured: false,
  },
  {
    id: "sg-g1-race-strategy",
    title: "SGレース・G1レースで勝つための戦略【グレードレース攻略】",
    description:
      "SGやG1などのグレードレースは一般戦とは全く違います。予選と決勝の買い分け、得点率の活用法、ドリーム戦の狙い方を解説。",
    date: "2026-01-23",
    category: "上級者向け",
    tags: ["SG", "G1", "グレードレース", "戦略", "得点率"],
    readTime: "12分",
    featured: true,
    image: "/images/blog/sg-grade-tiers-ja.jpg",
  },
  {
    id: "course-prediction-tips",
    title: "枠なりとは？進入予想のコツ｜崩れを見抜く3つのサイン",
    description:
      "枠なり進入とは何か、前付け選手の見抜き方・深インの影響・進入が変わった時の展開予測を、龍神レーダーのデータ分析視点で解説します。ボートレースは枠番通りに進入するとは限りません。",
    date: "2026-01-23",
    category: "戦略",
    tags: ["進入", "前付け", "枠なり", "コース取り", "予想"],
    readTime: "11分",
    featured: false,
  },
  {
    id: "flying-late-start-strategy",
    title: "フライング・出遅れ後の選手を狙え【F/L持ち選手の攻略法】",
    description:
      "F/L持ちの選手は避けるべき？実はオッズが歪んで狙い目になることも。F持ち選手の心理と、狙い目パターンを解説。",
    date: "2026-01-23",
    category: "戦略",
    tags: ["フライング", "出遅れ", "F持ち", "オッズ", "狙い目"],
    readTime: "10分",
    featured: false,
  },
  {
    id: "special-planned-races",
    title: "企画レースとは？初心者におすすめの理由【堅いレースの見つけ方】",
    description:
      "1号艇A級固定などの企画レースは初心者でも当てやすい。企画レースの種類、見つけ方、活用法を詳しく解説します。",
    date: "2026-01-23",
    category: "初心者向け",
    tags: ["企画レース", "初心者", "1号艇", "A級", "堅いレース"],
    readTime: "9分",
    featured: true,
    image: "/images/blog/planned-race-types-ja.jpg",
  },
  {
    id: "venue-monthly-202512",
    title: "【2025年12月】全国24ボートレース場 龍神レーダー成績まとめ",
    description:
      "2025年12月の龍神レーダー実績を全国24場ごとに徹底分析。芦屋3連単1259%、浜名湖515%など驚異の回収率TOP30を公開。見送り推奨5場も解説。",
    date: "2025-12-31",
    category: "月間レポート",
    tags: ["月間まとめ", "ボートレース場", "全24場", "回収率", "2025年12月"],
    readTime: "15分",
    featured: true,
  },
  {
    id: "venue-omura",
    title: "大村ボートレース場攻略ガイド - ボートレース発祥の地",
    description:
      "大村ボートレース場の特徴と攻略法。ボートレース発祥の地、日本一インが強い場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["大村", "ボートレース場", "攻略", "発祥の地"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-karatsu",
    title: "唐津ボートレース場攻略ガイド - 正直な分析",
    description:
      "唐津ボートレース場の特徴と攻略法。玄界灘に近い場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["唐津", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-fukuoka",
    title: "福岡ボートレース場攻略ガイド - 都心部アクセス抜群のボートレース場",
    description:
      "福岡ボートレース場の特徴と攻略法。都心部のアクセス抜群、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["福岡", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-ashiya",
    title: "芦屋ボートレース場攻略ガイド - 日本一インが強いボートレース場",
    description:
      "芦屋ボートレース場の特徴と攻略法。日本一インが強い場の一つ、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["芦屋", "ボートレース場", "攻略", "イン強い"],
    readTime: "5分",
    featured: true,
    image: "/images/blog/ashiya-stats-ja.jpg",
  },
  {
    id: "venue-wakamatsu",
    title: "若松ボートレース場攻略ガイド - 洞海湾に面したボートレース場",
    description:
      "若松ボートレース場の特徴と攻略法。洞海湾に面した場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["若松", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-shimonoseki",
    title: "下関ボートレース場攻略ガイド - 関門海峡に面したボートレース場",
    description:
      "下関ボートレース場の特徴と攻略法。関門海峡に面した場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["下関", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-tokuyama",
    title: "徳山ボートレース場攻略ガイド - 瀬戸内海に面したナイター場",
    description:
      "徳山ボートレース場の特徴と攻略法。瀬戸内海に面したナイター場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["徳山", "ボートレース場", "攻略", "ナイター"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-miyajima",
    title: "宮島ボートレース場攻略ガイド - 世界遺産・厳島神社の近く",
    description:
      "宮島ボートレース場の特徴と攻略法。世界遺産・厳島神社の近く、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["宮島", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-kojima",
    title: "児島ボートレース場攻略ガイド - 瀬戸内海に面した穏やかな水面",
    description:
      "児島ボートレース場の特徴と攻略法。瀬戸内海に面した穏やかな水面、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["児島", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-marugame",
    title: "丸亀ボートレース場攻略ガイド - 瀬戸内海に面したナイター場",
    description:
      "丸亀ボートレース場の特徴と攻略法。瀬戸内海に面したナイター場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["丸亀", "ボートレース場", "攻略", "ナイター"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-naruto",
    title: "鳴門ボートレース場攻略ガイド - 正直な分析",
    description:
      "鳴門ボートレース場の特徴と攻略法。瀬戸内海に面した場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["鳴門", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-amagasaki",
    title: "尼崎ボートレース場攻略ガイド - センターポール場",
    description:
      "尼崎ボートレース場の特徴と攻略法。センターポール場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["尼崎", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-suminoe",
    title: "住之江ボートレース場攻略ガイド - ボートレースの聖地",
    description:
      "住之江ボートレース場の特徴と攻略法。ボートレースの聖地、全国屈指のインが強い場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["住之江", "ボートレース場", "攻略", "聖地"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-biwako",
    title: "びわこボートレース場攻略ガイド - 琵琶湖の淡水コース",
    description:
      "びわこボートレース場の特徴と攻略法。琵琶湖の淡水、比叡おろし、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["びわこ", "ボートレース場", "攻略", "淡水"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-mikuni",
    title: "三国ボートレース場攻略ガイド - 北陸唯一のボートレース場",
    description:
      "三国ボートレース場の特徴と攻略法。北陸唯一のボートレース場、龍神レーダー実績データ付き。",
    date: "2025-12-31",
    category: "場別攻略",
    tags: ["三国", "ボートレース場", "攻略"],
    readTime: "5分",
    featured: false,
  },
  {
    id: "venue-tsu",
    title: "津ボートレース場攻略ガイド - 日本一インが強いプール型静水面",
    description:
      "津ボートレース場の特徴と攻略法。日本一インが強い場、プール型静水面、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["津", "ボートレース場", "攻略", "イン強い", "静水面"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-tokoname",
    title: "常滑ボートレース場攻略ガイド - 伊勢湾に面した海水コース",
    description:
      "常滑ボートレース場の特徴と攻略法。伊勢湾に面した海水、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["常滑", "ボートレース場", "攻略", "海水"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-gamagori",
    title: "蒲郡ボートレース場攻略ガイド - ナイター専用の海水コース",
    description:
      "蒲郡ボートレース場の特徴と攻略法。ナイター専用場、海水、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["蒲郡", "ボートレース場", "攻略", "ナイター", "海水"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-hamanako",
    title: "浜名湖ボートレース場攻略ガイド - 全国最大級の広さを誇るコース",
    description:
      "浜名湖ボートレース場の特徴と攻略法。全国最大級の広さ、遠州のからっ風、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["浜名湖", "ボートレース場", "攻略", "広い水面", "汽水"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-tamagawa",
    title: "多摩川ボートレース場攻略ガイド - 静水面の淡水コース",
    description:
      "多摩川ボートレース場の特徴と攻略法。静水面、淡水、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["多摩川", "ボートレース場", "攻略", "静水面", "淡水"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-heiwajima",
    title: "平和島ボートレース場攻略ガイド - 首都圏のナイター海水コース",
    description:
      "平和島ボートレース場の特徴と攻略法。首都圏のナイター場、海水、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["平和島", "ボートレース場", "攻略", "ナイター", "海水"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-edogawa",
    title: "江戸川ボートレース場攻略ガイド - 日本一の難水面、潮の影響",
    description:
      "江戸川ボートレース場の特徴と攻略法。日本一の難水面、潮の影響、龍神レーダー実績データ付き。",
    date: "2025-12-30",
    category: "場別攻略",
    tags: ["江戸川", "ボートレース場", "攻略", "難水面", "潮"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-toda",
    title: "戸田ボートレース場攻略ガイド - 日本一荒れるボートレース場",
    description:
      "戸田ボートレース場の特徴と攻略法。日本一荒れる場、1号艇勝率最低、龍神レーダー実績データ付き。",
    date: "2025-12-29",
    category: "場別攻略",
    tags: ["戸田", "ボートレース場", "攻略", "荒れる"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "venue-kiryu",
    title: "桐生ボートレース場攻略ガイド - 赤城おろしが吹く高標高コース",
    description:
      "桐生ボートレース場の特徴と攻略法。赤城おろし、標高120mの影響、龍神レーダー実績データ付き。",
    date: "2025-12-29",
    category: "場別攻略",
    tags: ["桐生", "ボートレース場", "攻略", "赤城おろし"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "weekly-report-1222-1228",
    title: "12/22-12/28週間実績レポート - 本命狙いモデルが3連単回収率100%超え",
    description:
      "2025年12月22日〜28日の7日間の実績を包み隠さず公開。本命狙いモデルが3連単回収率100.5%を達成。3モデル比較分析も実施。",
    date: "2025-12-29",
    category: "実績レポート",
    tags: [
      "実績",
      "週間レポート",
      "的中率",
      "回収率",
      "3モデル",
      "本命狙い",
      "穴狙い",
    ],
    readTime: "15分",
    featured: true,
  },
  {
    id: "how-we-measure-accuracy",
    title: "龍神レーダーの実績は本物か？計測方法と透明性を徹底解説",
    description:
      "龍神レーダーの的中率・回収率はどうやって計測しているのか？なぜ全データを公開しているのか？実績の信頼性と透明性について徹底解説します。",
    date: "2025-12-29",
    category: "データ分析",
    tags: ["実績", "的中率", "回収率", "透明性", "計測方法"],
    readTime: "12分",
    featured: true,
    image: "/images/blog/return-rate-ledger-ja.jpg",
  },
  {
    id: "why-you-lose",
    title: "ボートレースで勝てない人の5つの共通点とAI予想による解決策",
    description:
      "なぜあなたはボートレースで勝てないのか？1,899レースのデータ分析から見えてきた「負けパターン」と、AI予想を使った解決策をお伝えします。",
    date: "2025-12-19",
    category: "初心者向け",
    tags: ["ボートレース", "AI予想", "勝てない", "負けパターン"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/hitrate-paradox-ja.jpg",
  },
  {
    id: "monthly-50k-roadmap",
    title: "月5万円を目標にした資金管理とデータ活用術",
    description:
      "月5万円を目標にした場合の資金管理方法と、龍神レーダーのデータ分析を活用した舟券購入の考え方を解説します。",
    date: "2025-12-21",
    category: "戦略",
    tags: ["ボートレース", "資金管理", "月5万円", "データ活用"],
    readTime: "12分",
    featured: true,
    image: "/images/blog/roadmap-steps-ja.jpg",
  },
  {
    id: "what-pros-avoid",
    title: "プロが絶対に買わない舟券の特徴7選",
    description:
      "ボートレースで勝ち続けているプロは、何を買うかよりも何を買わないかを重視します。プロが絶対に買わない舟券の特徴7選を公開。",
    date: "2025-12-26",
    category: "上級者向け",
    tags: ["ボートレース", "プロ", "買わない", "舟券"],
    readTime: "10分",
    featured: false,
  },
  {
    id: "ai-vs-human",
    title: "AI予想vs人間予想、1ヶ月ガチ検証した結果",
    description:
      "AIが予想した舟券と人間が予想した舟券、どちらが当たるのか？2025年12月の1ヶ月間、ガチ検証を実施しました。",
    date: "2025-12-23",
    category: "データ分析",
    tags: ["AI予想", "検証", "データ", "比較"],
    readTime: "11分",
    featured: true,
    image: "/images/blog/ai-vs-human-comparison-ja.jpg",
  },
  {
    id: "bankruptcy-prevention",
    title: "ボートレースで破産する人の末路と絶対に守るべき3つのルール",
    description:
      "ボートレースで人生を壊した人を実際に見てきました。破産のリアルな事例と、絶対に守るべき3つのルールをお伝えします。",
    date: "2025-12-28",
    category: "リスク管理",
    tags: ["ボートレース", "破産", "ギャンブル依存症", "ルール"],
    readTime: "11分",
    featured: false,
  },
  {
    id: "beginner-basics",
    title: "ボートレース初心者が知るべき5つの基本",
    description:
      "ボートレースを始めたばかりの方へ。最低限知っておくべき5つの基本知識をわかりやすく解説します。",
    date: "2025-12-15",
    category: "初心者向け",
    tags: ["ボートレース", "初心者", "基本"],
    readTime: "8分",
    featured: false,
  },
  {
    id: "betting-strategy",
    title: "1万円から始める堅実な舟券購入の考え方",
    description:
      "少額から始める舟券購入の基本的な考え方。1万円を元手にした資金管理と購入戦略を解説します。",
    date: "2025-12-16",
    category: "戦略",
    tags: ["舟券", "戦略", "資金管理"],
    readTime: "9分",
    featured: false,
  },
  {
    id: "player-data-analysis",
    title: "AIが分析する選手データの見方",
    description:
      "選手のどのデータを見れば良いのか？AIが重視する選手データの見方を詳しく解説します。",
    date: "2025-12-17",
    category: "データ分析",
    tags: ["選手データ", "AI分析", "データ"],
    readTime: "10分",
    featured: false,
  },
  {
    id: "motor-performance",
    title: "モーター性能で勝率が半減する - A1級でも2連対率29%だと厳しい理由",
    description:
      "ボートレースは「選手3割、モーター7割」。2連対率40%以上が狙い目という評価基準や実際のケーススタディを使って、A1級選手でもモーターが不調だと勝てない理由を徹底解説します。",
    date: "2025-12-18",
    category: "データ分析",
    tags: ["モーター", "2連対率", "性能"],
    readTime: "10分",
    featured: false,
  },
  {
    id: "weekly-report-1210",
    title: "12/10実績レポート - 3連単回収率1343%達成",
    description:
      "2025年12月10日の1日の実績を包み隠さず公開。3連単回収率1343%という驚異的な成績を達成しました。",
    date: "2025-12-18",
    category: "実績レポート",
    tags: ["実績", "的中率", "回収率"],
    readTime: "12分",
    featured: false,
  },
  {
    id: "weekly-report-1210-1214",
    title: "12/10-12/14週間実績レポート - 週間総合回収率137.1%達成",
    description:
      "2025年12月10日〜14日の5日間の実績を包み隠さず公開。週間総合回収率137.1%、3連単回収率304%を達成しました。",
    date: "2025-12-22",
    category: "実績レポート",
    tags: ["実績", "週間レポート", "的中率", "回収率", "3連単"],
    readTime: "15分",
    featured: true,
  },
  {
    id: "weekly-report-1215-1221",
    title: "12/15-12/21週間実績レポート - 3モデル対応期間の総括",
    description:
      "2025年12月15日〜21日の7日間の実績を包み隠さず公開。3モデル（スタンダード・本命狙い・穴狙い）の比較分析も実施。穴狙いモデルで回収率185.8%を達成。",
    date: "2025-12-29",
    category: "実績レポート",
    tags: [
      "実績",
      "週間レポート",
      "的中率",
      "回収率",
      "3モデル",
      "本命狙い",
      "穴狙い",
    ],
    readTime: "18分",
    featured: true,
  },
  {
    id: "rough-race-signals",
    title: "荒れるボートレースを見極める5つのサイン - AIが1,899レースから発見",
    description:
      "「今日のレースは荒れそう」と見極められれば、舟券戦略が変わります。龍神レーダーが1,899レースを分析して発見した、荒れるレースに共通する5つのサインを公開。",
    date: "2025-12-22",
    category: "初心者向け",
    tags: ["荒れるレース", "予想", "サイン", "見分け方"],
    readTime: "10分",
    featured: true,
    image: "/images/blog/signals-probability-ja.jpg",
  },
  {
    id: "exhibition-run-guide",
    title: "展示航走は本番30分前｜見るべき3つのポイント",
    description:
      "展示航走は本番レースの約30分前に行われる公開練習。スタート展示・展示タイム・伸び足回り足の見方を解説。フライング気味の選手は本番スタート成功率が約15%低下するという龍神レーダーの分析データも公開します。",
    date: "2025-12-22",
    category: "データ分析",
    tags: ["展示航走", "展示タイム", "スタート", "モーター"],
    readTime: "11分",
    featured: false,
  },
  {
    id: "stadium-strategy-guide",
    title: "ボートレース場別攻略ガイド - 24場の特徴と狙い目",
    description:
      "ボートレース場によって勝ちパターンは全く違います。全国24場の特徴、1号艇勝率、インが強い場・弱い場を完全ガイド。",
    date: "2025-12-22",
    category: "戦略",
    tags: ["ボートレース場", "攻略", "特徴", "1号艇勝率"],
    readTime: "15分",
    featured: true,
    image: "/images/blog/venue-winrate-spectrum-ja.jpg",
  },
  {
    id: "racer-profile-page-guide",
    title:
      "選手個人ページとは？プロフィール・節目記録をまとめてチェックできる機能",
    description:
      "選手名から1タップで開ける選手個人ページの使い方を解説。生年月日・支部・登録期等のプロフィールと、通算◯勝達成等の節目の記録をまとめて確認できる機能を紹介します。",
    date: "2026-09-02",
    category: "使い方",
    tags: ["選手プロフィール", "選手ニュース", "使い方", "龍神レーダー"],
    readTime: "6分",
    featured: false,
    image: "/images/blog/racer-profile-page-guide.jpg",
  },
];

// Get featured posts
export const getFeaturedPosts = () => blogPosts.filter((post) => post.featured);

// Get posts by category
export const getPostsByCategory = (category) =>
  blogPosts.filter((post) => post.category === category);

// Get post by ID
export const getPostById = (id) => blogPosts.find((post) => post.id === id);

// Get latest posts
export const getLatestPosts = (limit = 5) =>
  [...blogPosts]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

// タグ重複度→日付降順で候補記事をランク付けする共通ロジック
// （getRelatedPosts/getRelatedPostsEn で共有。タイブレーク条件の変更漏れを防ぐ）
function rankRelatedPosts(currentPost, candidates, limit) {
  return candidates
    .map((post) => ({
      post,
      sharedTags: post.tags.filter((tag) => currentPost.tags.includes(tag))
        .length,
    }))
    .sort((a, b) => {
      if (b.sharedTags !== a.sharedTags) return b.sharedTags - a.sharedTags;
      return new Date(b.post.date) - new Date(a.post.date);
    })
    .slice(0, limit)
    .map(({ post }) => post);
}

// Get related posts by shared tags (falls back to latest when no tag overlap exists)
export const getRelatedPosts = (postId, limit = 3) => {
  const currentPost = getPostById(postId);
  if (!currentPost) return getLatestPosts(limit);

  const candidates = blogPosts.filter((post) => post.id !== postId);
  return rankRelatedPosts(currentPost, candidates, limit);
};

// 指定言語版の記事が存在するか（BLOG_LANG_CONFIGに未登録の言語コードはfalse）
export const isBlogLangAvailable = (id, lang) =>
  BLOG_LANG_CONFIG[lang]?.isAvailable(id) ?? false;

// 指定言語版のメタデータ上書き分を取得
export const getBlogOverride = (id, lang) =>
  BLOG_LANG_CONFIG[lang]?.getOverride(id);

// 指定言語版のMarkdownファイル名サフィックス（例: en → "-en"）
export const getBlogMdSuffix = (lang) => BLOG_LANG_CONFIG[lang]?.mdSuffix ?? "";

// 同じ言語版が存在する記事同士でのみ関連記事を返す（未翻訳記事へのリンクを避けるため）
// タグの重複度計算は日本語版タグを使用（翻訳版タグは表示専用の翻訳ラベルのため）
export const getRelatedPostsForLang = (postId, lang, limit = 3) => {
  const currentPost = getPostById(postId);
  const config = BLOG_LANG_CONFIG[lang];
  if (!currentPost || !config) return [];

  const availableIds = new Set(config.posts.map((post) => post.id));
  const candidates = blogPosts.filter(
    (post) => post.id !== postId && availableIds.has(post.id),
  );
  return rankRelatedPosts(currentPost, candidates, limit).map((post) => ({
    ...post,
    ...config.getOverride(post.id),
  }));
};
