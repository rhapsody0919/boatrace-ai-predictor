/**
 * 「龍神レーダーについて」の、イン崩れ注意度の公開の後の節（BOA-822 task 38、機能フラグ isInCautionEnabled() の側）。
 * 2026-11-24 オーナー決定: 龍神レーダーは分析サイト。「AI予想」と言わない。展開予測は画面から外れるので的中率の数字も出さない。
 * 文の before/after はオーナーが OK を出した物（wording-editor の判定を反映）。注意度の定義の正本は ja common.json の inCaution.listNote。
 */
import { Link } from "react-router-dom";

/** タブ構成の節の導入（フラグの側） */
export function InCautionTabIntro() {
  return (
    <>
      各タブは、公式のデータと過去のレース結果をもとにしています。イン崩れ注意度など、過去のレース結果から出した割合には、元の件数を添えています。
    </>
  );
}

/** タブ構成の節の「イン崩れ」の項目（フラグの側） */
export function InCautionTabItem() {
  return (
    <>
      <strong>イン崩れ</strong>:
      1号艇が崩れやすいかを示すイン崩れ注意度、出現パターン、過去に発生した割合
    </>
  );
}

export function InCautionWhatIsSection() {
  return (
    <section className="about-section">
      <h2>龍神レーダーとは</h2>
      <p>
        龍神レーダーは、ボートレースのデータ分析サービスです。選手成績・モーター・展示・スタートなどの公式のデータと過去のレース結果を、レースごとに見やすくまとめます。
      </p>
      <p>
        どのレースを見て、何を材料にするかは、あなたが決めます。龍神レーダーは、その材料を、根拠ごと確かめられる形で出します。
      </p>
    </section>
  );
}

const FEATURES = [
  ["🆓", "完全無料", "すべての機能を無料で利用できます。登録も不要です。"],
  [
    "🔢",
    "件数つきの割合",
    "イン崩れ注意度には、何件の過去レースから出したかを添えます。",
  ],
  [
    "📈",
    "実績公開",
    "イン崩れ注意度の段ごとの実績を「精度分析」ページで公開しています。",
  ],
  [
    "🔄",
    "毎日更新",
    "直前情報（展示タイム等）は、発走が近いレースから順次反映します。",
  ],
  ["📱", "スマホ対応", "スマートフォンからでも快適に利用できます。"],
  [
    "⚠️",
    "イン崩れ注意度",
    "1号艇と、他の艇で一番高い全国勝率の差が同じくらいの過去レースで、1号艇が1着を逃した割合を3段で出します。",
  ],
];

export function InCautionFeaturesSection() {
  return (
    <section className="about-section">
      <h2>✨ 龍神レーダーの特徴</h2>
      <div className="features-grid">
        {FEATURES.map(([icon, title, body]) => (
          <div className="feature-card" key={title}>
            <div className="feature-icon">{icon}</div>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  [
    "勝率差",
    "1号艇の全国勝率から、他の艇で一番高い全国勝率を引きます",
  ],
  [
    "帯に分ける",
    "勝率差を 0.5 刻みの帯に分けます（両端は −3.5未満・+3.0以上にまとめます）",
  ],
  [
    "過去の割合",
    "その帯の全国の過去レース（2019年4月〜前日）で、1号艇が1着を逃した割合を出します。準優勝戦・優勝戦は、それぞれ準優勝戦だけ・優勝戦だけの過去レースの値です",
  ],
  [
    "3段で表示",
    "55%以上は「崩れやすい」、35〜54%は「中くらい」、35%未満は「堅め」と表示します",
  ],
];

export function InCautionHowSection() {
  return (
    <section className="about-section">
      <h2>🎓 イン崩れ注意度の出し方</h2>
      <div className="ai-explanation about-in-caution-steps">
        {STEPS.map(([title, body], i) => (
          <div className="ai-step" key={title}>
            <div className="step-number">{i + 1}</div>
            <div className="step-content">
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="note">
        ※ 過去の実績の割合で、そのレースの結果を保証するものではありません
      </p>
    </section>
  );
}

export function InCautionResultsSection() {
  return (
    <section className="about-section">
      <h2>📊 段ごとの実績</h2>
      <p>
        注意度の段ごとに、実際に1号艇が1着を逃したレースの割合と件数を「精度分析」ページで公開しています。
      </p>
      <p>
        <Link to="/accuracy">段ごとの実績を見る →</Link>
      </p>
    </section>
  );
}

export function InCautionCtaSection({ navigate }) {
  return (
    <section className="about-cta">
      <h2>🚀 今すぐ無料で試す</h2>
      <p>登録不要・完全無料でレースの分析を確認できます</p>
      <button onClick={() => navigate("/")} className="cta-button">
        レースの分析を見る
      </button>
    </section>
  );
}
