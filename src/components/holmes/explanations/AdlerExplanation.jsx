import "./ExplanationSection.css";

function AdlerExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        シャーロックが計算した各艇の勝率を「効用スコア」として、位置別温度付き
        Plackett-Luce分布で2連単・3連単・3連複の順列確率を一貫して導出します。
        温度パラメータ（γ・δ）は過去3万レース超の実データで最尤推定した値です。
      </p>

      <div className="explanation-diagram">
        <svg
          viewBox="0 0 640 160"
          width="100%"
          height="auto"
          aria-label="アドラー処理フロー図"
        >
          <defs>
            <marker
              id="adler-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#9333ea" />
            </marker>
          </defs>

          {/* 各艇ボックス */}
          <rect
            x="10"
            y="20"
            width="100"
            height="120"
            rx="6"
            fill="#f3e8ff"
            stroke="#9333ea"
            strokeWidth="1.5"
          />
          <text
            x="60"
            y="50"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#9333ea"
            fontWeight="600"
          >
            各艇の
          </text>
          <text
            x="60"
            y="66"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#9333ea"
            fontWeight="600"
          >
            特徴量
          </text>
          <text
            x="60"
            y="86"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            1号艇
          </text>
          <text
            x="60"
            y="100"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            2号艇
          </text>
          <text
            x="60"
            y="114"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            …6号艇
          </text>

          {/* 矢印1 */}
          <line
            x1="112"
            y1="80"
            x2="148"
            y2="80"
            stroke="#9333ea"
            strokeWidth="1.5"
            markerEnd="url(#adler-arrow)"
          />

          {/* シャーロックボックス */}
          <rect
            x="150"
            y="30"
            width="130"
            height="100"
            rx="6"
            fill="#f3e8ff"
            stroke="#9333ea"
            strokeWidth="1.5"
          />
          <text
            x="215"
            y="66"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#9333ea"
            fontWeight="600"
          >
            シャーロック
          </text>
          <text
            x="215"
            y="84"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            条件付きロジット
          </text>
          <text
            x="215"
            y="98"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            （+オッズ結合）で
          </text>
          <text
            x="215"
            y="112"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            勝率を計算
          </text>

          {/* 矢印2 */}
          <line
            x1="282"
            y1="80"
            x2="318"
            y2="80"
            stroke="#9333ea"
            strokeWidth="1.5"
            markerEnd="url(#adler-arrow)"
          />

          {/* 勝率ボックス */}
          <rect
            x="320"
            y="30"
            width="120"
            height="100"
            rx="6"
            fill="#f3e8ff"
            stroke="#9333ea"
            strokeWidth="1.5"
          />
          <text
            x="380"
            y="62"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#9333ea"
            fontWeight="600"
          >
            勝率 = 効用
          </text>
          <text
            x="380"
            y="80"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            p₁, p₂, …, p₆
          </text>
          <text
            x="380"
            y="98"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            各艇の勝ちやすさ
          </text>
          <text
            x="380"
            y="114"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#7c3aed"
          >
            を確率で表現
          </text>

          {/* 矢印3 */}
          <line
            x1="442"
            y1="80"
            x2="478"
            y2="80"
            stroke="#9333ea"
            strokeWidth="1.5"
            markerEnd="url(#adler-arrow)"
          />

          {/* PL分布ボックス */}
          <rect
            x="480"
            y="20"
            width="150"
            height="120"
            rx="6"
            fill="#9333ea"
            stroke="#9333ea"
            strokeWidth="1.5"
          />
          <text
            x="555"
            y="52"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#ffffff"
            fontWeight="600"
          >
            温度付きPL分布
          </text>
          <text
            x="555"
            y="70"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#f3e8ff"
          >
            2着はγ乗・3着はδ乗
          </text>
          <text
            x="555"
            y="84"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#f3e8ff"
          >
            2連単確率
          </text>
          <text
            x="555"
            y="98"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#f3e8ff"
          >
            3連単確率
          </text>
          <text
            x="555"
            y="112"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#f3e8ff"
          >
            3連複確率
          </text>
          <text
            x="555"
            y="128"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#e9d5ff"
          >
            を一括導出
          </text>
        </svg>
      </div>

      <ul className="explanation-key-points">
        <li>
          <span style={{ color: "#9333ea" }}>Plackett-Luce分布</span> により、
          単勝・連単・連複の確率を矛盾なく一貫したモデルで計算
        </li>
        <li>
          2着・3着の条件付き確率に位置別温度（γ・δ）を適用し、素のPL（Harville式）が
          本命の連対率を過大評価するバイアスを補正
        </li>
        <li>
          γ・δは競馬の借り物の定数ではなく、ボートレースの実データ3万レース超で最尤推定
        </li>
        <li>
          シャーロックの勝率（週次再学習）に乗るため、追加の重いモデルなしで
          ブラウザ内リアルタイム計算が可能
        </li>
      </ul>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>Plackett-Luce 分布とは</h4>
            <p>
              各選択肢に「効用スコア」を割り当て、順列の確率をその比で表す確率モデルです。
              「1位が艇kである確率」は k
              の効用を全体の効用合計で割った値になります。アドラーでは
              シャーロックが計算した勝率そのものを効用として使います。
            </p>
            <code className="explanation-formula">
              P(1着=i, 2着=j, 3着=k) = p_i × p_j^γ/Σ p^γ × p_k^δ/Σ p^δ
            </code>
            <p>
              この式で「1着が艇A、2着が艇B、3着が艇C」という任意の順列の確率が
              解析的に計算できます。これにより2連単・3連単・3連複のすべてを
              同一モデルから導出できます。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>位置別温度 γ・δ の役割</h4>
            <p>
              素のPL（Harville式、γ=δ=1）は「1着確率をそのまま2着・3着の条件付き確率に
              流用」するため、本命艇の2・3着確率を過大評価します。実際のレースでは
              1着争いに敗れた本命が大きく崩れることがあるためです。γ・δ（0〜1）を
              1着確率の指数として適用すると、この過信が減衰されます。
            </p>
            <p>
              競馬では Benter (1994) の γ=0.81, δ=0.65 が有名ですが、アドラーは
              ボートレースの実データで最尤推定した値（γ≈0.67, δ≈0.47）を使います。
              競馬より小さい値になったのは、イン優位のボートレースでは「勝率の高さ」が
              「2・3着への残りやすさ」に直結しにくいことを示しています。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>IIA (無関係な選択肢からの独立) 仮定</h4>
            <p>
              「艇Aが艇Bより先着する確率」は他の艇の存在に依存しないという仮定です。
              これにより計算が大幅に簡略化され、6艇すべての順列 (120通り) を
              軽量に列挙できます。実際のレースでは完全には成立しないため、
              位置別温度がその歪みの一部を吸収しています。展開（誰と誰が競るか）まで
              モデル化するのは、将来のレース内相互作用モデルの課題です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>具体的なウォークスルー</h4>
            <p>
              例: シャーロックの勝率が 1号艇 45%、2号艇 20%、3号艇 15%、4号艇
              10%、5号艇 6%、6号艇 4% のレースで「1-2-3」の3連単確率は:
            </p>
            <code className="explanation-formula">
              45% × (20%^0.67 ÷ 残り5艇の^0.67合計) × (15%^0.47 ÷
              残り4艇の^0.47合計) ≈ 45% × 31% × 33% ≈ 4.6%
            </code>
            <p>
              素のHarville式なら約7.0%と出るところが、温度補正で現実的な値に
              抑えられます。全120通りに同じ計算をして確率順に並べたものが
              上の「本日の推理」です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>強み・弱み</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>全賭け式を一貫したモデルで計算（確率の合計が必ず1）</li>
                  <li>温度パラメータを実データで検証済み（未来データで logloss 改善を確認）</li>
                  <li>パラメータ2つだけで過学習しにくい</li>
                  <li>ブラウザ内で即座に計算できる軽さ</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>勝率の精度はシャーロックに依存（それ以上にはならない）</li>
                  <li>IIA仮定のため「展開」による順位入れ替わりは表現できない</li>
                  <li>連単・連複オッズが未収集のため期待値（EV）は未対応</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="explanation-detail-block">
            <h4>既存モデルとの違いと今後</h4>
            <p>
              現行のルールベースモデルは「1着予想」と「連単予想」を別々のロジックで
              算出しているため、単勝確率と連単確率が矛盾することがあります。
              アドラーは一つの確率モデルからすべての賭け式を導出するため、
              論理的一貫性が保たれます。将来的には、効用スコア自体を
              ニューラルネット（選手・モーター・会場の embedding 入り）で学習する
              「フルアドラー」への拡張を構想しています。
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default AdlerExplanation;
