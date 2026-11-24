import { useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { isInCautionEnabled } from "../config/featureFlags";
import {
  AboutAccuracySection,
  AboutAiMechanismSection,
  AboutCtaSection,
  AboutFeaturesSection,
  AboutWhatIsSection,
} from "./AboutLegacySections";
import {
  InCautionCtaSection,
  InCautionFeaturesSection,
  InCautionHowSection,
  InCautionResultsSection,
  InCautionTabIntro,
  InCautionTabItem,
  InCautionWhatIsSection,
} from "./AboutInCautionSections";
import "./About.css";

const TITLE = "龍神レーダーについて | AIボートレース予想サービスの詳細";
const KEYWORDS =
  "龍神レーダー,ボートレース,AI分析,機械学習,データ分析,データサイエンス,無料";

// イン崩れ注意度の公開の後（BOA-822 task 38、フラグの側）。「AI予想」と言わない・「数える」を使わない（wording-editor 2026-11-24）
const IN_CAUTION_META = {
  title: "龍神レーダーについて | ボートレースのデータ分析サービスの詳細",
  subtitle: "ボートレースのデータを、自分で確かめられる形に",
  description:
    "龍神レーダーは、選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果から割合を出して見える化するボートレースのデータ分析サービスです。完全無料・登録不要で使えます。",
  keywords: "龍神レーダー,ボートレース,データ分析,イン崩れ,過去データ,無料",
};
const DESCRIPTION =
  "龍神レーダーは、選手成績・モーター・展示・スタートのデータを、過去の実際のレース結果で数えて見える化するボートレースのデータ分析サービスです。完全無料・登録不要で使えます。";

function AboutHeroVideoSection({ mobileVideoRef, desktopVideoRef, videoStarted, handlePlayVideo }) {
  return (
    <section className="about-hero-video">
      <div className="hero-video-wrapper">
        <video
          ref={mobileVideoRef}
          className="hero-video hero-video-mobile"
          loop
          playsInline
          controls={videoStarted}
          preload="none"
          poster="/videos/about-hero-mobile-poster.jpg"
        >
          <source src="/videos/about-hero-mobile.mp4" type="video/mp4" />
        </video>
        <video
          ref={desktopVideoRef}
          className="hero-video hero-video-desktop"
          loop
          playsInline
          controls={videoStarted}
          preload="none"
          poster="/videos/about-hero-desktop-poster.jpg"
        >
          <source src="/videos/about-hero-desktop.mp4" type="video/mp4" />
        </video>
        {!videoStarted && (
          <button
            type="button"
            className="hero-video-play-button"
            onClick={handlePlayVideo}
            aria-label="動画を再生"
          >
            ▶
          </button>
        )}
      </div>
      <p className="hero-video-credit">
        音楽:「Rocket Power」by Kevin MacLeod (incompetech.com) — Licensed
        under Creative Commons: By Attribution 4.0
      </p>
    </section>
  );
}

function AboutRaceTabsSection({ inCaution }) {
  return (
    <section className="about-section">
      <h2>🗂️ レース詳細で見られるもの（タブ構成）</h2>
      <p>
        各レースの詳細ページは、見たい切り口ごとにタブに分かれています。発走前は
        {/* フラグの側は龍神ソナーのタブも数える（ファン評価 2026-11-24 P2） */}
        <strong>{inCaution ? "8つ" : "7つ"}</strong>
        、レースが確定すると「結果」が加わって
        <strong>{inCaution ? "9つ" : "8つ"}</strong>
        になります。
        {inCaution ? (
          <InCautionTabIntro />
        ) : (
          <>
            AI予想はそのうちの1つで、残りは
            <strong>誰が見ても同じ客観的なデータ</strong>
            です。予想を受け取るだけでなく、その根拠を自分で確かめられる構成にしています。
          </>
        )}
      </p>
      {!inCaution && (
        <p>
          並びは粒度順で、
          <strong>前半の4つは6艇をまとめて見るタブ</strong>、
          <strong>後半は艇を1つ選んで掘るタブ</strong>です。
        </p>
      )}
      <ul className="about-tab-list">
        <li>
          <strong>基本情報</strong>:
          勝率・2連対率・3連対率・平均STを、会場（全国/当地）・グレード（全レース/一般戦/SG・G1）・期間（今期/直近3ヶ月/直近1ヶ月）で切り替えて比較。走数も併記します
        </li>
        {inCaution && (
          <li>
            <strong>龍神ソナー</strong>: 類似レースの決まり方
          </li>
        )}
        <li>
          {inCaution ? (
            <InCautionTabItem />
          ) : (
            <>
              <strong>AI予想</strong>:
              1マークの展開予測と、1号艇が崩れやすいかを示すイン崩れ注意度。展開予測が的中したかどうかもここで確認できます
            </>
          )}
        </li>
        <li>
          <strong>今節</strong>:
          出走6選手の今節の得点率・節内順位・準優の目安までの必要得点。勝負駆けがかかっているのが誰かを読めます
        </li>
        <li>
          <strong>直前情報</strong>: 展示タイム・気象・ピットレポート
        </li>
        <li>
          <strong>枠別情報</strong>:
          本日入る想定コースでの成績に加え、ST考察（安定率・抜出・出遅率を同じコース・同じ級別の平均との差つきで表示）と逃げシミュレーション（1コースが逃げたとき2着に来たコースの割合）
        </li>
        <li>
          <strong>モータ情報</strong>: この会場のモーターの成績・調子
        </li>
        <li>
          <strong>オッズ一覧</strong>: 発売中のオッズ
        </li>
        <li>
          <strong>結果</strong>:
          レース確定後の着順と配当。確定するまでこのタブは出ません
        </li>
      </ul>
      <p className="note">
        ※ 各タブの使い分けは<Link to="/how-to-use">使い方ガイド</Link>
        で手順つきに説明しています
      </p>
    </section>
  );
}

function AboutDataSection() {
  return (
    <section className="about-section">
      <h2>📊 龍神レーダーが扱うデータ</h2>
      <div className="data-grid">
        <div className="data-category">
          <h3>選手データ</h3>
          <ul>
            <li>級別（A1, A2, B1, B2）</li>
            <li>全国勝率</li>
            <li>当地勝率</li>
            <li>2連対率</li>
            <li>3連対率</li>
            <li>平均スタートタイミング</li>
          </ul>
        </div>
        <div className="data-category">
          <h3>モーターデータ</h3>
          <ul>
            <li>モーター2連対率</li>
            <li>直近の成績</li>
            <li>モーター番号</li>
          </ul>
        </div>
        <div className="data-category">
          <h3>ボートデータ</h3>
          <ul>
            <li>ボート2連対率</li>
            <li>ボート番号</li>
          </ul>
        </div>
        <div className="data-category">
          <h3>レース条件</h3>
          <ul>
            <li>コース（1-6号艇）</li>
            <li>風向き・風速</li>
            <li>水面状況</li>
            <li>気温・水温</li>
            <li>ボートレース場の特性</li>
          </ul>
        </div>
        <div className="data-category">
          <h3>展示航走データ</h3>
          <ul>
            <li>展示タイム</li>
            <li>ターンの回り足</li>
            <li>行き足</li>
            <li>伸び足</li>
          </ul>
        </div>
        <div className="data-category">
          <h3>過去データ</h3>
          <ul>
            <li>同条件レースの傾向</li>
            <li>選手同士の対戦成績</li>
            <li>ボートレース場別の傾向</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function AboutTermsSection() {
  return (
    <section className="about-section">
      <h2>📜 利用規約・免責事項</h2>
      <p>
        龍神レーダーの分析結果は参考情報であり、結果を保証するものではありません。舟券の購入は自己責任で行ってください。詳しい利用条件・禁止事項は
        <Link to="/terms">利用規約</Link>
        をご確認ください。
      </p>
    </section>
  );
}

/** 本文の節。フラグの側（BOA-822）は「AI予想」・展開予測の節を注意度の節に替える */
function AboutSections({ inCaution, navigate }) {
  if (!inCaution) {
    return (
      <>
        <AboutWhatIsSection />
        <AboutRaceTabsSection inCaution={false} />
        <AboutDataSection />
        <AboutFeaturesSection />
        <AboutAiMechanismSection />
        <AboutAccuracySection />
        <AboutTermsSection />
        <AboutCtaSection navigate={navigate} />
      </>
    );
  }
  return (
    <>
      <InCautionWhatIsSection />
      <AboutRaceTabsSection inCaution />
      <AboutDataSection />
      <InCautionFeaturesSection />
      <InCautionHowSection />
      <InCautionResultsSection />
      <AboutTermsSection />
      <InCautionCtaSection navigate={navigate} />
    </>
  );
}

export default function About() {
  const navigate = useNavigate();
  const mobileVideoRef = useRef(null);
  const desktopVideoRef = useRef(null);
  const [videoStarted, setVideoStarted] = useState(false);

  const handlePlayVideo = () => {
    setVideoStarted(true);
    mobileVideoRef.current?.play();
    desktopVideoRef.current?.play();
  };

  const inCaution = isInCautionEnabled();
  const meta = inCaution
    ? IN_CAUTION_META
    : { title: TITLE, description: DESCRIPTION, keywords: KEYWORDS };

  useSocialMeta({
    title: meta.title,
    description: meta.description,
    url: "https://www.boat-ai.jp/about",
    keywords: meta.keywords,
  });

  return (
    <>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href="https://www.boat-ai.jp/about" />

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
              name: "龍神レーダーについて",
              item: "https://www.boat-ai.jp/about",
            },
          ],
        })}
      </script>

      <Header />

      <div className="about-container">
        <div className="about-header">
          <h1>🚀 龍神レーダーについて</h1>
          <p>
            {inCaution
              ? IN_CAUTION_META.subtitle
              : "AI技術でボートレース予想を革新する"}
          </p>
        </div>

        <AboutHeroVideoSection mobileVideoRef={mobileVideoRef} desktopVideoRef={desktopVideoRef} videoStarted={videoStarted} handlePlayVideo={handlePlayVideo} />

        <AboutSections inCaution={inCaution} navigate={navigate} />
      </div>
    </>
  );
}
