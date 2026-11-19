function FlowFeaturesBox() {
  return (
    <>
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
    </>
  );
}

function FlowSherlockBox() {
  return (
    <>
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
    </>
  );
}

function FlowWinRateBox() {
  return (
    <>
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
    </>
  );
}

function FlowPlDistributionBox() {
  return (
    <>
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
    </>
  );
}

function FlowArrow1() {
  return (
    <>
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
    </>
  );
}

function FlowArrow2() {
  return (
    <>
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
    </>
  );
}

function FlowArrow3() {
  return (
    <>
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
    </>
  );
}

function AdlerFlowDiagram() {
  return (
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

          <FlowFeaturesBox />
          <FlowArrow1 />
          <FlowSherlockBox />
          <FlowArrow2 />
          <FlowWinRateBox />
          <FlowArrow3 />
          <FlowPlDistributionBox />
        </svg>
    </div>
  );
}

export default AdlerFlowDiagram;
