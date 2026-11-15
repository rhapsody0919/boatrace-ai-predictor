import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

function ContactHead() {
  return (
    <>
      <title>お問い合わせ | 龍神レーダー</title>
      <meta
        name="description"
        content="龍神レーダー（AIボートレース分析サービス）へのお問い合わせ。ご質問、ご意見、ご要望をお寄せください。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/contact" />
    </>
  );
}

function ContactIntro() {
  return (
    <>
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: "700",
          color: "var(--text-primary)",
          marginBottom: "1.5rem",
          borderBottom: "3px solid #0ea5e9",
          paddingBottom: "0.5rem",
        }}
      >
        お問い合わせ
      </h1>

      <p
        style={{
          color: "var(--text-secondary)",
          lineHeight: "1.8",
          marginBottom: "2rem",
        }}
      >
        ボートレースAI予測に関するご質問、ご意見、ご要望などがございましたら、以下のフォームよりお気軽にお問い合わせください。
      </p>
    </>
  );
}

function ContactNotice() {
  return (
    <div
      style={{
        backgroundColor: "var(--surface-card)",
        padding: "1.5rem",
        borderRadius: "8px",
        marginBottom: "2rem",
        border: "1px solid var(--border-hairline)",
      }}
    >
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: "600",
          color: "var(--text-primary)",
          marginBottom: "1rem",
        }}
      >
        お問い合わせ前にご確認ください
      </h2>
      <ul
        style={{
          color: "var(--text-secondary)",
          lineHeight: "1.8",
          paddingLeft: "1.5rem",
        }}
      >
        <li>舟券の購入代行や推奨は一切行っておりません</li>
        <li>予測結果に関する保証は提供していません</li>
        <li>回答までに数日かかる場合があります</li>
        <li>内容によっては回答できない場合があります</li>
      </ul>
    </div>
  );
}

function ContactForm({ formTitle }) {
  return (
    <>
      {/* Googleフォーム埋め込みエリア */}
      <div
        style={{
          marginBottom: "2rem",
        }}
      >
        <iframe
          title={formTitle}
          src="https://docs.google.com/forms/d/e/1FAIpQLSeiioPc2vCicOWbKogOXTVAcfaZD31vZHQgltI_K8ENpQFTzg/viewform?embedded=true"
          width="100%"
          height="721"
          frameBorder="0"
          marginHeight="0"
          marginWidth="0"
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            display: "block",
            border: "none",
            borderRadius: "8px",
          }}
        >
          読み込んでいます…
        </iframe>
      </div>
    </>
  );
}

function FaqItem({ question, children }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3
        style={{
          fontSize: "1.1rem",
          fontWeight: "600",
          color: "var(--text-primary)",
          marginBottom: "0.5rem",
        }}
      >
        {question}
      </h3>
      <p
        style={{
          color: "var(--text-secondary)",
          lineHeight: "1.8",
          marginLeft: "1rem",
        }}
      >
        {children}
      </p>
    </div>
  );
}

function ContactFaq() {
  return (
    <div
      style={{
        backgroundColor: "var(--surface-card)",
        padding: "1.5rem",
        borderRadius: "8px",
        marginBottom: "2rem",
      }}
    >
      <h2
        style={{
          fontSize: "1.25rem",
          fontWeight: "600",
          color: "var(--text-primary)",
          marginBottom: "1rem",
        }}
      >
        よくある質問
      </h2>

      <FaqItem question="Q. 予測の精度はどのくらいですか？">
        A.
        展開予測の的中率は約79%です（実測値）。複勝予想は実測精度の算出方法を見直し中のため、一時的に表示を停止しています。詳細は
        <Link
          to="/accuracy"
          style={{
            color: "var(--brand-accent-secondary)",
            textDecoration: "underline",
          }}
        >
          精度ダッシュボード
        </Link>
        をご確認ください。
      </FaqItem>

      <FaqItem question="Q. 舟券の購入代行はしてもらえますか？">
        A.
        いいえ、当サイトは予測情報の提供のみを行っており、舟券の購入代行や推奨は一切行っておりません。
      </FaqItem>

      <FaqItem question="Q. データの更新頻度は？">
        A. レース結果は自動で収集され、精度データは随時更新されています。
      </FaqItem>

      <FaqItem question="Q. AIの予測ロジックを教えてもらえますか？">
        A. Claude Sonnet
        4.5を使用した大規模言語モデルによる予測を行っています。
        選手成績、直近のレース結果、モーター情報などを総合的に分析しています。
      </FaqItem>
    </div>
  );
}

function ContactBackLink() {
  return (
    <div
      style={{
        marginTop: "3rem",
        padding: "1.5rem",
        backgroundColor: "var(--surface-card)",
        borderRadius: "8px",
        textAlign: "center",
      }}
    >
      <Link
        to="/"
        style={{
          color: "var(--brand-accent-secondary)",
          textDecoration: "none",
          fontSize: "1rem",
          fontWeight: "600",
        }}
      >
        ← トップページに戻る
      </Link>
    </div>
  );
}

export default function Contact() {
  const { t } = useTranslation();
  return (
    <>
      <ContactHead />
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          padding: "2rem",
          backgroundColor: "var(--surface-page)",
          minHeight: "100vh",
        }}
      >
        <ContactIntro />
        <ContactNotice />
        <ContactForm formTitle={t("contactPage.formTitle")} />
        <ContactFaq />
        <ContactBackLink />
      </div>
    </>
  );
}
