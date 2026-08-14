import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import "./FAQ.css";

export default function FAQ() {
  const navigate = useNavigate();
  const [openIndex, setOpenIndex] = useState(null);

  const faqs = [
    {
      category: "基本情報",
      questions: [
        {
          q: "BoatAIは無料ですか？",
          a: "はい、完全無料です。すべての機能を登録不要で利用できます。今後も無料で提供し続けます。",
        },
        {
          q: "登録は必要ですか？",
          a: "いいえ、登録は一切不要です。サイトにアクセスするだけで、すぐにAI予想を確認できます。",
        },
        {
          q: "スマホでも使えますか？",
          a: "はい、スマートフォンでも快適に利用できます。レスポンシブデザインに対応しているため、PCでもスマホでも同じように使えます。",
        },
      ],
    },
    {
      category: "AI予想について",
      questions: [
        {
          q: "AI予測の精度はどのくらいですか？",
          a: "展開予測（1マークでの動きの予想）の的中率は約79%です（実測値）。各レースの予想画面・データで振り返るセクションで、毎回の的中/不的中を確認できます。複勝予想は実測精度の算出方法を見直し中のため、一時的に表示を停止しています。",
        },
        {
          q: "AIはどのようにデータを分析していますか？",
          a: "選手データ、モーター性能、ボート性能、展示航走データ、レース条件など45項目以上のデータを総合的に分析しています。",
        },
        {
          q: "展開予測・イン崩れ指数の違いは何ですか？",
          a: "BoatAIは1つのAIモデルで複数の分析を提供しています。\n\n【展開予測】1マークでの各艇の動き（逃げ、差し、まくり等）をシミュレーションし、レース展開を予測します。\n\n【イン崩れ指数】そのレースが波乱になりやすいか（1号艇が不利になりやすいか）を会場内の相対的な傾向から算出します。",
        },
        {
          q: "展開予測とは何ですか？",
          a: "1マークでの各艇の動き（逃げ、差し、まくり等）をシミュレーションし、レース展開を予測する機能です。コース別の攻撃力・守備力を分析し、複数の展開パターンを確率付きで表示します。",
        },
        {
          q: "予想は毎日更新されますか？",
          a: "はい、1時間ごとに最新のレースデータを分析し、予想を更新しています。",
        },
        {
          q: "どのボートレース場に対応していますか？",
          a: "全24ボートレース場すべてに対応しています。桐生、戸田、江戸川、平和島、多摩川、浜名湖、蒲郡、常滑、津、三国、びわこ、住之江、尼崎、鳴門、丸亀、児島、宮島、徳山、下関、若松、芦屋、福岡、唐津、大村です。",
        },
      ],
    },
    {
      category: "使い方",
      questions: [
        {
          q: "どうやって予想を見れば良いですか？",
          a: "トップページで気になるボートレース場を選択すると、その日のレース一覧が表示されます。各レースの「AI予想を見る」ボタンをクリックすると、詳細な予想が確認できます。",
        },
        {
          q: "的中レースはどこで確認できますか？",
          a: "トップページの「的中レース」タブで、過去14日間の的中レースを確認できます。レース場別、期間別に絞り込むこともできます。",
        },
        {
          q: "シェア機能はありますか？",
          a: "はい、各予想ページにX（旧Twitter）、Facebook、LINEのシェアボタンがあります。友達と予想を共有できます。",
        },
      ],
    },
    {
      category: "予測データの活用",
      questions: [
        {
          q: "BoatAIで何ができますか？",
          a: "BoatAIは予測情報を提供するサービスです。レース展開の分析にお役立てください。",
        },
        {
          q: "AI予測は必ず的中しますか？",
          a: "いいえ、100%の的中はありません。AI予測は参考情報として提供しており、分析の一助としてご活用ください。",
        },
      ],
    },
    {
      category: "データ・技術",
      questions: [
        {
          q: "どのようなデータを使用していますか？",
          a: "ボートレースの公開データを活用しています。選手情報、モーター性能、レース結果など、すべて公式に公開されているデータを分析に使用しています。",
        },
        {
          q: "AIの予想精度は向上していますか？",
          a: "はい、レースデータが蓄積されるごとに、AIモデルを改善しています。今後もより高精度な予想を目指して開発を続けます。",
        },
        {
          q: "どのようなAI技術を使っていますか？",
          a: "機械学習（Machine Learning）の技術を使用しています。詳細なアルゴリズムは企業秘密のため非公開です。",
        },
      ],
    },
    {
      category: "トラブル",
      questions: [
        {
          q: "予想が表示されません",
          a: "ブラウザのキャッシュをクリアして、ページを再読み込みしてください。それでも表示されない場合は、お問い合わせページからご連絡ください。",
        },
        {
          q: "データが古いようです",
          a: "データは1時間ごとに自動更新されますが、タイミングによっては最新データが反映されていない場合があります。少し時間をおいて再度アクセスしてください。",
        },
        {
          q: "スマホで表示が崩れます",
          a: "ブラウザを最新版にアップデートしてください。Safari、Chrome、Edgeの最新版を推奨しています。",
        },
      ],
    },
    {
      category: "その他",
      questions: [
        {
          q: "今後、有料化する予定はありますか？",
          a: "現時点では有料化の予定はありません。今後も無料で提供し続けることを目指しています。",
        },
        {
          q: "要望や不具合を報告したいです",
          a: "お問い合わせページからご連絡ください。いただいたご意見は、サービス改善の参考にさせていただきます。",
        },
        {
          q: "BoatAIを紹介しても良いですか？",
          a: "はい、ぜひご紹介ください。X、ブログ、YouTubeなど、どこで紹介していただいても構いません。シェアボタンもご活用ください。",
        },
        {
          q: "API提供の予定はありますか？",
          a: "現時点ではAPI提供の予定はありません。今後の開発状況によっては検討する可能性があります。",
        },
      ],
    },
  ];

  const toggleFAQ = (index) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  // Prepare FAQ schema data
  const faqSchemaItems = faqs.flatMap((category) =>
    category.questions.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.a,
      },
    })),
  );

  return (
    <>
      <title>よくある質問（FAQ） | BoatAI</title>
      <meta
        name="description"
        content="BoatAIに関するよくある質問と回答。無料での利用方法、AI予測の精度、使い方、予測データの活用方法など、皆様の疑問にお答えします。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/faq" />

      {/* FAQPage Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqSchemaItems,
        })}
      </script>

      {/* BreadcrumbList Structured Data */}
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
              name: "よくある質問",
              item: "https://www.boat-ai.jp/faq",
            },
          ],
        })}
      </script>

      <Header />

      <div className="faq-container">
        <div className="faq-header">
          <h1>❓ よくある質問（FAQ）</h1>
          <p>BoatAIに関するよくある質問と回答</p>
        </div>

        {faqs.map((category, categoryIndex) => (
          <section key={categoryIndex} className="faq-category">
            <h2>{category.category}</h2>
            <div className="faq-list">
              {category.questions.map((faq, questionIndex) => {
                const globalIndex = `${categoryIndex}-${questionIndex}`;
                const isOpen = openIndex === globalIndex;

                return (
                  <div
                    key={questionIndex}
                    className={`faq-item ${isOpen ? "open" : ""}`}
                  >
                    <button
                      className="faq-question"
                      onClick={() => toggleFAQ(globalIndex)}
                    >
                      <span className="question-text">Q. {faq.q}</span>
                      <span className="toggle-icon">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen && (
                      <div className="faq-answer">
                        <p>A. {faq.a}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div className="faq-cta">
          <h2>🚀 まだ質問がありますか？</h2>
          <p>お気軽にお問い合わせください</p>
          <div className="cta-buttons">
            <button
              onClick={() => navigate("/contact")}
              className="contact-button"
            >
              お問い合わせ
            </button>
            <button onClick={() => navigate("/")} className="try-button">
              AI予想を試す
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
