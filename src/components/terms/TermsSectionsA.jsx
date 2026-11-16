import { H2, H3, P, P_LAST, SECTION } from "./termsStyles";
// 第1条
export function Section1() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第1条（適用）</h2>
      <p style={P}>
        本利用規約（以下「本規約」）は、龍神レーダー（以下「当サイト」）が提供するボートレースAI予想サービス（以下「本サービス」）の利用条件を定めるものです。
      </p>
      <p style={P_LAST}>
        本サービスを利用されるすべてのユーザー（以下「利用者」）は、本規約に同意したものとみなします。
      </p>
    </section>
  );
}

// 第2条
export function Section2() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第2条（サービスの内容）</h2>
      <p style={P}>
        本サービスは、AI技術を活用したボートレースレースの予想情報を提供するサービスです。
      </p>
      <p style={P}>
        当サイトが提供する情報は、あくまで参考情報であり、レース結果や舟券の的中を保証するものではありません。
      </p>
      <p style={P_LAST}>
        本サービスは無料で提供されており、登録不要でご利用いただけます。
      </p>
    </section>
  );
}

// 第3条
export function Section3() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第3条（利用条件）</h2>
      <p style={P}>利用者は、以下の条件を満たす必要があります：</p>
      <ul
        style={{
          color: "var(--text-secondary)",
          lineHeight: "1.8",
          paddingLeft: "1.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <li>20歳以上であること（ボートレース法に基づく）</li>
        <li>本規約に同意すること</li>
        <li>日本国内からアクセスしていること</li>
      </ul>
      <div
        style={{
          backgroundColor: "var(--color-error-dark)",
          padding: "1rem",
          borderRadius: "8px",
          marginTop: "1rem",
        }}
      >
        <p
          style={{
            color: "white",
            fontWeight: "600",
            marginBottom: "0.5rem",
          }}
        >
          ⚠️ 未成年者の利用禁止
        </p>
        <p style={{ color: "white", lineHeight: "1.8" }}>
          ボートレースの舟券購入は20歳未満の方は法律で禁止されています。20歳未満の方は本サービスを利用しないでください。
        </p>
      </div>
    </section>
  );
}

// 第4条
export function Section4() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第4条（禁止事項）</h2>
      <p style={P}>利用者は、以下の行為を行ってはなりません：</p>
      <ul
        style={{
          color: "var(--text-secondary)",
          lineHeight: "1.8",
          paddingLeft: "1.5rem",
        }}
      >
        <li>法令または公序良俗に反する行為</li>
        <li>当サイトの運営を妨害する行為</li>
        <li>当サイトのサーバーやネットワークに過度な負荷をかける行為</li>
        <li>当サイトのコンテンツを無断で商用利用する行為</li>
        <li>当サイトのコンテンツを改変、複製、転載する行為</li>
        <li>リバースエンジニアリング、逆コンパイル等の行為</li>
        <li>虚偽の情報を登録または送信する行為</li>
        <li>他の利用者や第三者に迷惑をかける行為</li>
        <li>その他、当サイトが不適切と判断する行為</li>
      </ul>
    </section>
  );
}

function Section5Pre() {
  return (
    <>
      <h3 style={H3}>5-1. 予想情報について</h3>
      <p style={P}>
        当サイトが提供する予想情報は、AI技術を用いた統計的分析に基づくものですが、その正確性、完全性、有用性について一切保証いたしません。
      </p>
      <p style={P}>
        舟券の購入は利用者自身の判断と責任において行ってください。当サイトは、利用者が本サービスの情報を利用して舟券を購入した結果生じた損害について、一切の責任を負いません。
      </p>

      <h3 style={H3}>5-2. サービスの中断・停止</h3>
      <p style={P}>
        当サイトは、システムメンテナンス、障害、その他の理由により、予告なく本サービスの全部または一部を停止または中断することがあります。
      </p>
      <p style={P}>
        これにより利用者に生じた損害について、当サイトは一切の責任を負いません。
      </p>
    </>
  );
}

function Section5Post() {
  return (
    <>
      <h3 style={H3}>5-3. データの正確性</h3>
      <p style={P}>
        当サイトは、第三者のデータソース（公式ボートレースサイト等）から取得したデータを使用していますが、データの正確性について保証するものではありません。
      </p>

      <h3 style={H3}>5-4. 外部リンク</h3>
      <p style={P_LAST}>
        当サイトから他のウェブサイトへのリンクについて、リンク先の内容について当サイトは一切の責任を負いません。
      </p>
    </>
  );
}

export function Section5() {
  return (
    <section style={SECTION}>
      <h2 style={H2}>第5条（免責事項）</h2>

      <Section5Pre />
      <Section5Post />
    </section>
  );
}
