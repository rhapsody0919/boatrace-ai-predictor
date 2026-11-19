// 上段: 実力ルート（入力〜）
function SherlockFlowSkillInputRoute() {
  return (
    <>
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
    </>
  );
}

// 上段: 実力ルート（モデル〜出力）
function SherlockFlowSkillModelRoute() {
  return (
    <>
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
    </>
  );
}

// 下段: 市場ルート（入力〜）
function SherlockFlowMarketInputRoute() {
  return (
    <>
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
    </>
  );
}

// 下段: 市場ルート（オッズ〜出力）
function SherlockFlowMarketOddsRoute() {
  return (
    <>
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
    </>
  );
}

// 合流 → 結合
function SherlockFlowMergeCombine() {
  return (
    <>
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
    </>
  );
}

// 最終出力
function SherlockFlowFinalOutput() {
  return (
    <>
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
    </>
  );
}

export {
  SherlockFlowSkillInputRoute,
  SherlockFlowSkillModelRoute,
  SherlockFlowMarketInputRoute,
  SherlockFlowMarketOddsRoute,
  SherlockFlowMergeCombine,
  SherlockFlowFinalOutput,
};
