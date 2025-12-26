import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Header from '../components/Header';
import './HowToUse.css';

export default function HowToUse() {
    const navigate = useNavigate();
    const [activeStep, setActiveStep] = useState(0);

    const steps = [
        {
            title: 'ステップ1: レース場を選ぶ',
            icon: '🏟️',
            content: (
                <>
                    <p><strong>トップページ</strong>にアクセスすると、<strong>「今日のレース」</strong>タブに、本日開催中のレース場が表示されます。</p>
                    <div className="step-detail">
                        <h4>💡 レース場の選び方</h4>
                        <ul>
                            <li><strong>ドロップダウンメニュー</strong>から、気になるレース場を選択</li>
                            <li>全24場（桐生、戸田、江戸川、平和島...など）に対応</li>
                            <li>迷ったら、<strong>最初に表示されているレース場</strong>から始めましょう</li>
                        </ul>
                    </div>
                    <div className="example-box">
                        <p className="example-title">📌 例</p>
                        <p>「今日は平和島で舟券を買いたい」→ ドロップダウンから「平和島」を選択</p>
                    </div>
                </>
            )
        },
        {
            title: 'ステップ2: 予想を見たいレースを選ぶ',
            icon: '🏁',
            content: (
                <>
                    <p>レース場を選ぶと、<strong>その日のレース一覧</strong>が表示されます。</p>
                    <div className="step-detail">
                        <h4>💡 レースの見方</h4>
                        <ul>
                            <li>各レースには<strong>レース番号</strong>と<strong>締切予定時刻</strong>が表示されます</li>
                            <li><strong>荒れ度</strong>マークで、レースの予想しやすさがわかります
                                <ul>
                                    <li>😌 <strong>堅い</strong>: 1号艇が有利なレース（本命党向け）</li>
                                    <li>😐 <strong>標準</strong>: バランス型のレース</li>
                                    <li>😬 <strong>荒れる</strong>: 波乱が起きやすいレース（穴党向け）</li>
                                </ul>
                            </li>
                            <li><strong>「AI予想を見る」</strong>ボタンをクリック</li>
                        </ul>
                    </div>
                    <div className="example-box">
                        <p className="example-title">📌 例</p>
                        <p>「平和島 10R（14:30締切）荒れ度: 😌堅い」→「AI予想を見る」をクリック</p>
                    </div>
                </>
            )
        },
        {
            title: 'ステップ3: AI予想モデルを選ぶ',
            icon: '🤖',
            content: (
                <>
                    <p>BoatAIでは<strong>3種類の予想モデル</strong>から選べます。</p>
                    <div className="step-detail">
                        <h4>💡 モデルの違い</h4>
                        <div className="model-comparison">
                            <div className="model-card standard">
                                <h5>🎯 スタンダード（推奨）</h5>
                                <p><strong>的中率と配当のバランス重視</strong></p>
                                <ul>
                                    <li>全国勝率・当地成績・モーター性能を総合評価</li>
                                    <li>迷ったらまずこれ</li>
                                    <li>単勝的中率 27%、3連単回収率 136%</li>
                                </ul>
                            </div>
                            <div className="model-card safe-bet">
                                <h5>🛡️ 本命狙い</h5>
                                <p><strong>的中率を最重視（安全志向）</strong></p>
                                <ul>
                                    <li>1号艇とA級選手を優先</li>
                                    <li>堅いレースで力を発揮</li>
                                    <li>単勝的中率 53%（高的中率）</li>
                                </ul>
                            </div>
                            <div className="model-card upset-focus">
                                <h5>💎 穴狙い</h5>
                                <p><strong>高配当を狙う（攻撃型）</strong></p>
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
                        <p>荒れ度が「😌堅い」なら → <strong>本命狙い</strong>モデル</p>
                        <p>荒れ度が「😬荒れる」なら → <strong>穴狙い</strong>モデル</p>
                        <p>迷ったら → <strong>スタンダード</strong>モデル</p>
                    </div>
                </>
            )
        },
        {
            title: 'ステップ4: AI予想を確認する',
            icon: '📊',
            content: (
                <>
                    <p>AI予想画面では、AIが分析した予想結果が表示されます。</p>
                    <div className="step-detail">
                        <h4>💡 予想画面の見方</h4>
                        <ul>
                            <li><strong>AIスコア</strong>: 各艇の勝率をAIが数値化（高いほど有力）</li>
                            <li><strong>本命</strong>: AIが最も勝つ可能性が高いと判断した艇</li>
                            <li><strong>推奨買い目（3連複）</strong>: 3連複を買う場合の推奨組み合わせ</li>
                            <li><strong>推奨買い目（3連単）</strong>: 3連単を買う場合の推奨組み合わせ</li>
                            <li><strong>選手データ</strong>: 各選手の級別、勝率、モーター性能など</li>
                        </ul>
                    </div>
                    <div className="tip-box">
                        <h4>💡 初心者におすすめの舟券種別</h4>
                        <ul>
                            <li><strong>複勝</strong>: 的中率49.5%（2着以内に入れば的中）- 初心者向け</li>
                            <li><strong>3連複</strong>: 的中率12.8%、回収率80.6%（順不同で1-2-3着）- 中級者向け</li>
                            <li><strong>3連単</strong>: 的中率2.8%、回収率134.3%（着順一致）- 上級者向け</li>
                        </ul>
                    </div>
                </>
            )
        },
        {
            title: 'ステップ5: 舟券を購入する',
            icon: '🎫',
            content: (
                <>
                    <p>AI予想を参考に、舟券を購入しましょう。</p>
                    <div className="step-detail">
                        <h4>⚠️ 重要な注意事項</h4>
                        <div className="warning-box">
                            <p><strong>BoatAIでは舟券を購入できません</strong></p>
                            <p>舟券の購入は、<a href="https://www.boatrace.jp/" target="_blank" rel="noopener noreferrer">テレボート</a>などの公式サービスをご利用ください。</p>
                        </div>
                    </div>
                    <div className="step-detail">
                        <h4>💰 資金管理のコツ</h4>
                        <ul>
                            <li><strong>余剰資金の範囲内</strong>で楽しむ（生活費には手をつけない）</li>
                            <li>1日の予算を決める（例: 1,000円〜3,000円）</li>
                            <li>負けを取り戻そうと熱くならない</li>
                            <li>AI予想は<strong>参考情報</strong>として活用する</li>
                        </ul>
                    </div>
                    <div className="tip-box">
                        <h4>📝 購入のヒント</h4>
                        <ul>
                            <li>本命の<strong>複勝</strong>から始めるのが安全</li>
                            <li>自信があるレースで<strong>3連複</strong>に挑戦</li>
                            <li>大穴を狙うなら<strong>少額で3連単</strong></li>
                        </ul>
                    </div>
                </>
            )
        },
        {
            title: 'ステップ6: 的中実績を確認する',
            icon: '📈',
            content: (
                <>
                    <p>レース終了後、AIの予想が当たったかを確認できます。</p>
                    <div className="step-detail">
                        <h4>💡 実績の確認方法</h4>
                        <ul>
                            <li><strong>「的中レース」タブ</strong>: 過去14日間の的中レースを表示</li>
                            <li><strong>「成績」タブ</strong>: 的中率・回収率の統計データを表示</li>
                            <li>期間別（今日、昨日、全期間）に絞り込み可能</li>
                            <li>モデル別（スタンダード、本命狙い、穴狙い）に切り替え可能</li>
                        </ul>
                    </div>
                    <div className="tip-box">
                        <h4>📊 実績の見方</h4>
                        <ul>
                            <li><strong>的中率</strong>: どれくらいの確率で当たるか</li>
                            <li><strong>回収率</strong>: 投資額に対してどれだけ払戻があるか
                                <ul>
                                    <li>100%以上: プラス収支</li>
                                    <li>100%未満: マイナス収支</li>
                                </ul>
                            </li>
                            <li>自分の購入結果と比較して、戦略を見直しましょう</li>
                        </ul>
                    </div>
                </>
            )
        }
    ];

    return (
        <>
            <Helmet>
                <title>使い方ガイド | BoatAI - 初心者でもわかる利用方法</title>
                <meta name="description" content="BoatAIの使い方を6つのステップで解説。レース場の選び方、AI予想モデルの選択、舟券購入のコツまで、初心者にもわかりやすく説明します。" />
                <meta name="keywords" content="BoatAI使い方,ボートレース予想方法,初心者ガイド,舟券購入,AI予想モデル" />
                <link rel="canonical" href="https://boat-ai.jp/how-to-use" />

                {/* OGP Tags */}
                <meta property="og:type" content="website" />
                <meta property="og:title" content="使い方ガイド | BoatAI" />
                <meta property="og:description" content="BoatAIの使い方を初心者にもわかりやすく6ステップで解説。" />
                <meta property="og:url" content="https://boat-ai.jp/how-to-use" />
                <meta property="og:image" content="https://boat-ai.jp/ogp-image.png" />

                {/* HowTo Structured Data */}
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "HowTo",
                        "name": "BoatAI（AIボートレース予想サービス）の使い方",
                        "description": "BoatAIの使い方を6つのステップで解説",
                        "step": steps.map((step, index) => ({
                            "@type": "HowToStep",
                            "position": index + 1,
                            "name": step.title,
                            "text": step.title
                        }))
                    })}
                </script>

                {/* BreadcrumbList */}
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "BreadcrumbList",
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": 1,
                                "name": "ホーム",
                                "item": "https://boat-ai.jp/"
                            },
                            {
                                "@type": "ListItem",
                                "position": 2,
                                "name": "使い方ガイド",
                                "item": "https://boat-ai.jp/how-to-use"
                            }
                        ]
                    })}
                </script>
            </Helmet>

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
                        className={`step-nav-btn ${activeStep === index ? 'active' : ''} ${activeStep > index ? 'completed' : ''}`}
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
                <div className="step-body">
                    {steps[activeStep].content}
                </div>
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
                    <button
                        onClick={() => navigate('/')}
                        className="nav-button finish"
                    >
                        AI予想を見る 🚀
                    </button>
                )}
            </div>

            {/* よくある質問へのリンク */}
            <div className="faq-link-section">
                <h3>💡 もっと詳しく知りたい方へ</h3>
                <p>よくある質問もご覧ください</p>
                <button
                    onClick={() => navigate('/faq')}
                    className="faq-button"
                >
                    FAQ（よくある質問）
                </button>
            </div>
            </div>
        </>
    );
}
