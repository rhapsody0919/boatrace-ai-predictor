import React, { useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import "./About.css";

const TITLE = "龍神レーダーについて | AIボートレース予想サービスの詳細";
const DESCRIPTION =
  "龍神レーダーは45項目以上のデータをAIが分析するボートレース予測サービス。データサイエンスに基づく高精度分析を完全無料・登録不要で提供します。";

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

  useSocialMeta({
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.boat-ai.jp/about",
    keywords:
      "龍神レーダー,ボートレース,AI分析,機械学習,データ分析,データサイエンス,無料",
  });

  return (
    <>
      <title>{TITLE}</title>
      <meta name="description" content={DESCRIPTION} />
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
          <p>AI技術でボートレース予想を革新する</p>
        </div>

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

        <section className="about-section">
          <h2>龍神レーダーとは</h2>
          <p>
            龍神レーダーは、人工知能（AI）を活用したボートレース予想サービスです。
            45項目以上のデータを総合的に分析し、高精度な予想を提供します。
          </p>
          <p>
            従来の「勘」や「経験」に頼る予想ではなく、データとAIの力で、
            より科学的で再現性の高い予想を実現しています。
          </p>
        </section>

        <section className="about-section">
          <h2>🗂️ レース詳細で見られるもの（8つのタブ）</h2>
          <p>
            各レースの詳細ページは、見たい切り口ごとに
            <strong>8つのタブ</strong>
            に分かれています。AI予想はそのうちの1つで、残りは
            <strong>誰が見ても同じ客観的なデータ</strong>
            です。予想を受け取るだけでなく、その根拠を自分で確かめられる構成にしています。
          </p>
          <ul className="about-tab-list">
            <li>
              <strong>基本情報</strong>:
              勝率・2連対率・3連対率・平均STを、会場（全国/当地）・グレード（全レース/一般戦/SG・G1）・期間（今期/直近3ヶ月/直近1ヶ月）で切り替えて比較。走数も併記します
            </li>
            <li>
              <strong>AI予想</strong>:
              1マークの展開予測と、1号艇が崩れやすいかを示すイン崩れ注意度
            </li>
            <li>
              <strong>枠別情報</strong>:
              本日入る想定コースでの成績に加え、ST考察（安定率・抜出・出遅率を同じコース・同じ級別の平均との差つきで表示）と逃げシミュレーション（1コースが逃げたとき2着に来たコースの割合）
            </li>
            <li>
              <strong>モータ情報</strong>: この会場のモーターの成績・調子
            </li>
            <li>
              <strong>今節</strong>:
              出走6選手の今節の得点率・節内順位・準優の目安までの必要得点。勝負駆けがかかっているのが誰かを読めます
            </li>
            <li>
              <strong>直前情報</strong>: 展示タイム・気象・ピットレポート
            </li>
            <li>
              <strong>オッズ一覧</strong>: 発売中のオッズ
            </li>
            <li>
              <strong>結果</strong>:
              レース確定後の着順と、展開予測が的中したかの判定
            </li>
          </ul>
          <p className="note">
            ※ 各タブの使い分けは<Link to="/how-to-use">使い方ガイド</Link>
            で手順つきに説明しています
          </p>
        </section>

        <section className="about-section">
          <h2>📊 AIが分析する45項目のデータ</h2>
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

        <section className="about-section">
          <h2>✨ 龍神レーダーの特徴</h2>
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon">🆓</div>
              <h3>完全無料</h3>
              <p>すべての機能を無料で利用できます。登録も不要です。</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🎯</div>
              <h3>高精度分析</h3>
              <p>展開予測的中率約79%の実測実績</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📈</div>
              <h3>実績公開</h3>
              <p>
                予測精度・分析パフォーマンスをすべて公開。透明性を重視しています。
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🔄</div>
              <h3>毎日更新</h3>
              <p>
                発走が近いレースから順次、最新の直前情報を取り込んで予想を更新します。
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">📱</div>
              <h3>スマホ対応</h3>
              <p>スマートフォンからでも快適に利用できます。</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">🤖</div>
              <h3>展開予測</h3>
              <p>
                1マークの展開をシミュレーション。レース展開が一目でわかります。
              </p>
            </div>
          </div>
        </section>

        <section className="about-section">
          <h2>🎓 AIの仕組み（概要）</h2>
          <div className="ai-explanation">
            <div className="ai-step">
              <div className="step-number">1</div>
              <div className="step-content">
                <h3>データ収集</h3>
                <p>最新のレースデータを収集</p>
              </div>
            </div>
            <div className="ai-step">
              <div className="step-number">2</div>
              <div className="step-content">
                <h3>データ分析</h3>
                <p>45項目以上のデータを総合的に分析</p>
              </div>
            </div>
            <div className="ai-step">
              <div className="step-number">3</div>
              <div className="step-content">
                <h3>展開予測</h3>
                <p>1マークでの各艇の動きをシミュレーション</p>
              </div>
            </div>
            <div className="ai-step">
              <div className="step-number">4</div>
              <div className="step-content">
                <h3>予想生成</h3>
                <p>展開予測・イン崩れ指数を算出</p>
              </div>
            </div>
          </div>
          <p className="note">※ 詳細なアルゴリズムは企業秘密のため非公開です</p>
        </section>

        <section className="about-section">
          <h2>📊 AI分析の精度（実測値）</h2>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">79%</div>
              <div className="stat-label">展開予測的中率</div>
            </div>
          </div>
          <p className="stats-note">
            ※
            実測値。各レースの詳細ページ「結果」タブで、毎回の的中/不的中を確認できます
          </p>
        </section>

        <section className="about-section">
          <h2>📜 利用規約・免責事項</h2>
          <p>
            龍神レーダーの分析結果は参考情報であり、結果を保証するものではありません。舟券の購入は自己責任で行ってください。詳しい利用条件・禁止事項は
            <Link to="/terms">利用規約</Link>
            をご確認ください。
          </p>
        </section>

        <section className="about-cta">
          <h2>🚀 今すぐ無料で試す</h2>
          <p>登録不要・完全無料でAI予想を確認できます</p>
          <button onClick={() => navigate("/")} className="cta-button">
            AI予想を見る
          </button>
        </section>
      </div>
    </>
  );
}
