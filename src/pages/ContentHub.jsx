import { Link } from "react-router-dom";
import Header from "../components/Header";
import "./ContentHub.css";

// 会場データ
const venues = [
  { code: 1, name: "桐生", id: "kiryu" },
  { code: 2, name: "戸田", id: "toda" },
  { code: 3, name: "江戸川", id: "edogawa" },
  { code: 4, name: "平和島", id: "heiwajima" },
  { code: 5, name: "多摩川", id: "tamagawa" },
  { code: 6, name: "浜名湖", id: "hamanako" },
  { code: 7, name: "蒲郡", id: "gamagori" },
  { code: 8, name: "常滑", id: "tokoname" },
  { code: 9, name: "津", id: "tsu" },
  { code: 10, name: "三国", id: "mikuni" },
  { code: 11, name: "びわこ", id: "biwako" },
  { code: 12, name: "住之江", id: "suminoe" },
  { code: 13, name: "尼崎", id: "amagasaki" },
  { code: 14, name: "鳴門", id: "naruto" },
  { code: 15, name: "丸亀", id: "marugame" },
  { code: 16, name: "児島", id: "kojima" },
  { code: 17, name: "宮島", id: "miyajima" },
  { code: 18, name: "徳山", id: "tokuyama" },
  { code: 19, name: "下関", id: "shimonoseki" },
  { code: 20, name: "若松", id: "wakamatsu" },
  { code: 21, name: "芦屋", id: "ashiya" },
  { code: 22, name: "福岡", id: "fukuoka" },
  { code: 23, name: "唐津", id: "karatsu" },
  { code: 24, name: "大村", id: "omura" },
];

