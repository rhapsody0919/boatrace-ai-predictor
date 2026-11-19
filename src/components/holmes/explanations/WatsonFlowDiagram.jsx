import watsonModel from "../../../../data/watson/model.json";

const N_FEATURES = watsonModel.n_features ?? 36;

function WatsonFlowDefs() {
  return (
    <>
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
    </>
  );
}

function WatsonFlowFeatures() {
  return (
    <>
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

    </>
  );
}

function WatsonFlowTrees() {
  return (
    <>
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

    </>
  );
}

function WatsonFlowScoreAndRank() {
  return (
    <>
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
    </>
  );
}

function WatsonFlowDiagram() {
  return (
      <div className="explanation-diagram">
        <svg
          viewBox="0 0 640 160"
          width="100%"
          height="auto"
          aria-label="ワトソン処理フロー図"
        >
          <WatsonFlowDefs />

          <WatsonFlowFeatures />
          <WatsonFlowTrees />
          <WatsonFlowScoreAndRank />
        </svg>
      </div>
  );
}

export default WatsonFlowDiagram;
