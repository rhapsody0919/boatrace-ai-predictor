import {
  MoriartyDiagramDefsAndModels,
  MoriartyDiagramCalibration,
  MoriartyDiagramEv,
} from "./MoriartyDiagramLayers";

function MoriartyDiagramKelly() {
  return (
    <>
      {/* Kellyボックス */}
      <rect
        x="456"
        y="35"
        width="110"
        height="100"
        rx="6"
        fill="#f1f5f9"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <text
        x="511"
        y="64"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#1f2937"
        fontWeight="700"
      >
        Kelly基準
      </text>
      <text
        x="511"
        y="82"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        最適ベット額を
      </text>
      <text
        x="511"
        y="98"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        数学的に算出
      </text>
      <text
        x="511"
        y="114"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        Half Kelly推奨
      </text>

      {/* 矢印4 */}
      <line
        x1="568"
        y1="85"
        x2="596"
        y2="85"
        stroke="#1f2937"
        strokeWidth="1.5"
        markerEnd="url(#moriarty-arrow)"
      />
    </>
  );
}

function MoriartyDiagramOutput() {
  return (
    <>
      {/* 出力ボックス */}
      <rect
        x="598"
        y="20"
        width="92"
        height="130"
        rx="6"
        fill="#1f2937"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <text
        x="644"
        y="52"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
        fontWeight="700"
      >
        推奨レース
      </text>
      <text
        x="644"
        y="70"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#e2e8f0"
      >
        賭け式
      </text>
      <text
        x="644"
        y="86"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#e2e8f0"
      >
        EV値
      </text>
      <text
        x="644"
        y="102"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#e2e8f0"
      >
        ベット額
      </text>
      <text
        x="644"
        y="118"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#94a3b8"
      >
        （資金の%）
      </text>
    </>
  );
}

function MoriartyDiagram() {
  return (
    <div className="explanation-diagram">
      <svg
        viewBox="0 0 700 170"
        width="100%"
        height="auto"
        aria-label="モリアーティ処理フロー図"
      >
        <MoriartyDiagramDefsAndModels />
        <MoriartyDiagramCalibration />
        <MoriartyDiagramEv />
        <MoriartyDiagramKelly />
        <MoriartyDiagramOutput />
      </svg>
    </div>
  );
}

export default MoriartyDiagram;