function ContentHub() {
  return (
    <>
      <title>
        ボートレースのルール・買い方 完全ガイド【24会場攻略】| 龍神レーダー
      </title>
      <meta
        name="description"
        content="ボートレースのルール・買い方から24会場の攻略法、データ分析手法、予想のコツまで体系的に解説する完全ガイド。初心者から上級者まで学べます。"
      />
      <link rel="canonical" href="https://www.boat-ai.jp/guide" />
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "ボートレース完全ガイド",
          description:
            "ボートレースの基礎知識から上級者向け戦略まで、体系的に学べる完全ガイド",
          url: "https://www.boat-ai.jp/guide",
          mainEntity: {
            "@type": "ItemList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "初心者向けガイド",
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "予想戦略",
              },
              {
                "@type": "ListItem",
                position: 3,
                name: "会場別攻略ガイド",
              },
              {
                "@type": "ListItem",
                position: 4,
                name: "データ分析手法",
              },
            ],
          },
        })}
      </script>

      <Header />

      <div className="content-hub-page">
        <div className="content-hub-container">
          {/* ヘッダーセクション */}
          <header className="hub-header">
            <h1>ボートレース完全ガイド</h1>
            <p className="hub-lead">
              初心者から上級者まで、ボートレースで勝つために必要な知識を体系的に学べます
            </p>
          </header>

          {/* 初心者向けセクション */}
          <section className="hub-section">
            <div className="section-header">
              <span className="section-icon">🔰</span>
              <h2>初心者向け - 基本を学ぶ</h2>
            </div>
            <p className="section-desc">
              ボートレースを始めたばかりの方向け。まずはここから学びましょう。
            </p>
            <div className="article-grid">
              <Link to="/blog/beginner-basics" className="article-card">
                <h3>ボートレース初心者が知るべき5つの基本</h3>
                <p>舟券の種類、レースの見方、オッズの読み方など基礎知識</p>
              </Link>
              <Link to="/blog/special-planned-races" className="article-card">
                <h3>企画レースとは？初心者におすすめの理由</h3>
                <p>1号艇A級固定など、当てやすいレースの見つけ方</p>
              </Link>
              <Link to="/blog/rough-race-signals" className="article-card">
                <h3>荒れるレースの見分け方 - 5つのサイン</h3>
                <p>AIが分析した1,899レースから導き出した「荒れるサイン」</p>
              </Link>
              <Link to="/blog/start-exhibition-guide" className="article-card">
                <h3>スタート展示の見方</h3>
                <p>STタイミング、進入、ターンから本番結果を予測する方法</p>
              </Link>
            </div>
          </section>

          {/* 戦略セクション */}
          <section className="hub-section">
            <div className="section-header">
              <span className="section-icon">📈</span>
              <h2>予想戦略 - 勝率を上げる</h2>
            </div>
            <p className="section-desc">
              予想の精度を高めるための戦略と買い方を解説します。
            </p>
            <div className="article-grid">
              <Link to="/blog/betting-strategy" className="article-card">
                <h3>1万円から始める実践的な舟券戦略</h3>
                <p>少額から始める堅実な舟券の買い方と資金管理術</p>
              </Link>
              <Link to="/blog/suji-funaken-guide" className="article-card">
                <h3>スジ舟券とは？理論と実践</h3>
                <p>展開別スジパターン、逆スジの見分け方、会場別傾向</p>
              </Link>
              <Link to="/blog/course-prediction-tips" className="article-card">
                <h3>進入予想のコツ - 枠なり崩れを見抜く</h3>
                <p>前付け選手の見抜き方、深インの影響を解説</p>
              </Link>
              <Link
                to="/blog/flying-late-start-strategy"
                className="article-card"
              >
                <h3>F/L持ち選手の攻略法</h3>
                <p>フライング・出遅れ持ちの選手を狙う戦略</p>
              </Link>
              <Link to="/blog/monthly-50k-roadmap" className="article-card">
                <h3>月5万円の副収入を稼ぐロードマップ</h3>
                <p>データ分析から導き出した具体的な収益化ロードマップ</p>
              </Link>
            </div>
          </section>

          {/* 会場攻略セクション */}
          <section className="hub-section venue-section">
            <div className="section-header">
              <span className="section-icon">🏟️</span>
              <h2>会場別攻略ガイド</h2>
            </div>
            <p className="section-desc">
              全国24会場それぞれの特徴と狙い目を解説。水面特性、イン勝率、おすすめの賭け方を紹介。
            </p>
            <div className="venue-grid">
              {venues.map((venue) => (
                <Link
                  key={venue.code}
                  to={`/blog/venue-${venue.id}`}
                  className="venue-card"
                >
                  <span className="venue-code">
                    {String(venue.code).padStart(2, "0")}
                  </span>
                  <span className="venue-name">{venue.name}</span>
                </Link>
              ))}
            </div>
            <div className="venue-overview-link">
              <Link to="/blog/stadium-strategy-guide" className="overview-btn">
                24場の特徴と狙い目を一覧で見る →
              </Link>
            </div>
          </section>

          {/* データ分析セクション */}
          <section className="hub-section">
            <div className="section-header">
              <span className="section-icon">📊</span>
              <h2>データ分析 - 数字で勝つ</h2>
            </div>
            <p className="section-desc">
              AIが活用するデータ分析手法を学び、予想に活かしましょう。
            </p>
            <div className="article-grid">
              <Link to="/blog/player-data-analysis" className="article-card">
                <h3>AIが分析する選手データの見方</h3>
                <p>AIが重視する選手データの読み方を詳しく解説</p>
              </Link>
              <Link to="/blog/motor-performance" className="article-card">
                <h3>モーター性能で勝率が変わる理由</h3>
                <p>「選手3割、モーター7割」の真実を解説</p>
              </Link>
              <Link to="/blog/exhibition-run-guide" className="article-card">
                <h3>展示航走で勝率が変わる！正しい見方</h3>
                <p>展示タイムの見方、伸び足・回り足の判断方法</p>
              </Link>
              <Link to="/blog/how-we-measure-accuracy" className="article-card">
                <h3>龍神レーダーの実績は本物か？計測方法を解説</h3>
                <p>的中率・回収率の計測方法と透明性について</p>
              </Link>
            </div>
          </section>

          {/* CTAセクション */}
          <section className="hub-cta">
            <h2>AI予想を試してみる</h2>
            <p>学んだ知識をAI予想と組み合わせて、勝率アップを目指しましょう</p>
            <Link to="/" className="cta-btn">
              本日のAI予想を見る →
            </Link>
          </section>
        </div>
      </div>

      <footer className="hub-footer">
        <div className="footer-links">
          <Link to="/blog">ブログ一覧</Link>
          <Link to="/about">About</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/privacy">プライバシーポリシー</Link>
        </div>
        <p>&copy; 2025 龍神レーダー - All Rights Reserved</p>
      </footer>
    </>
  );
}

export default ContentHub;
