import "./ExplanationSection.css";
import watsonModel from "../../../../data/watson/model.json";

const N_FEATURES = watsonModel.n_features ?? 36;

function WatsonExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        {N_FEATURES}
        の特徴量から「6艇の順位」を直接学習する勾配ブースティングモデル。
        表データにおける予測精度と、SHAP値による判断根拠の可視化を両立します。
      </p>

      <div className="explanation-diagram">
        <svg
          viewBox="0 0 640 160"
          width="100%"
          height="auto"
          aria-label="ワトソン処理フロー図"
        >
          <defs>
            <marker
              id="watson-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#0284c7" />
            </marker>
          </defs>

          {/* 特徴量ボックス */}
          <rect
            x="10"
            y="40"
            width="120"
            height="80"
            rx="6"
            fill="#e0f2fe"
            stroke="#0284c7"
            strokeWidth="1.5"
          />
          <text
            x="70"
            y="76"
            textAnchor="middle"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
            fill="#0284c7"
            fontWeight="600"
          >
            特徴量
          </text>
          <text
            x="70"
            y="94"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            {N_FEATURES} 項目
          </text>
          <text
            x="70"
            y="108"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            選手・モーター・気象
          </text>

          {/* 矢印1 */}
          <line
            x1="132"
            y1="80"
            x2="168"
            y2="80"
            stroke="#0284c7"
            strokeWidth="1.5"
            markerEnd="url(#watson-arrow)"
          />

          {/* 決定木ボックス */}
          <rect
            x="170"
            y="20"
            width="160"
            height="120"
            rx="6"
            fill="#e0f2fe"
            stroke="#0284c7"
            strokeWidth="1.5"
          />
          <text
            x="250"
            y="56"
            textAnchor="middle"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
            fill="#0284c7"
            fontWeight="600"
          >
            勾配ブースティング
          </text>
          <text
            x="250"
            y="76"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            木1 → 木2 → … → 木N
          </text>
          <text
            x="250"
            y="94"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            LambdaRank目的関数
          </text>
          <text
            x="250"
            y="110"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            で順位を直接最適化
          </text>
          <text
            x="250"
            y="126"
            textAnchor="middle"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            SHAP値で解釈可能
          </text>

          {/* 矢印2 */}
          <line
            x1="332"
            y1="80"
            x2="368"
            y2="80"
            stroke="#0284c7"
            strokeWidth="1.5"
            markerEnd="url(#watson-arrow)"
          />

          {/* スコア集計ボックス */}
          <rect
            x="370"
            y="40"
            width="120"
            height="80"
            rx="6"
            fill="#e0f2fe"
            stroke="#0284c7"
            strokeWidth="1.5"
          />
          <text
            x="430"
            y="76"
            textAnchor="middle"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
            fill="#0284c7"
            fontWeight="600"
          >
            スコア集計
          </text>
          <text
            x="430"
            y="94"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#0369a1"
          >
            各艇のランクスコア
          </text>

          {/* 矢印3 */}
          <line
            x1="492"
            y1="80"
            x2="528"
            y2="80"
            stroke="#0284c7"
            strokeWidth="1.5"
            markerEnd="url(#watson-arrow)"
          />

          {/* 順位ボックス */}
          <rect
            x="530"
            y="40"
            width="100"
            height="80"
            rx="6"
            fill="#0284c7"
            stroke="#0284c7"
            strokeWidth="1.5"
          />
          <text
            x="580"
            y="76"
            textAnchor="middle"
            fontSize="12"
            fontFamily="system-ui, sans-serif"
            fill="#ffffff"
            fontWeight="600"
          >
            予想順位
          </text>
          <text
            x="580"
            y="96"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#e0f2fe"
          >
            1位〜6位
          </text>
        </svg>
      </div>

      <ul className="explanation-key-points">
        <li style={{ "--bullet-color": "#0284c7" }}>
          {/* #0284c7はカード背景で片方のテーマのみ通過のため両テーマ対応の銀トークンに変更 */}
          <span style={{ color: "var(--brand-accent-secondary)" }}>
            LambdaRank
          </span>{" "}
          により、単純な回帰・分類でなく「6艇の順位」を直接最適化
        </li>
        <li>
          選手・モーター・展示タイム・気象・レース内相対値など{N_FEATURES}
          の特徴量を自動的に組み合わせて判断
        </li>
        <li>
          SHAP値（LightGBM内蔵のTreeSHAP）で「なぜこの艇を1位と予測したか」を数値で説明できる高い解釈性
        </li>
        <li>表形式データに強く、欠損値・カテゴリ変数をそのまま扱える実用性</li>
      </ul>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>勾配ブースティング決定木 (GBDT) とは</h4>
            <p>
              多数の浅い決定木を「直前の木の誤差を修正する方向に」順番に積み重ねるアンサンブル手法です。
              各木は前の木が間違えたサンプルに集中して学習するため、少ない木でも高精度を達成します。
              LightGBM は leaf-wise 成長戦略と histogram-based 分割探索により、
              XGBoost より数倍高速に学習できます。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>LambdaRank 目的関数</h4>
            <p>
              通常の回帰は「各艇の着順」を個別に予測しますが、LambdaRank は
              「6艇の順序関係」そのものを最適化します。 評価指標 NDCG
              (Normalized Discounted Cumulative Gain) を直接最大化するよう
              勾配を計算するため、順位予測タスクに本質的に合致しています。
            </p>
            <code className="explanation-formula">
              λ_ij = |ΔNDCG_ij| × σ(s_i - s_j) × [-1]
            </code>
            <p>
              ペアごとの順位スワップが NDCG
              に与える影響量でグラジエントを重み付けします。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>SHAP値による解釈性</h4>
            <p>
              ゲーム理論の Shapley
              値に基づき、各特徴量が予測スコアにどれだけ貢献したかを
              正確に分解します。「展示タイムが0.05秒速かったため
              +0.12点」のように、 人間が理解できる根拠を提供できます。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>具体的なウォークスルー</h4>
            <p>
              例:
              住之江12Rで1号艇が展示タイムのレース内1位、全国勝率がメンバー中
              トップ（勝率のレース内差がプラス）、モーター2連率も上位の場合。
              LightGBM は過去データから「展示タイムが速い × 勝率上位 ×
              イン艇」の組み合わせを高評価するパターンを学習しており、
              1号艇に高いランクスコアを付与します。6艇のスコアをレース内
              softmax（温度は検証データでフィット）にかけて勝率に変換し、
              スコア順のランキングと診断ポイント（SHAP寄与上位）を表示します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>強み・弱み</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>表データで最高峰の精度</li>
                  <li>学習・推論が高速</li>
                  <li>欠損値を自動処理</li>
                  <li>SHAP で説明可能</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>時系列の流れを考慮しにくい</li>
                  <li>特徴量エンジニアリングに依存</li>
                  <li>外挿（未知レンジ）に弱い</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="explanation-detail-block">
            <h4>既存モデルとの違い</h4>
            <p>
              現行のヒューリスティック3モデルは人間が設計したルール（インコース有利など）を
              重み付けして使用しています。ワトソンはデータから直接ルールを発見するため、
              人間が気づいていない特徴量の組み合わせも活用できます。 同じ
              LightGBM を使うポアロ（V2）は「各艇が1着/2着/3着になるか」を
              艇ごとに独立に予測しますが、ワトソンは LambdaRank
              で「6艇の順序関係」そのものを1つのモデルで学習する点が異なります。
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default WatsonExplanation;
