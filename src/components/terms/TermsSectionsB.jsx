import { Link } from "react-router-dom";
import { H2, P, P_LAST, SECTION } from "./termsStyles";

// 第6条
export function Section6() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第6条（ギャンブル依存症への注意）</h2>
      <div
        style={{
          // 薄いオレンジ背景+濃色文字はダークテーマ非対応のため、濃い単色背景+白文字に統一
          backgroundColor: "#b45309",
          padding: "1rem",
          borderRadius: "8px",
        }}
      >
        <p
          style={{
            color: "white",
            fontWeight: "600",
            marginBottom: "0.5rem",
          }}
        >
          ⚠️ ギャンブル依存症にご注意ください
        </p>
        <p
          style={{
            color: "white",
            lineHeight: "1.8",
            marginBottom: "0.75rem",
          }}
        >
          ボートレースは適度に楽しむ娯楽です。のめり込みにご注意ください。
        </p>
        <ul
          style={{
            color: "white",
            lineHeight: "1.8",
            paddingLeft: "1.5rem",
          }}
        >
          <li>生活費や借金で舟券を購入しないでください</li>
          <li>予算を決めて、その範囲内で楽しんでください</li>
          <li>負けを取り戻そうと熱くならないでください</li>
          <li>ギャンブル依存症かもと思ったら、専門機関にご相談ください</li>
        </ul>
      </div>
    </section>
  );
}

// 第7条
export function Section7() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第7条（知的財産権）</h2>
      <p style={P}>
        当サイトに掲載されているコンテンツ（文章、画像、プログラム、デザイン等）の著作権その他の知的財産権は、当サイトまたは正当な権利を有する第三者に帰属します。
      </p>
      <p style={P}>
        利用者は、当サイトのコンテンツを、私的使用の範囲を超えて使用することはできません。
      </p>
      <p style={P_LAST}>
        「龍神レーダー」の名称およびロゴは、当サイトの商標または登録商標です。
      </p>
    </section>
  );
}

// 第8条
export function Section8() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第8条（プライバシーポリシー）</h2>
      <p style={P_LAST}>
        当サイトは、利用者の個人情報を
        <Link
          to="/privacy"
          style={{
            color: "var(--brand-accent-secondary)",
            textDecoration: "underline",
          }}
        >
          プライバシーポリシー
        </Link>
        に基づいて適切に取り扱います。
      </p>
    </section>
  );
}

// 第9条
export function Section9() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第9条（サービスの変更・終了）</h2>
      <p style={P}>
        当サイトは、利用者への事前通知なく、本サービスの内容を変更、追加、または終了することができるものとします。
      </p>
      <p style={P_LAST}>
        これにより利用者に生じた損害について、当サイトは一切の責任を負いません。
      </p>
    </section>
  );
}

// 第10条
export function Section10() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第10条（利用規約の変更）</h2>
      <p style={P}>
        当サイトは、必要に応じて本規約を変更することができるものとします。
      </p>
      <p style={P_LAST}>
        変更後の利用規約は、当サイトに掲載した時点から効力を生じるものとし、利用者が本サービスを継続して利用した場合、変更後の利用規約に同意したものとみなします。
      </p>
    </section>
  );
}

// 第11条
export function Section11() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第11条（準拠法・管轄裁判所）</h2>
      <p style={P}>本規約の解釈にあたっては、日本法を準拠法とします。</p>
      <p style={P_LAST}>
        本サービスに関連して利用者と当サイトとの間で紛争が生じた場合、東京地方裁判所を第一審の専属的合意管轄裁判所とします。
      </p>
    </section>
  );
}

// 第12条
export function Section12() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第12条（お問い合わせ）</h2>
      <p style={P_LAST}>
        本規約に関するお問い合わせは、
        <Link
          to="/contact"
          style={{
            color: "var(--brand-accent-secondary)",
            textDecoration: "underline",
          }}
        >
          お問い合わせページ
        </Link>
        からご連絡ください。
      </p>
    </section>
  );
}
