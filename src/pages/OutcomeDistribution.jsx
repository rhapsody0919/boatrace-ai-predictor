import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import Header from "../components/Header";
import { OutcomeDistributionTable } from "../components/analysis";
import "./OutcomeDistribution.css";

function OutcomeDistribution() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const initialVenueCode = params.get("venue_code");

  return (
    <div className="outcome-distribution-page">
      <Helmet>
        <title>出目分布分析 - BoatAI</title>
        <meta
          name="description"
          content="ボートレース場別の3連単出現パターンを過去90日のデータから分析。各ボートレース場の傾向を詳しく解説します。"
        />
      </Helmet>

      <Header />

      <main className="content">
        <div className="container">
          <div className="page-header">
            <h1>📊 出目分布分析</h1>
            <p className="page-subtitle">
              ボートレース場ごとの3連単出現パターンから、買い目選定の参考データを提供します
            </p>
          </div>

          <OutcomeDistributionTable initialVenueCode={initialVenueCode} />

          <section className="info-section">
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

export default OutcomeDistribution;
