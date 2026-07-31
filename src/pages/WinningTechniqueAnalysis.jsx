import { useState } from "react";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import {
  WinningTechniqueChart,
  MotorConditionChart,
  RacerFormChart,
  OutcomeDistributionTable,
  StPredictabilityChart,
  TopStartChart,
} from "../components/analysis";
import "./OutcomeDistribution.css";
import "./WinningTechniqueAnalysis.css";

function WinningTechniqueAnalysis() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const venueCodeParam = params.get("venue_code");
  const initialVenueCode = venueCodeParam ? parseInt(venueCodeParam, 10) : null;
  const initialRaceId = params.get("race_id");
  const initialTab = params.get("tab");

  const [activeTab, setActiveTab] = useState(
    ["technique", "motor", "racer", "outcome", "st", "topstart"].includes(
      initialTab,
    )
      ? initialTab
      : "technique",
  );

  return (
    <div className="outcome-distribution-page">
      <>
        <title>データ分析ツール - BoatAI</title>
        <meta
          name="description"
          content="出目分布・決まり手データ分析・モーター調子・選手調子・展示ST/本番STのズレ・枠番別トップスタート分析の6つの分析機能で、会場・レースごとの傾向を確認できます。AIの予想を裏付ける根拠として活用できます。"
        />
        <link rel="canonical" href="https://www.boat-ai.jp/winning-technique" />
      </>

      <Header />

      <main className="content">
        <div className="container">
          <div className="page-header">
            <h1>📊 データ分析ツール</h1>
            <p className="page-subtitle">
              出目分布・決まり手・モーター調子・選手調子・展示ST/本番STのズレ・枠番別トップスタートの傾向から、買い目選定・除外判断の参考データを提供します
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
