import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import Header from "../components/Header";
import {
  WinningTechniqueChart,
  MotorConditionChart,
  RacerFormChart,
  OutcomeDistributionTable,
  StPredictabilityChart,
  TopStartChart,
  LosingTechniqueChart,
  NigeOutcomeChart,
  ExhibitionTimeTopChart,
  ExhibitionTimeTrendChart,
  RacerTechniqueProfileChart,
  RacerFormRankingChart,
  RacerBoatReturnRateChart,
} from "../components/analysis";
import "./OutcomeDistribution.css";
import "./WinningTechniqueAnalysis.css";

const ANALYSIS_FEATURES = [
  {
    name: "出目分布",
    description: "1着コース別に2着・3着の出現パターンを分析",
  },
  {
    name: "決まり手データ分析",
    description:
      "会場・枠番ごとの決まり手（逃げ・差し・まくり等）の勝ちパターンを分析",
  },
  {
    name: "モーター調子",
    description: "本日開催中のレースの枠番別モーター2連率・3連率を分析",
  },
  {
    name: "選手調子",
    description: "出走選手の全国勝率が直近90日でどう変化しているかを分析",
  },
  {
    name: "展示ST/本番STのズレ",
    description: "選手ごとに展示STと本番STがどれだけ一致してきたかを分析",
  },
  {
    name: "枠番別トップスタート",
    description:
      "会場・枠番ごとの最速スタート率と、最速スタート時の1着率を分析",
  },
  {
    name: "負け決まり手データ分析",
    description:
      "1着を逃した際、勝者がどの決まり手で勝っているかを枠番別に分析",
  },
  {
    name: "逃げ成功時の複勝分布",
    description: "逃げで1着が決まったレースに絞って2着・3着のパターンを分析",
  },
  {
    name: "展示タイム最速艇の1着転換率",
    description: "会場・枠番ごとに展示タイム最速率と、最速時の1着率を分析",
  },
  {
    name: "選手別展示タイム推移",
    description:
      "選手ごとの展示タイム（周回タイム）が過去90日でどう推移しているかを分析",
  },
  {
    name: "選手別決まり手傾向",
    description:
      "出走選手ごとに、過去90日間で勝った時にどの決まり手で勝っているかを分析",
  },
  {
    name: "本日の好調・不調選手ランキング",
    description:
      "本日出走する全選手を対象に、全国勝率の変化量で急上昇/急下降選手をランキング",
  },
  {
    name: "選手×艇番別 回収率分析",
    description:
      "出走選手ごとに、過去180日間・同じ艇番で出走した際の単勝・複勝回収率を分析",
  },
];

