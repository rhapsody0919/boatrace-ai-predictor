import "./ExplanationSection.css";

function SherlockExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        出走表・展示データから計算した「実力の勝率」と、市場オッズが織り込む
        「みんなの予想」を統計的に最適なバランスで融合する二段階モデルです。
        香港競馬で長期利益を実証した Benter (1994) と同じ構造を採用しています。
      </p>

      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 300"
          width="100%"
          height="auto"
          aria-label="シャーロック予想の二段階処理フロー図"
        >
          <defs>
            <marker
              id="sherlock-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#059669" />
            </marker>
          </defs>

          {/* ===== 上段: 実力ルート ===== */}
          <rect
            x="10"
            y="20"
            width="130"
            height="100"
            rx="6"
            fill="#d1fae5"
            stroke="#059669"
            strokeWidth="1.5"
          />
          <text
            x="75"
            y="44"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#059669"
            fontWeight="700"
          >
            レースの事実
          </text>
          <text x="75" y="62" textAnchor="middle" fontSize="9" fill="#047857">
            展示タイム・展示ST
          </text>
          <text x="75" y="76" textAnchor="middle" fontSize="9" fill="#047857">
            モーター2連率
          </text>
          <text x="75" y="90" textAnchor="middle" fontSize="9" fill="#047857">
            選手勝率・級別
          </text>
          <text x="75" y="104" textAnchor="middle" fontSize="9" fill="#047857">
            コース・会場特性
          </text>

          <line
            x1="142"
            y1="70"
            x2="178"
            y2="70"
            stroke="#059669"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />

          <rect
            x="180"
            y="20"
            width="150"
            height="100"
            rx="6"
            fill="#d1fae5"
            stroke="#059669"
            strokeWidth="1.5"
          />
          <text
            x="255"
            y="44"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#059669"
            fontWeight="700"
          >
            条件付きロジット
          </text>
          <text x="255" y="62" textAnchor="middle" fontSize="9" fill="#047857">
            6艇を1つの選択問題として
          </text>
          <text x="255" y="76" textAnchor="middle" fontSize="9" fill="#047857">
            統計モデルで学習
          </text>
          <text x="255" y="94" textAnchor="middle" fontSize="9" fill="#047857">
            特徴量はレース内で相対化
          </text>
          <text x="255" y="108" textAnchor="middle" fontSize="9" fill="#047857">
            （3.2万レースで学習）
          </text>

          <line
            x1="332"
            y1="70"
            x2="368"
            y2="70"
            stroke="#059669"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />

          <rect
            x="370"
            y="30"
            width="110"
            height="80"
            rx="6"
            fill="#d1fae5"
            stroke="#059669"
            strokeWidth="1.5"
          />
          <text
            x="425"
            y="62"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#059669"
            fontWeight="700"
          >
            実力の勝率
          </text>
          <text x="425" y="82" textAnchor="middle" fontSize="10" fill="#047857">
            f₁ … f₆
          </text>

          {/* ===== 下段: 市場ルート ===== */}
          <rect
            x="10"
            y="160"
            width="130"
            height="80"
            rx="6"
            fill="#e0e7ff"
            stroke="#4f46e5"
            strokeWidth="1.5"
          />
          <text
            x="75"
            y="188"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#4f46e5"
            fontWeight="700"
          >
            市場オッズ
          </text>
          <text x="75" y="206" textAnchor="middle" fontSize="9" fill="#4338ca">
            単勝オッズ 6艇分
          </text>
          <text x="75" y="220" textAnchor="middle" fontSize="9" fill="#4338ca">
            （発走前スナップショット）
          </text>

          <line
            x1="142"
            y1="200"
            x2="178"
            y2="200"
            stroke="#4f46e5"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />

          <rect
            x="180"
            y="160"
            width="150"
            height="80"
            rx="6"
            fill="#e0e7ff"
            stroke="#4f46e5"
            strokeWidth="1.5"
          />
          <text
            x="255"
            y="188"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#4f46e5"
            fontWeight="700"
          >
            みんなの予想確率
          </text>
          <text x="255" y="206" textAnchor="middle" fontSize="9" fill="#4338ca">
            q = (1/オッズ) を正規化
          </text>
          <text x="255" y="220" textAnchor="middle" fontSize="9" fill="#4338ca">
            控除率25%分を除去
          </text>

          <line
            x1="332"
            y1="200"
            x2="368"
            y2="200"
            stroke="#4f46e5"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />

          <rect
            x="370"
            y="170"
            width="110"
            height="70"
            rx="6"
            fill="#e0e7ff"
            stroke="#4f46e5"
            strokeWidth="1.5"
          />
          <text
            x="425"
            y="198"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#4f46e5"
            fontWeight="700"
          >
            市場の勝率
          </text>
          <text
            x="425"
            y="218"
            textAnchor="middle"
            fontSize="10"
            fill="#4338ca"
          >
            q₁ … q₆
          </text>

          {/* ===== 合流 → 結合 ===== */}
          <line
            x1="482"
            y1="70"
            x2="530"
            y2="120"
            stroke="#059669"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />
          <line
            x1="482"
            y1="200"
            x2="530"
            y2="155"
            stroke="#4f46e5"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />

          <rect
            x="535"
            y="95"
            width="155"
            height="90"
            rx="6"
            fill="#059669"
            stroke="#059669"
            strokeWidth="1.5"
          />
          <text
            x="612"
            y="120"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#ffffff"
            fontWeight="700"
          >
            二段階結合
          </text>
          <text
            x="612"
            y="140"
            textAnchor="middle"
            fontSize="10"
            fill="#d1fae5"
          >
            α·ln f + β·ln q
          </text>
          <text x="612" y="158" textAnchor="middle" fontSize="9" fill="#d1fae5">
            α, β は過去データから
          </text>
          <text x="612" y="172" textAnchor="middle" fontSize="9" fill="#d1fae5">
            最尤推定（α≈0.72, β≈0.32）
          </text>

          {/* 最終出力 */}
          <line
            x1="612"
            y1="187"
            x2="612"
            y2="215"
            stroke="#059669"
            strokeWidth="1.5"
            markerEnd="url(#sherlock-arrow)"
          />
          <rect
            x="510"
            y="220"
            width="180"
            height="60"
            rx="6"
            fill="#065f46"
            stroke="#065f46"
          />
          <text
            x="600"
            y="245"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#ffffff"
            fontWeight="700"
          >
            最終勝率 + 期待値(EV)
          </text>
          <text x="600" y="265" textAnchor="middle" fontSize="9" fill="#a7f3d0">
            EV = 勝率 × オッズ × 0.95
          </text>
        </svg>
      </div>

      <ul className="explanation-key-points">
        <li>
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            {/* #059669は白/カード背景で3.6〜3.9:1しかなくAA未達（axe-core検出）。
                単色の濃色化では片方のテーマで必ず失敗するため両テーマ対応の銀トークンに変更 */}
            市場オッズを「特徴量」として使う
          </span>
          のが最大の特徴。オッズには何万人分の情報が凝縮されており、
          それを無視するモデルは市場に勝てない（Benter の教訓）
        </li>
        <li>
          結合係数 α（実力）と β（市場）はデータから推定。α &gt; β
          ＝「展示・機力などの事実情報が、まだオッズに織り込まれていない分」を拾う
        </li>
        <li>
          学習と推論で完全に同一のコードを使用（
          <code>sherlockModel.js</code>
          を共有）し、このページの予測はブラウザ内でリアルタイムに計算
        </li>
        <li>
          評価は「未来のデータでテスト」する walk-forward 方式のみ。
          ΔR²（市場への上乗せ情報量）を主要指標として監視
        </li>
      </ul>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>条件付きロジットモデルとは</h4>
            <p>
              「6艇の中からどれが勝つか」を1つの選択問題として扱う統計モデルです。
              各艇のスコア x_i・w を計算し、softmax で勝率に変換します。
              競馬予測の古典 Bolton &amp; Chapman (1986)
              以来の定番手法で、レース内で確率の合計が必ず1になります。
            </p>
            <code className="explanation-formula">
              P(勝者 = i) = exp(x_i・w) / Σ_j exp(x_j・w)
            </code>
          </div>

          <div className="explanation-detail-block">
            <h4>特徴量（すべてレース内で相対化）</h4>
            <p>
              コース（1〜5号艇ダミー）、全国勝率・当地勝率・モーター2連率・
              ボート2連率・級別（それぞれレース平均との差）、展示タイム・展示ST
              （平均より速い分）、会場ごとの1コース優位度（例:
              大村はイン天国、戸田は差し水面）を使用します。
              「絶対値でなく相手との比較」がボートレース予測の鉄則です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>なぜオッズと結合するのか</h4>
            <p>
              市場オッズ単独でも的中率約50%の強力な予測器です。
              自前モデルの真の価値は「市場が知らないことをどれだけ知っているか」
              （ΔR²）で測られます。二段階結合は両者のいいとこ取りを
              統計的に最適な重みで行い、単独モデルより一貫して高精度です。
            </p>
            <code className="explanation-formula">
              P(勝者=i) ∝ exp(α・ln f_i + β・ln q_i)
            </code>
          </div>

          <div className="explanation-detail-block">
            <h4>実測パフォーマンス（walk-forward、未来データでの検証）</h4>
            <p>
              2026年5〜7月の3,931レースで検証: 1着的中率52.9%
              （オッズ単独49.4%、基礎モデル単独52.3%）、McFadden R² 0.284、 ΔR²
              = +0.059。市場に対する上乗せ情報を持つことを確認済み。 ただし
              <strong>回収率は最良のEVフィルタでも約70%</strong>で、
              控除率25%の壁を超えるには至っていません（誇張なしの実測値）。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>強み・弱み</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>市場情報と実力情報の統計的最適融合</li>
                  <li>確率が校正済み（合計1・実測と整合）</li>
                  <li>係数が全て解釈可能</li>
                  <li>ブラウザ内でリアルタイム推論</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>線形モデルのため複雑な交互作用は苦手</li>
                  <li>オッズ未取得のレースでは実力のみ</li>
                  <li>回収率100%超は未達（EV選別でも約70%）</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="explanation-detail-block">
            <h4>他の探偵との関係</h4>
            <p>
              シャーロックは全探偵の「ベースライン」です。ワトソン（LightGBM）や
              アドラー（Plackett-Luce NN）は、このモデルの ΔR²
              を上回って初めて採用されます。
              モリアーティは予想モデルの確率を受け取り
              「いくら賭けるか」を決める役割分担です
              （現在のベースは既存3モデル）。
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default SherlockExplanation;
