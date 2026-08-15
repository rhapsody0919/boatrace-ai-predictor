import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./HowToUse.css";

const TITLE = "使い方ガイド | BoatAI - 初心者でもわかる利用方法";
const DESCRIPTION =
  "BoatAIの使い方を5つのステップで解説。レース場の選び方、データ出走表・展開予測・イン崩れ指数の見方まで、初心者にもわかりやすく説明します。";

export default function HowToUse() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.boat-ai.jp/how-to-use",
    keywords:
      "BoatAI使い方,ボートレース分析方法,初心者ガイド,データ出走表,展開予測,イン崩れ指数",
  });

  const steps = [
    {
      title: "ステップ1: レース場を選ぶ",
      icon: "🏟️",
      content: (
        <>
          <p>
            <strong>トップページ</strong>にアクセスすると、
            <strong>「今日のレース」</strong>
            タブに、本日開催中のレース場が表示されます。
          </p>
          <div className="step-detail">
            <h4>💡 レース場の選び方</h4>
            <ul>
              <li>
                <strong>ドロップダウンメニュー</strong>
                から、気になるレース場を選択
              </li>
              <li>全24場（桐生、戸田、江戸川、平和島...など）に対応</li>
              <li>
                迷ったら、<strong>最初に表示されているレース場</strong>
                から始めましょう
              </li>
            </ul>
          </div>
          <div className="example-box">
            <p className="example-title">📌 例</p>
            <p>
              「今日は平和島で舟券を買いたい」→
              ドロップダウンから「平和島」を選択
            </p>
          </div>
        </>
      ),
    },
    {
      title: "ステップ2: 予想を見たいレースを選ぶ",
      icon: "🏁",
      content: (
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
                    🌪️ <strong>イン崩れ確率高</strong>:
                    1号艇が崩れて波乱が起きやすいレース
                  </li>
                </ul>
              </li>
              <li>
                <strong>「データ分析を見る」</strong>ボタンをクリック
              </li>
            </ul>
          </div>
          <div className="example-box">
            <p className="example-title">📌 例</p>
            <p>
              「平和島
              10R（14:30締切）🎯本命有利」→「データ分析を見る」をクリック
            </p>
          </div>
        </>
      ),
    },
    {
      title: "ステップ3: データ出走表を見る",
      icon: "📋",
      content: (
        <>
          <p>
            レースを選ぶと、まず
            <strong>データ出走表</strong>
            （出走6選手×客観的なデータの一覧表）が表示されます。BoatAIは
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
      ),
    },
    {
      title: "ステップ4: 展開予測とイン崩れ指数を見る",
      icon: "🌊",
      content: (
        <>
          <p>
            データ出走表の下にある
            <strong>「AIデータ分析」</strong>
            （折りたたみ表示）を開くと、AIによる2種類の分析結果が確認できます。
          </p>
          <div className="step-detail">
            <h4>💡 展開予測</h4>
            <ul>
              <li>
                1マーク（最初のターン）で
                <strong>どの艇が先頭になりそうか</strong>
                を、確率付きの上位パターンとして提示します
              </li>
              <li>
                実測的中率は
                <strong>約8割</strong>
                （上位パターンのいずれかが実際の1着コースと一致すれば的中）。会場によって的中率に差があり、実績は「成績」ページで確認できます
              </li>
            </ul>
          </div>
          <div className="step-detail">
            <h4>💡 イン崩れ指数</h4>
            <ul>
              <li>
                1号艇（インコース）が
                <strong>崩れやすいかどうか</strong>
                を、過去90日・同会場のレースと比較した相対的な指数（パーセンタイル）で示します
              </li>
              <li>
                「イン崩れ確率高」ラベルのレースは、実際にどの程度崩れているかの実測値も確認できます
              </li>
            </ul>
          </div>
          <div className="example-box">
            <p className="example-title">📌 例</p>
            <p>
              展開予測で「1コースが39%で先頭」「3コースが10%で先頭」と出ていれば、1コースを軸にしつつ3コースも警戒する、といった読み方ができます
            </p>
          </div>
        </>
      ),
    },
    {
      title: "ステップ5: 予測実績を確認する",
      icon: "📈",
      content: (
        <>
          <p>レース終了後、AIの分析が的中だったかを確認できます。</p>
          <div className="step-detail">
            <h4>💡 実績の確認方法</h4>
            <ul>
              <li>
                <strong>各レースの「レース結果」パネル</strong>:
                そのレースの展開予測が的中したかを表示
              </li>
              <li>
                <strong>「的中」タブ</strong>（/hit-races）:
                過去14日間で展開予測が的中したレース一覧を会場別に表示
              </li>
              <li>
                <strong>「成績」タブ</strong>（/accuracy）:
                展開予測の実測的中率を、全体・会場別で公開
              </li>
            </ul>
          </div>
          <div className="tip-box">
            <h4>📊 実績の見方</h4>
            <p>
              展開予測の実測的中率は
              <strong>会場によって差があります</strong>
              （例:
              ある会場は9割超、別の会場は7割弱）。よく使う会場の実績を「成績」ページで確認してから活用すると、精度への理解が深まります。
            </p>
          </div>
          <div className="step-detail">
            <h4>⚠️ 重要な注意事項</h4>
            <div className="warning-box">
              <p>
                <strong>BoatAIは分析情報のみを提供しています</strong>
              </p>
              <p>
                舟券の購入は
                <a
                  href="https://www.boatrace.jp/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  公式サイト
                </a>
                でご確認ください。分析データは参考情報としてご活用ください。
              </p>
            </div>
          </div>
        </>
      ),
    },
  ];

  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
      <link rel="canonical" href="https://www.boat-ai.jp/how-to-use" />

      {/* HowTo Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "BoatAI（AIボートレース分析サービス）の使い方",
          description: "BoatAIの使い方を5つのステップで解説",
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

      <Header />

      <div className="how-to-use-container">
        <div className="how-to-use-header">
          <h1>📚 使い方ガイド</h1>
          <p>BoatAIの使い方を初心者にもわかりやすく解説</p>
        </div>

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

        {/* ステップコンテンツ */}
        <div className="step-content">
          <div className="step-header">
            <span className="step-icon-large">{steps[activeStep].icon}</span>
            <h2>{steps[activeStep].title}</h2>
          </div>
          <div className="step-body">{steps[activeStep].content}</div>
        </div>

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
          {activeStep < steps.length - 1 ? (
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

        {/* よくある質問へのリンク */}
        <div className="faq-link-section">
          <h3>💡 もっと詳しく知りたい方へ</h3>
          <p>よくある質問もご覧ください</p>
          <button onClick={() => navigate("/faq")} className="faq-button">
            FAQ（よくある質問）
          </button>
        </div>
      </div>
    </>
  );
}