function WinningTechniqueAnalysis() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const venueCodeParam = params.get("venue_code");
  const initialVenueCode = venueCodeParam ? parseInt(venueCodeParam, 10) : null;
  const initialRaceId = params.get("race_id");
  const initialTab = params.get("tab");

  const [activeTab, setActiveTab] = useState(
    [
      "technique",
      "motor",
      "racer",
      "outcome",
      "st",
      "topstart",
      "losing",
      "nige",
      "extime",
      "extrend",
      "techprofile",
      "formranking",
      "returnrate",
    ].includes(initialTab)
      ? initialTab
      : "technique",
  );

  return (
    <div className="outcome-distribution-page">
      <>
        <title>データ分析ツール - BoatAI</title>
        <meta
          name="description"
          content="出目分布・決まり手データ分析・モーター調子・選手調子・展示ST/本番STのズレ・枠番別トップスタート分析・負け決まり手分析・逃げ成功時の複勝分布・展示タイム最速艇の1着転換率・選手別展示タイム推移・選手別決まり手傾向・本日の好調不調選手ランキング・選手×艇番別回収率分析の13の分析機能で、会場・レースごとの傾向を確認できます。AIの予想を裏付ける根拠として活用できます。"
        />
        <link rel="canonical" href="https://www.boat-ai.jp/winning-technique" />

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "データ分析ツール",
            description: "会場・レースごとの傾向を確認できる13の分析機能",
            itemListElement: ANALYSIS_FEATURES.map((feature, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: feature.name,
              description: feature.description,
            })),
          })}
        </script>

        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "ホーム",
                item: "https://www.boat-ai.jp/",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "データ分析ツール",
                item: "https://www.boat-ai.jp/winning-technique",
              },
            ],
          })}
        </script>
      </>

      <Header />

      <main className="content">
        <div className="container">
          <div className="page-header">
            <h1>📊 データ分析ツール</h1>
            <p className="page-subtitle">
              出目分布・決まり手・モーター調子・選手調子・展示ST/本番STのズレ・枠番別トップスタート・負け決まり手・逃げ成功時の複勝分布・展示タイム最速艇の1着転換率・選手別展示タイム推移・選手別決まり手傾向・本日の好調不調選手ランキング・選手×艇番別回収率分析の傾向から、買い目選定・除外判断の参考データを提供します
            </p>
          </div>

          <div className="analysis-tabs">
            <button
              className={`analysis-tab-btn ${activeTab === "outcome" ? "active" : ""}`}
              onClick={() => setActiveTab("outcome")}
            >
              📊 出目分布
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "technique" ? "active" : ""}`}
              onClick={() => setActiveTab("technique")}
            >
              🎯 決まり手
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "motor" ? "active" : ""}`}
              onClick={() => setActiveTab("motor")}
            >
              🔧 モーター調子
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "racer" ? "active" : ""}`}
              onClick={() => setActiveTab("racer")}
            >
              📈 選手調子
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "st" ? "active" : ""}`}
              onClick={() => setActiveTab("st")}
            >
              ⏱️ STのズレ
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "topstart" ? "active" : ""}`}
              onClick={() => setActiveTab("topstart")}
            >
              🚀 トップスタート
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "losing" ? "active" : ""}`}
              onClick={() => setActiveTab("losing")}
            >
              💔 負け決まり手
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "nige" ? "active" : ""}`}
              onClick={() => setActiveTab("nige")}
            >
              🏃 逃げ成功時分布
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "extime" ? "active" : ""}`}
              onClick={() => setActiveTab("extime")}
            >
              ⏲️ 展示タイム
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "extrend" ? "active" : ""}`}
              onClick={() => setActiveTab("extrend")}
            >
              📈 展示タイム推移
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "techprofile" ? "active" : ""}`}
              onClick={() => setActiveTab("techprofile")}
            >
              🏆 選手別決まり手傾向
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "formranking" ? "active" : ""}`}
              onClick={() => setActiveTab("formranking")}
            >
              🔥 好調・不調選手ランキング
            </button>
            <button
              className={`analysis-tab-btn ${activeTab === "returnrate" ? "active" : ""}`}
              onClick={() => setActiveTab("returnrate")}
            >
              💰 回収率分析
            </button>
          </div>

          {activeTab === "outcome" && (
            <OutcomeDistributionTable
              initialVenueCode={
                initialVenueCode !== null
                  ? String(initialVenueCode).padStart(2, "0")
                  : null
              }
            />
          )}
          {activeTab === "technique" && (
            <WinningTechniqueChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "motor" && (
            <MotorConditionChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "racer" && (
            <RacerFormChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "st" && (
            <StPredictabilityChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "topstart" && (
            <TopStartChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "losing" && (
            <LosingTechniqueChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "nige" && (
            <NigeOutcomeChart
              initialVenueCode={
                initialVenueCode !== null
                  ? String(initialVenueCode).padStart(2, "0")
                  : null
              }
            />
          )}
          {activeTab === "extime" && (
            <ExhibitionTimeTopChart initialVenueCode={initialVenueCode} />
          )}
          {activeTab === "extrend" && (
            <ExhibitionTimeTrendChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "techprofile" && (
            <RacerTechniqueProfileChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}
          {activeTab === "formranking" && <RacerFormRankingChart />}
          {activeTab === "returnrate" && (
            <RacerBoatReturnRateChart
              initialVenueCode={initialVenueCode}
              initialRaceId={initialRaceId}
            />
          )}

          <section className="info-section">
            {activeTab === "outcome" && (
              <>
                <h2>出目分布分析について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果を集計し、各ボートレース場で「1着が1コースの時、2着と3着がどの組み合わせで出やすいか」を統計的に分析しています。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>出現率が高い</strong> =
                      その組み合わせが実際によく出ている
                    </li>
                    <li>
                      <strong>配当が低い</strong> =
                      予想が集中しやすい（多くの人が買っている）
                    </li>
                    <li>
                      <strong>配当が高い</strong>=
                      穴目だが出現率は低い（的中しづらい傾向）
                    </li>
                    <li>
                      各ボートレース場ごとに特性が異なるため、会場選択で出現率が大きく変わります
                    </li>
                  </ul>
                </div>
              </>
            )}
            {activeTab === "technique" && (
              <>
                <h2>決まり手データ分析について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果を集計し、各ボートレース場で「1着艇（枠番）がどの決まり手で勝っているか」を統計的に分析しています。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>逃げの割合が高い枠番</strong> =
                      イン逃げが決まりやすい水面・会場
                    </li>
                    <li>
                      <strong>まくり・まくり差しの割合が高い枠番</strong> =
                      外枠が決まりやすい、荒れやすい傾向
                    </li>
                    <li>
                      各ボートレース場ごとに特性が異なるため、会場選択で傾向が大きく変わります
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/winning-technique-analysis-guide">
                      決まり手データ分析とは？会場・枠番別の勝ちパターンを見る新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "motor" && (
              <>
                <h2>モーター調子について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    モーターの2連率・3連率は節（開催）単位で更新されます。同じモーターの成績が節をまたいでどう変化しているかを見ることで、「上げ調子」「下げ調子」を判断する材料になります。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>2連率・3連率が上昇傾向</strong> =
                      整備・部品交換等で調子が上がっている可能性
                    </li>
                    <li>
                      <strong>下降傾向</strong> =
                      調子を崩している、当該レースでの信頼度がやや下がる可能性
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/motor-condition-guide">
                      モーター調子とは？本日のレースの枠番別2連率がわかる新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "racer" && (
              <>
                <h2>選手調子について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    選手の全国勝率は期（開催）単位で更新されます。現在の勝率と約90日前時点の勝率を比較することで、選手の調子が上昇/下降しているかを判断する材料になります。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>勝率が上昇傾向の選手</strong> =
                      調子が上向いている可能性
                    </li>
                    <li>
                      <strong>下降傾向の選手</strong> =
                      実力があっても信頼度をやや下げて考える材料になる
                    </li>
                    <li>
                      表の行をクリックすると、その選手の節ごとの全国勝率・当地勝率の推移グラフにドリルダウンできます
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/racer-form-guide">
                      選手調子とは？全国勝率の変化から「今が旬」の選手を見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "st" && (
              <>
                <h2>展示ST/本番STのズレについて</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    スタート展示（展示ST）とレース本番（本番ST）のスタートタイミングがどれくらいズレるかを、選手ごとの過去実績から算出しています。ズレが小さいほど、展示STが本番の参考になる「安定」した選手です。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>ズレが小さい選手</strong> =
                      展示STがそのまま本番の目安になりやすい
                    </li>
                    <li>
                      <strong>ズレが大きい選手</strong> =
                      展示が良くても本番で崩れる可能性があり、信頼度をやや下げて考える材料になる
                    </li>
                    <li>
                      表の行をクリックすると、その選手の過去レースごとのズレ推移が見られます
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/st-timing-gap-guide">
                      展示ST/本番STのズレとは？「展示は速いのに本番で出遅れる」選手を見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "topstart" && (
              <>
                <h2>枠番別トップスタート分析について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果から、各ボートレース場で「どの枠番が最速でスタートを切りやすいか（トップスタート率）」「最速スタート時に実際に1着になれているか（トップスタート時の1着率）」を枠番別に分析しています。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>トップスタート率は高いが1着率が低い枠番</strong> =
                      先に出るだけで勝ちきれない傾向がある可能性
                    </li>
                    <li>
                      <strong>トップスタート時の1着率が高い枠番</strong> =
                      速いスタートをそのまま勝利につなげやすい
                    </li>
                    <li>
                      各ボートレース場ごとに特性が異なるため、会場選択で傾向が大きく変わります
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/top-start-guide">
                      枠番別トップスタート分析とは？「先に出るだけ」の枠番を見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "losing" && (
              <>
                <h2>負け決まり手データ分析について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果から、各ボートレース場で「1着を逃した際、勝者がどの決まり手（逃げ・差し・まくり等）で勝っているか」を枠番別に分析しています。決まり手データ分析（勝ち方）の裏返しで、負け方の傾向がわかります。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>差されて負ける割合が高い枠番</strong> =
                      内側から差されやすい、粘りが弱い傾向
                    </li>
                    <li>
                      <strong>まくられて負ける割合が高い枠番</strong> =
                      外側からの追い上げに弱い傾向
                    </li>
                    <li>
                      1号艇がどの決まり手で負けやすいかを見ることで、逃げが決まらなかった場合の展開を予測する材料になります
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/losing-technique-guide">
                      負け決まり手データ分析とは？「負け方」から会場・枠番の弱点を見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "nige" && (
              <>
                <h2>逃げ成功時の複勝分布について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果から、「逃げ（先頭独走）」で1着になったレースだけに絞って、2着・3着の出現パターンを分析しています。出目分布（決まり手を問わない全体集計）とは異なり、逃げ切りが決まった場合に限定した傾向がわかります。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      1号艇が逃げた場合に2着・3着になりやすい艇の組み合わせを把握できる
                    </li>
                    <li>
                      1号艇以外（2〜6コース）が逃げるケースは件数が少なく、荒れたレースの参考になる
                    </li>
                    <li>
                      決まり手を問わない出目分布と比較することで、逃げ特有の傾向を切り分けられます
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/nige-outcome-guide">
                      逃げ成功時の複勝分布とは？「イン逃げが決まった後」の買い目を絞り込む新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "extime" && (
              <>
                <h2>展示タイム最速艇の1着転換率について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    過去90日間のレース結果から、各ボートレース場で「どの枠番が展示タイム（周回タイム）で最速になりやすいか」「展示タイム最速時に実際に1着になれているか」を枠番別に分析しています。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>展示タイム最速率は高いが1着率が低い枠番</strong> =
                      展示は速いが本番で勝ちきれない傾向がある可能性
                    </li>
                    <li>
                      <strong>最速時の1着率が高い枠番</strong> =
                      展示の速さをそのまま勝利につなげやすい
                    </li>
                    <li>
                      展示ST/本番STのズレ分析と組み合わせることで、展示の信頼度を多角的に判断できます
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/exhibition-time-top-guide">
                      展示タイム最速艇の1着転換率とは？「展示が速い艇」の信頼度を見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "extrend" && (
              <>
                <h2>選手別展示タイム推移について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    出走選手ごとに、展示タイム（周回タイム）が過去90日間でどう推移しているかを表示しています。「展示タイム最速艇の1着転換率」（会場・枠番単位）とは異なり、選手個人のコンディションを見る機能です。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>展示タイムが継続的に悪化している選手</strong> =
                      調子を崩している可能性があり、信頼度をやや下げて考える材料になる
                    </li>
                    <li>
                      <strong>展示タイムが安定・改善傾向の選手</strong> =
                      モーター・体調ともに好調である可能性
                    </li>
                    <li>
                      表の行をクリックすると、その選手の展示タイム推移グラフにドリルダウンできます
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/exhibition-time-trend-guide">
                      選手別展示タイム推移とは？調子の波を展示タイムから読み解く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "techprofile" && (
              <>
                <h2>選手別決まり手傾向について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    出走選手ごとに、過去90日間で勝った時にどの決まり手（逃げ・差し・まくり等）で勝っているかを構成比で表示しています。会場・枠番単位の「決まり手」タブとは異なり、選手個人の勝ちパターンを見る機能です。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>逃げの割合が高い選手</strong> =
                      先行して逃げ切るタイプ。イン枠で強みが出やすい
                    </li>
                    <li>
                      <strong>まくり・まくり差しの割合が高い選手</strong> =
                      外枠からでも勝ち切る力がある選手
                    </li>
                    <li>
                      勝利数が少ない選手は、決まり手構成の信頼度が低くなる点に注意してください
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/racer-technique-profile-guide">
                      選手別決まり手傾向とは？選手の勝ちパターンを見抜く新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "formranking" && (
              <>
                <h2>本日の好調・不調選手ランキングについて</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率を比較し、変化量（delta）が大きい上位10名を「急上昇」「急下降」の2つのランキングで表示しています。他のタブと異なり、会場・レースを選ばずに本日のカード全体から注目選手を発見できる機能です。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>急上昇選手</strong> =
                      直近好調な選手。狙い目の根拠として活用できる
                    </li>
                    <li>
                      <strong>急下降選手</strong> =
                      直近不調な選手。除外判断の根拠として活用できる
                    </li>
                    <li>
                      選手名をクリックすると、その選手が出走する本日のレースの「選手調子」タブで詳細を確認できます
                    </li>
                    <li>
                      デビュー直後の新人選手は勝率0%からの上昇となり、急上昇ランキングに出やすい点に注意してください
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/racer-form-ranking-guide">
                      本日の好調・不調選手ランキングとは？レースを選ばず注目選手を発見する新機能
                    </Link>
                  </p>
                </div>
              </>
            )}
            {activeTab === "returnrate" && (
              <>
                <h2>選手×艇番別 回収率分析について</h2>

                <div className="info-card">
                  <h3>📈 データの見方</h3>
                  <p>
                    出走選手ごとに、過去180日間・同じ艇番で出走したレースを対象に、単勝・複勝を100円ずつ購入し続けた場合の払戻金合計の割合（回収率）を表示しています。AI予想モデルの確率は使わず、実際に払い戻された金額の実績のみを集計しています。
                  </p>
                </div>

                <div className="info-card">
                  <h3>💡 活用のポイント</h3>
                  <ul>
                    <li>
                      <strong>回収率が高い選手</strong> =
                      勝率だけでなく、実際に購入して儲かりやすい選手
                    </li>
                    <li>
                      勝率が高くても回収率が低い選手は、人気が集中しオッズが低い（妙味が薄い）可能性があります
                    </li>
                    <li>
                      サンプル数が少ない選手は、回収率の信頼度が低くなる点に注意してください
                    </li>
                  </ul>
                </div>

                <div className="info-card">
                  <h3>📖 詳しい解説記事</h3>
                  <p>
                    <Link to="/blog/racer-boat-return-rate-guide">
                      選手×艇番別回収率分析とは？勝率だけでなく儲かるかを見る新機能
                    </Link>
                  </p>
                </div>
              </>
            )}

            <div className="info-card">
              <h3>⚠️ 注意事項</h3>
              <ul>
                <li>
                  データは参考値です。単独で買い目選定の判断をしないようにご注意ください
                </li>
                <li>
                  季節変動や気象条件により、パターンが時間とともに変わることがあります
                </li>
                <li>
                  統計的な傾向であるため、今後の出現を保証するものではありません
                </li>
                <li>必ずご自身の分析・判断の上、投票をお願いいたします</li>
              </ul>
            </div>
          </section>
        </div>
      </main>

      <footer className="page-footer">
        <p>© 2025 BoatAI - ボートレース AI予想支援</p>
      </footer>
    </div>
  );
}

export default WinningTechniqueAnalysis;
