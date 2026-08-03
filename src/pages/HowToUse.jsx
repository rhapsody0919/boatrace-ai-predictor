import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./HowToUse.css";

const TITLE = "使い方ガイド | BoatAI - 初心者でもわかる利用方法";
const DESCRIPTION =
  "BoatAIの使い方を6つのステップで解説。レース場の選び方、AI予測モデルの選択、予測データの活用方法まで、初心者にもわかりやすく説明します。";

export default function HowToUse() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.boat-ai.jp/how-to-use",
    keywords:
      "BoatAI使い方,ボートレース分析方法,初心者ガイド,AI予測モデル,データ分析",
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
                <strong>荒れ度</strong>
                マークで、レースの予想しやすさがわかります
                <ul>
                  <li>
                    😌 <strong>堅い</strong>: 1号艇が有利なレース（本命党向け）
                  </li>
                  <li>
                    😐 <strong>標準</strong>: バランス型のレース
                  </li>
                  <li>
                    😬 <strong>荒れる</strong>:
                    波乱が起きやすいレース（穴党向け）
                  </li>
                </ul>
              </li>
              <li>
                <strong>「AI予想を見る」</strong>ボタンをクリック
              </li>
            </ul>
          </div>
          <div className="example-box">
            <p className="example-title">📌 例</p>
            <p>
              「平和島 10R（14:30締切）荒れ度:
              😌堅い」→「AI予想を見る」をクリック
            </p>
          </div>
        </>
      ),
    },
    {
      title: "ステップ3: AI予想モデルを選ぶ",
      icon: "🤖",
      content: (
        <>
          <p>
            BoatAIでは<strong>3種類の予想モデル</strong>から選べます。
          </p>
          <div className="step-detail">
            <h4>💡 モデルの違い</h4>
            <div className="model-comparison">
              <div className="model-card standard">
                <h5>🎯 スタンダード（推奨）</h5>
                <p>
                  <strong>予測精度とパフォーマンスのバランス重視</strong>
                </p>
                <ul>
                  <li>全国勝率・当地成績・モーター性能を総合評価</li>
                  <li>迷ったらまずこれ</li>
                  <li>単勝予測精度 27%、高効率な分析</li>
                </ul>
              </div>
              <div className="model-card safe-bet">
                <h5>🛡️ 本命狙い</h5>
                <p>
                  <strong>予測精度を最重視（安全志向）</strong>
                </p>
                <ul>
                  <li>1号艇とA級選手を優先</li>
                  <li>堅いレースで力を発揮</li>
                  <li>単勝予測精度 53%（高精度）</li>
                </ul>
              </div>
              <div className="model-card upset-focus">
                <h5>💎 穴狙い</h5>
                <p>
                  <strong>高倍率予測を狙う（攻撃型）</strong>
                </p>
                <ul>
                  <li>外枠の好モーターや展開の妙を重視</li>
                  <li>荒れるレースで力を発揮</li>
                  <li>3連複回収率 333%（高配当型）</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="example-box">
            <p className="example-title">📌 例</p>
            <p>
              荒れ度が「😌堅い」なら → <strong>本命狙い</strong>モデル
            </p>
            <p>
              荒れ度が「😬荒れる」なら → <strong>穴狙い</strong>モデル
            </p>
            <p>
              迷ったら → <strong>スタンダード</strong>モデル
            </p>
          </div>
        </>
      ),
    },
    {
      title: "ステップ4: AI予想を確認する",
      icon: "📊",
      content: (
        <>
          <p>AI予想画面では、AIが分析した予想結果が表示されます。</p>
          <div className="step-detail">
            <h4>💡 予想画面の見方</h4>
            <ul>
              <li>
                <strong>展開予測アニメーション</strong>:
                1マークでの各艇の動きをシミュレーション表示
              </li>
              <li>
                <strong>超展開データ</strong>:
                各コースの攻撃力・守備力を数値化したテーブル
              </li>
              <li>
                <strong>本命</strong>: 展開予測で最も1着の可能性が高い艇
              </li>
              <li>
                <strong>推奨買い目</strong>:
                展開予測に基づく1〜3着の推奨組み合わせ
              </li>
              <li>
                <strong>AIデータ予想</strong>:
                各選手の級別、勝率、モーター性能などの詳細データ
              </li>
            </ul>
          </div>
          <div className="tip-box">
            <h4>💡 予測データの種別について</h4>
            <ul>
              <li>
                <strong>複勝</strong>: 予測精度49.5%（2着以内予測）- 初心者向け
              </li>
              <li>
                <strong>3連複</strong>:
                的中率12.8%、回収率80.6%（順不同で1-2-3着）- 中級者向け
              </li>
              <li>
                <strong>3連単</strong>: 的中率2.8%、回収率134.3%（着順一致）-
                上級者向け
              </li>
            </ul>
          </div>
        </>
      ),
    },
    {
      title: "ステップ5: 予測を活用する",
      icon: "🎫",
      content: (
        <>
          <p>AI予測データを参考に、レース展開を予測しましょう。</p>
          <div className="step-detail">
            <h4>⚠️ 重要な注意事項</h4>
            <div className="warning-box">
              <p>
                <strong>BoatAIは予測情報のみを提供しています</strong>
              </p>
              <p>
                詳細は
                <a
                  href="https://www.boatrace.jp/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  公式サイト
                </a>
                でご確認ください。
              </p>
            </div>
          </div>
          <div className="step-detail">
            <h4>💡 予測データ活用のポイント</h4>
            <ul>
              <li>
                <strong>余裕のある範囲で</strong>楽しむ
              </li>
              <li>
                AI予測は<strong>参考情報</strong>として活用する
              </li>
              <li>レース展開の分析に役立てる</li>
            </ul>
          </div>
          <div className="tip-box">
            <h4>📝 活用のヒント</h4>
            <ul>
              <li>展開予測アニメーションでレース展開をイメージ</li>
              <li>超展開データで各コースの攻防を分析</li>
              <li>モデル別の展開パターンを比較して活用する</li>
            </ul>
          </div>
        </>
      ),
    },
    {
      title: "ステップ6: 予測実績を確認する",
      icon: "📈",
      content: (
        <>
          <p>レース終了後、AIの予測が的中だったかを確認できます。</p>
          <div className="step-detail">
            <h4>💡 実績の確認方法</h4>
            <ul>
              <li>
                <strong>「的中レース」タブ</strong>:
                過去14日間の的中レースを表示
              </li>
              <li>
                <strong>「成績」タブ</strong>:
                予測精度・回収率の統計データを表示
              </li>
              <li>期間別（今日、昨日、全期間）に絞り込み可能</li>
              <li>モデル別（スタンダード、本命狙い、穴狙い）に切り替え可能</li>
            </ul>
          </div>
          <div className="tip-box">
            <h4>📊 実績の見方</h4>
            <ul>
              <li>
                <strong>予測精度</strong>: どれくらいの確率で的中するか
              </li>
              <li>
                <strong>回収率</strong>: 予測のパフォーマンスを示す指標
                <ul>
                  <li>100%以上: 高パフォーマンス</li>
                  <li>100%未満: 標準以下</li>
                </ul>
              </li>
              <li>予測精度を参考に、分析戦略を見直しましょう</li>
            </ul>
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
          name: "BoatAI（AIボートレース予想サービス）の使い方",
          description: "BoatAIの使い方を6つのステップで解説",
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
              AI予想を見る 🚀
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
