function MoriartyDiagramDefsAndModels() {
  return (
    <>
      <defs>
        <marker
          id="moriarty-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#1f2937" />
        </marker>
      </defs>

      {/* 既存3モデルボックス */}
      <rect
        x="10"
        y="20"
        width="110"
        height="130"
        rx="6"
        fill="#f1f5f9"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <text
        x="65"
        y="46"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#1f2937"
        fontWeight="700"
      >
        既存3モデル
      </text>
      <text
        x="65"
        y="64"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#0284c7"
      >
        ● 本命狙い
      </text>
      <text
        x="65"
        y="80"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#9333ea"
      >
        ● スタンダード
      </text>
      <text
        x="65"
        y="96"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#ca8a04"
      >
        ● 穴狙い
      </text>
      <text
        x="65"
        y="116"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        生スコア出力
      </text>
      <text
        x="65"
        y="130"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        （未補正確率）
      </text>
    </>
  );
}

function MoriartyDiagramCalibration() {
  return (
    <>
      {/* 矢印1 */}
      <line
        x1="122"
        y1="85"
        x2="150"
        y2="85"
        stroke="#1f2937"
        strokeWidth="1.5"
        markerEnd="url(#moriarty-arrow)"
      />

      {/* キャリブレーションボックス */}
      <rect
        x="152"
        y="35"
        width="120"
        height="100"
        rx="6"
        fill="#f1f5f9"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <text
        x="212"
        y="64"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#1f2937"
        fontWeight="700"
      >
        キャリブレーション
      </text>
      <text
        x="212"
        y="82"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        オッズ条件付き校正
      </text>
      <text
        x="212"
        y="98"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        でスコア+オッズを
      </text>
      <text
        x="212"
        y="114"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        実確率に変換
      </text>

      {/* 矢印2 */}
      <line
        x1="274"
        y1="85"
        x2="302"
        y2="85"
        stroke="#1f2937"
        strokeWidth="1.5"
        markerEnd="url(#moriarty-arrow)"
      />
    </>
  );
}

function MoriartyDiagramEv() {
  return (
    <>
      {/* EV計算ボックス */}
      <rect
        x="304"
        y="35"
        width="120"
        height="100"
        rx="6"
        fill="#f1f5f9"
        stroke="#1f2937"
        strokeWidth="1.5"
      />
      <text
        x="364"
        y="64"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#1f2937"
        fontWeight="700"
      >
        EV計算
      </text>
      <text
        x="364"
        y="82"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        EV = 確率 × オッズ
      </text>
      <text
        x="364"
        y="98"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        EV &gt; 1.0 のみ
      </text>
      <text
        x="364"
        y="114"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#475569"
      >
        推奨対象に絞込
      </text>

      {/* 矢印3 */}
      <line
        x1="426"
        y1="85"
        x2="454"
        y2="85"
        stroke="#1f2937"
        strokeWidth="1.5"
        markerEnd="url(#moriarty-arrow)"
      />
    </>
  );
}

export {
  MoriartyDiagramDefsAndModels,
  MoriartyDiagramCalibration,
  MoriartyDiagramEv,
};
