function MycroftDiagramDefs() {
  return (
    <>
      <defs>
        <marker
          id="mycroft-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#ca8a04" />
        </marker>
      </defs>

      {/* ===== 上段: 履歴系列の分岐 ===== */}
      <rect
        x="6"
        y="14"
        width="124"
        height="98"
        rx="6"
        fill="#fef9c3"
        stroke="#ca8a04"
        strokeWidth="1.5"
      />
      <text
        x="68"
        y="36"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#ca8a04"
        fontWeight="600"
      >
        選手の過去32走
      </text>
      <text
        x="68"
        y="56"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        1走 = 1トークン
      </text>
      <text
        x="68"
        y="74"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        着順・コース・ST
      </text>
      <text
        x="68"
        y="90"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        相手の強さ
      </text>
      <text
        x="68"
        y="106"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        経過日数・同じ節か
      </text>
    </>
  );
}

function MycroftDiagramSequenceEncoder() {
  return (
    <>
      <line
        x1="132"
        y1="62"
        x2="150"
        y2="62"
        stroke="#ca8a04"
        strokeWidth="1.5"
        markerEnd="url(#mycroft-arrow)"
      />

      <rect
        x="152"
        y="8"
        width="156"
        height="110"
        rx="6"
        fill="#fef9c3"
        stroke="#ca8a04"
        strokeWidth="1.5"
      />
      <text
        x="230"
        y="30"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#ca8a04"
        fontWeight="600"
      >
        ① フォームエンコーダ
      </text>
      <text
        x="230"
        y="50"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        Transformer 2層
      </text>
      <text
        x="230"
        y="66"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        self-attention で
      </text>
      <text
        x="230"
        y="82"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        調子の波を読む
      </text>
      <text
        x="230"
        y="104"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
        fontWeight="600"
      >
        → 今の状態（フォーム）
      </text>
    </>
  );
}

function MycroftDiagramStaticFeatures() {
  return (
    <>
      {/* ===== 下段: 静的特徴量の分岐 ===== */}
      <rect
        x="6"
        y="164"
        width="124"
        height="82"
        rx="6"
        fill="#fffbeb"
        stroke="#d9a441"
        strokeWidth="1.5"
      />
      <text
        x="68"
        y="188"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
        fontWeight="600"
      >
        静的特徴量 36項目
      </text>
      <text
        x="68"
        y="208"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        艇番・選手勝率
      </text>
      <text
        x="68"
        y="224"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        モーター・展示
      </text>
      <text
        x="68"
        y="240"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        気象（ワトソンと同じ）
      </text>
    </>
  );
}

function MycroftDiagramEmbedding() {
  return (
    <>
      <line
        x1="132"
        y1="204"
        x2="150"
        y2="204"
        stroke="#d9a441"
        strokeWidth="1.5"
        markerEnd="url(#mycroft-arrow)"
      />

      <rect
        x="152"
        y="176"
        width="156"
        height="58"
        rx="6"
        fill="#fffbeb"
        stroke="#d9a441"
        strokeWidth="1.5"
      />
      <text
        x="230"
        y="200"
        textAnchor="middle"
        fontSize="11"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
        fontWeight="600"
      >
        埋め込み
      </text>
      <text
        x="230"
        y="220"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        艇番・会場はカテゴリ扱い
      </text>

      {/* ===== 合流: 6艇の相互作用 ===== */}
      <line
        x1="310"
        y1="62"
        x2="336"
        y2="108"
        stroke="#ca8a04"
        strokeWidth="1.5"
        markerEnd="url(#mycroft-arrow)"
      />
      <line
        x1="310"
        y1="204"
        x2="336"
        y2="158"
        stroke="#d9a441"
        strokeWidth="1.5"
        markerEnd="url(#mycroft-arrow)"
      />
    </>
  );
}

export {
  MycroftDiagramDefs,
  MycroftDiagramSequenceEncoder,
  MycroftDiagramStaticFeatures,
  MycroftDiagramEmbedding,
};
