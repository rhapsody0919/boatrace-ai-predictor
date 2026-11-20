import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./HowToUse.css";
import {
  HowToStepTabDeepDiveContent,
  HowToStepTenkaiInKuzureContent,
  HowToStepResultsCheckContent,
} from "./HowToUseSteps.jsx";

const TITLE = "使い方ガイド | 龍神レーダー - 初心者でもわかる利用方法";
const DESCRIPTION =
  "龍神レーダーの使い方を6つのステップで解説。レース場の選び方、データ出走表の見方、レース詳細のタブ（基本情報・AI予想・今節・直前情報ほか）の使い分けまで、初心者にもわかりやすく説明します。";

function HowToStepVenueSelectContent() {
  return (
    <>
      <p>
        <strong>トップページ</strong>にアクセスすると、
        <strong>全24場のレース場カード</strong>
        が一覧で並びます。本日開催中の場には次のレースの発走時刻が表示され、開催のない場は「本日開催なし」と表示されます。
      </p>
      <div className="step-detail">
        <h4>💡 レース場の選び方</h4>
        <ul>
          <li>
            <strong>気になるレース場のカードをタップ</strong>
            すると、その場のレース一覧に移動します
          </li>
          <li>全24場（桐生、戸田、江戸川、平和島...など）に対応</li>
          <li>
            カードには<strong>グレード（G1・G3など）</strong>・
            <strong>ナイター/ミッドナイトのアイコン</strong>・
            <strong>準優勝戦・優勝戦の表示</strong>
            が出るので、節の進み具合もここで分かります
          </li>
        </ul>
      </div>
      <div className="example-box">
        <p className="example-title">📌 例</p>
        <p>「今日は平和島で舟券を買いたい」→ 「平和島」のカードをタップ</p>
      </div>
    </>
  );
}

function HowToStepRacePickContent() {
  return (
    <>
      <p>
        レース場を選ぶと、<strong>その日のレース一覧</strong>
        が表示されます。
      </p>
      <div className="step-detail">
        <h4>💡 レースの見方</h4>
        <ul>
          <li>
            各レースには<strong>レース番号</strong>と
            <strong>締切予定時刻</strong>が表示されます
          </li>
          <li>
            <strong>イン崩れ指数</strong>
            バッジで、1号艇（インコース）が崩れやすいレースかどうかがわかります
            <ul>
              <li>
                🎯 <strong>本命有利</strong>:
                1号艇が有利で堅く決まりやすいレース
              </li>
              <li>
                （バッジなし）<strong>標準</strong>: 平均的な傾向のレース
              </li>
              <li>
                🌪️ <strong>イン崩れ注意（高）</strong>:
                1号艇が崩れて波乱が起きやすいレース
              </li>
            </ul>
          </li>
          <li>
            各レースのカードには
            <strong>6艇の勝率・当地勝率・モーター2連率</strong>
            の要約も出るので、一覧のまま当たりを付けられます
          </li>
          <li>
            <strong>「詳細を見る」</strong>ボタンをタップ
          </li>
        </ul>
      </div>
      <div className="example-box">
        <p className="example-title">📌 例</p>
        <p>「平和島 10R（14:30締切）🎯本命有利」→「詳細を見る」をタップ</p>
      </div>
    </>
  );
}

function HowToStepDataTableContent() {
  return (
    <>
      <p>
        発走前のレースを選ぶと、まず
        <strong>データ出走表</strong>
        （出走6選手×客観的なデータの一覧表）が表示されます（結果が確定したレースでは「結果」タブが開くため表示されません）。龍神レーダーは
        <strong>「予想モデルを選ぶ」機能は提供していません</strong>
        。誰が見ても同じ客観的なデータをもとに、自分で予想を組み立てる形です。
      </p>
      <div className="step-detail">
        <h4>💡 データ出走表に含まれる指標</h4>
        <ul>
          <li>
            <strong>級別・全国勝率</strong>: 選手の実力の目安
          </li>
          <li>
            <strong>モーター2連率</strong>: 使用モーターの調子
          </li>
          <li>
            <strong>調子（勝率Δ）</strong>: 最近の勝率の上昇/下降
          </li>
          <li>
            <strong>ST安定度・展示タイム</strong>: スタートの正確さ・機力
          </li>
          <li>
            <strong>決まり手型</strong>: その選手が得意な勝ちパターン
          </li>
          <li>
            <strong>単勝回収率</strong>: 過去にその艇番で走った際の回収率
          </li>
        </ul>
      </div>
      <div className="tip-box">
        <h4>📝 見方のコツ</h4>
        <p>
          各指標は<strong>レース内での相対順位</strong>
          で色分けされています。最も良い数値のマスがハイライトされるので、6艇を比較しながら注目艇を見つけられます。
        </p>
      </div>
    </>
  );
}

