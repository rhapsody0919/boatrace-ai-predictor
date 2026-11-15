import { Link } from "react-router-dom";
import {
  Section1,
  Section2,
  Section3,
  Section4,
  Section5,
} from "./terms/TermsSectionsA";
import {
  Section6,
  Section7,
  Section8,
  Section9,
  Section10,
  Section11,
  Section12,
} from "./terms/TermsSectionsB";

export default function Terms() {
  return (
    <>
      <title>利用規約 | 龍神レーダー</title>
      <meta
        name="description"
        content="龍神レーダー（AIボートレース分析サービス）の利用規約。サービス内容、利用条件、禁止事項、免責事項についてご説明します。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/terms" />
      <div
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          padding: "2rem",
          backgroundColor: "var(--surface-page)",
          minHeight: "100vh",
        }}
      >
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
          利用規約
        </h1>

        <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
          最終更新日: 2025年12月23日
        </p>

        <Section1 />
        <Section2 />
        <Section3 />
        <Section4 />
        <Section5 />
        <Section6 />
        <Section7 />
        <Section8 />
        <Section9 />
        <Section10 />
        <Section11 />
        <Section12 />

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
      </div>
    </>
  );
}
