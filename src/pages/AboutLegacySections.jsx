/**
 * 「龍神レーダーについて」の、イン崩れ注意度の公開の前の節（「AI予想」・展開予測の的中率）。
 * BOA-822 の公開の後の掃除（task 42）で、フラグの分岐ごと消す。About.jsx から字のまま移した（出力は同じ）。
 */
export function AboutWhatIsSection() {
  return (
    <section className="about-section">
      <h2>龍神レーダーとは</h2>
      <p>
        龍神レーダーは、人工知能（AI）を活用したボートレース予想サービスです。
        選手成績・モーター・展示・スタートのデータを総合的に分析し、高精度な予想を提供します。
      </p>
      <p>
        従来の「勘」や「経験」に頼る予想ではなく、データとAIの力で、
        より科学的で再現性の高い予想を実現しています。
      </p>
    </section>
  );
}

export function AboutFeaturesSection() {
  return (
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
  );
}

export function AboutAiMechanismSection() {
  return (
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
            <p>選手成績・モーター・展示・スタートのデータを総合的に分析</p>
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
  );
}

export function AboutAccuracySection() {
  return (
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
        実測値。各レースの詳細ページ「AI予想」タブで、毎回の的中/不的中を確認できます
      </p>
    </section>
  );
}

export function AboutCtaSection({ navigate }) {
  return (
    <section className="about-cta">
      <h2>🚀 今すぐ無料で試す</h2>
      <p>登録不要・完全無料でAI予想を確認できます</p>
      <button onClick={() => navigate("/")} className="cta-button">
        AI予想を見る
      </button>
    </section>
  );
}
