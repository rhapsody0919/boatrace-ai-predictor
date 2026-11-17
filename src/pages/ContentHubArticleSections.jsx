import { Link } from "react-router-dom";

// 初心者向けセクション
export function BeginnerSection() {
  return (
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
  );
}

// 戦略セクション
export function StrategySection() {
  return (
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
        <Link to="/blog/flying-late-start-strategy" className="article-card">
          <h3>F/L持ち選手の攻略法</h3>
          <p>フライング・出遅れ持ちの選手を狙う戦略</p>
        </Link>
        <Link to="/blog/monthly-50k-roadmap" className="article-card">
          <h3>月5万円の副収入を稼ぐロードマップ</h3>
          <p>データ分析から導き出した具体的な収益化ロードマップ</p>
        </Link>
      </div>
    </section>
  );
}

// データ分析セクション
export function DataSection() {
  return (
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
  );
}
