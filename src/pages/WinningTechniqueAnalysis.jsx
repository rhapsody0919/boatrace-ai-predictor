import { useState } from "react";
import Header from "../components/Header";
import {
  WinningTechniqueChart,
  MotorConditionChart,
} from "../components/analysis";
import "./OutcomeDistribution.css";
import "./WinningTechniqueAnalysis.css";

function WinningTechniqueAnalysis() {
  const [activeTab, setActiveTab] = useState("technique");

  return (
    <div className="outcome-distribution-page">
      <>
        <title>決まり手データ分析 - BoatAI</title>
        <meta
          name="description"
          content="ボートレース場別・枠番別の決まり手（逃げ・差し・まくり等）出現割合を過去90日のデータから分析。各ボートレース場の傾向を詳しく解説します。"
        />
        <link rel="canonical" href="https://www.boat-ai.jp/winning-technique" />
      </>

      <Header />

      <main className="content">
        <div className="container">
          <div className="page-header">
            <h1>🎯 決まり手データ分析</h1>
            <p className="page-subtitle">
              ボートレース場ごとの決まり手傾向から、買い目選定・除外判断の参考データを提供します
            </p>
          </div>

          <div className="analysis-tabs">
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
          </div>

          {activeTab === "technique" ? (
            <WinningTechniqueChart />
          ) : (
            <MotorConditionChart />
          )}

          <section className="info-section">
            {activeTab === "technique" ? (
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
            ) : (
              <>
                <h2>モーター調子トレンドについて</h2>

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