function HowToStructuredData({ steps }) {
  return (
    <>
      {/* HowTo Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "龍神レーダー（AIボートレース分析サービス）の使い方",
          description: "龍神レーダーの使い方を6つのステップで解説",
          step: steps.map((step, index) => ({
            "@type": "HowToStep",
            position: index + 1,
            name: step.title,
            text: step.title,
          })),
        })}
      </script>

      {/* BreadcrumbList */}
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
              name: "使い方ガイド",
              item: "https://www.boat-ai.jp/how-to-use",
            },
          ],
        })}
      </script>
    </>
  );
}

function HowToStepsNavigation({ steps, activeStep, setActiveStep }) {
  return (
    <>
      {/* ステップナビゲーション */}
      <div className="steps-navigation">
        {steps.map((step, index) => (
          <button
            key={index}
            className={`step-nav-btn ${activeStep === index ? "active" : ""} ${activeStep > index ? "completed" : ""}`}
            onClick={() => setActiveStep(index)}
          >
            <span className="step-icon">{step.icon}</span>
            <span className="step-number">Step {index + 1}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function HowToStepBody({ step }) {
  return (
    <>
      {/* ステップコンテンツ */}
      <div className="step-content">
        <div className="step-header">
          <span className="step-icon-large">{step.icon}</span>
          <h2>{step.title}</h2>
        </div>
        <div className="step-body">{step.content}</div>
      </div>
    </>
  );
}

function HowToStepButtons({ activeStep, stepCount, setActiveStep, navigate }) {
  return (
    <>
      {/* ナビゲーションボタン */}
      <div className="step-navigation-buttons">
        {activeStep > 0 && (
          <button
            onClick={() => setActiveStep(activeStep - 1)}
            className="nav-button prev"
          >
            ← 前のステップ
          </button>
        )}
        {activeStep < stepCount - 1 ? (
          <button
            onClick={() => setActiveStep(activeStep + 1)}
            className="nav-button next"
          >
            次のステップ →
          </button>
        ) : (
          <button onClick={() => navigate("/")} className="nav-button finish">
            データ分析を見る 🚀
          </button>
        )}
      </div>
    </>
  );
}

function HowToFaqLink({ navigate }) {
  return (
    <>
      {/* よくある質問へのリンク */}
      <div className="faq-link-section">
        <h3>💡 もっと詳しく知りたい方へ</h3>
        <p>よくある質問もご覧ください</p>
        <button onClick={() => navigate("/faq")} className="faq-button">
          FAQ（よくある質問）
        </button>
      </div>
    </>
  );
}

export default function HowToUse() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.boat-ai.jp/how-to-use",
    keywords:
      "龍神レーダー使い方,ボートレース分析方法,初心者ガイド,データ出走表,展開予測,イン崩れ指数,レース詳細タブ,今節,ST考察",
  });

  const steps = [
    {
      title: "ステップ1: レース場を選ぶ",
      icon: "🏟️",
      content: <HowToStepVenueSelectContent />,
    },
    {
      title: "ステップ2: 予想を見たいレースを選ぶ",
      icon: "🏁",
      content: <HowToStepRacePickContent />,
    },
    {
      title: "ステップ3: データ出走表を見る",
      icon: "📋",
      content: <HowToStepDataTableContent />,
    },
    {
      title: "ステップ4: タブを切り替えて深掘りする",
      icon: "🗂️",
      content: <HowToStepTabDeepDiveContent />,
    },
    {
      title: "ステップ5: 展開予測とイン崩れ指数を見る",
      icon: "🌊",
      content: <HowToStepTenkaiInKuzureContent />,
    },
    {
      title: "ステップ6: 予測実績を確認する",
      icon: "📈",
      content: <HowToStepResultsCheckContent />,
    },
  ];

  return (
    <>
    <title>{TITLE}</title>
    <meta name="description" content={DESCRIPTION} />
    <link rel="canonical" href="https://www.boat-ai.jp/how-to-use" />

    <HowToStructuredData steps={steps} />

    <Header />

    <div className="how-to-use-container">
      <div className="how-to-use-header">
        <h1>📚 使い方ガイド</h1>
        <p>龍神レーダーの使い方を初心者にもわかりやすく解説</p>
      </div>

      <HowToStepsNavigation
        steps={steps}
        activeStep={activeStep}
        setActiveStep={setActiveStep}
      />

      <HowToStepBody step={steps[activeStep]} />

      <HowToStepButtons
        activeStep={activeStep}
        stepCount={steps.length}
        setActiveStep={setActiveStep}
        navigate={navigate}
      />

      <HowToFaqLink navigate={navigate} />

    </div>
    </>
  );
}
