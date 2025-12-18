import React from 'react';
import { useNavigate } from 'react-router-dom';
import './About.css';

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="about-container">
      <div className="about-header">
        <h1>🚀 BoatAIについて</h1>
        <p>AI技術で競艇予想を革新する</p>
      </div>

      <section className="about-section">
        <h2>BoatAIとは</h2>
        <p>
          BoatAIは、人工知能（AI）を活用した競艇予想サービスです。
          45項目以上のデータを総合的に分析し、高精度な予想を提供します。
        </p>
        <p>
          従来の「勘」や「経験」に頼る予想ではなく、データとAIの力で、
          より科学的で再現性の高い予想を実現しています。
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
              <li>競艇場の特性</li>
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
              <li>競艇場別の傾向</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="about-section">
        <h2>✨ BoatAIの特徴</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🆓</div>
            <h3>完全無料</h3>
            <p>すべての機能を無料で利用できます。登録も不要です。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h3>高精度予想</h3>
            <p>複勝的中率49.5%、3連単回収率134.3%の実績（2025年12月実績）</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📈</div>
            <h3>実績公開</h3>
            <p>的中率・回収率をすべて公開。透明性を重視しています。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔄</div>
            <h3>毎日更新</h3>
            <p>1時間ごとに最新のレースデータを分析します。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📱</div>
            <h3>スマホ対応</h3>
            <p>スマートフォンからでも快適に利用できます。</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🤖</div>
            <h3>AIスコア</h3>
            <p>各艇のAIスコアを表示。一目で有力艇が分かります。</p>
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
              <h3>AIスコア算出</h3>
              <p>機械学習モデルで各艇のスコアを算出</p>
            </div>
          </div>
          <div className="ai-step">
            <div className="step-number">4</div>
            <div className="step-content">
              <h3>予想生成</h3>
              <p>本命・推奨買い目を自動生成</p>
            </div>
          </div>
        </div>
        <p className="note">
          ※ 詳細なアルゴリズムは企業秘密のため非公開です
        </p>
      </section>

      <section className="about-section">
        <h2>📊 実績データ（2025年12月）</h2>
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">49.5%</div>
            <div className="stat-label">複勝的中率</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">12.8%</div>
            <div className="stat-label">3連複的中率</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">85.3%</div>
            <div className="stat-label">複勝回収率</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">134.3%</div>
            <div className="stat-label">3連単回収率</div>
          </div>
        </div>
        <p className="stats-note">
          ※ 2025年12月1日〜18日の実績データ（全1,951レース）
        </p>
      </section>

      <section className="about-section">
        <h2>📜 利用規約</h2>
        <div className="terms">
          <h3>1. サービスの利用</h3>
          <p>
            BoatAIは無料でご利用いただけます。予告なく内容を変更、または
            サービスを停止する場合があります。
          </p>

          <h3>2. 免責事項</h3>
          <p>
            BoatAIの予想は参考情報として提供しています。
            舟券の購入は自己責任で行ってください。
            当サービスの利用による損失について、一切の責任を負いません。
          </p>

          <h3>3. データの正確性</h3>
          <p>
            可能な限り正確なデータを提供するよう努めていますが、
            データの正確性、完全性を保証するものではありません。
          </p>

          <h3>4. 禁止事項</h3>
          <ul>
            <li>サービスの不正利用</li>
            <li>データの無断転載・商用利用</li>
            <li>サーバーに負荷をかける行為</li>
          </ul>
        </div>
      </section>

      <section className="about-cta">
        <h2>🚀 今すぐ無料で試す</h2>
        <p>登録不要・完全無料でAI予想を確認できます</p>
        <button
          onClick={() => navigate('/')}
          className="cta-button"
        >
          AI予想を見る
        </button>
      </section>
    </div>
  );
}
