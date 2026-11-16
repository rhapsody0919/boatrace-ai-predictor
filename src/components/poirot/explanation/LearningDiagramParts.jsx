// 図2の SVG の中身を分けた部品（LearningDiagram から分離）

import TreeGlyph from "./TreeGlyph";

function LearningDefs() {
  return (
    <>
      <defs>
        <marker
          id="poirot-arrow-g"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#059669" />
        </marker>
        <marker
          id="poirot-arrow-i"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L8,3 z" fill="#4f46e5" />
        </marker>
      </defs>

      {/* 中央の仕切り */}
      <line
        x1="350"
        y1="15"
        x2="350"
        y2="270"
        stroke="#cbd5e1"
        strokeWidth="1"
        strokeDasharray="4 4"
      />

    </>
  );
}

function LearningV1Trees() {
  return (
    <>
      {/* ===== 左: V1 ランダムフォレスト ===== */}
      <text
        x="175"
        y="30"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#059669"
        fontWeight="700"
      >
        V1 ランダムフォレスト
      </text>
      <text x="175" y="48" textAnchor="middle" fontSize="10" fill="#047857">
        「100本の木の多数決」
      </text>

      <TreeGlyph x={65} y={70} color="#059669" />
      <TreeGlyph x={140} y={70} color="#059669" />
      <TreeGlyph x={215} y={70} color="#059669" />
      <TreeGlyph x={290} y={70} color="#10b981" />
      <text x="65" y="122" textAnchor="middle" fontSize="8" fill="#047857">
        木1
      </text>
      <text x="140" y="122" textAnchor="middle" fontSize="8" fill="#047857">
        木2
      </text>
      <text x="215" y="122" textAnchor="middle" fontSize="8" fill="#047857">
        木3
      </text>
      <text x="290" y="122" textAnchor="middle" fontSize="8" fill="#047857">
        …木100
      </text>

      {/* 各木 → 平均 */}
      <line
        x1="65"
        y1="128"
        x2="150"
        y2="160"
        stroke="#059669"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-g)"
      />
      <line
        x1="140"
        y1="128"
        x2="168"
        y2="158"
        stroke="#059669"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-g)"
      />
      <line
        x1="215"
        y1="128"
        x2="185"
        y2="158"
        stroke="#059669"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-g)"
      />
      <line
        x1="290"
        y1="128"
        x2="203"
        y2="160"
        stroke="#059669"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-g)"
      />

    </>
  );
}

function LearningV1V2Mid() {
  return (
    <>
      <rect x="90" y="164" width="170" height="42" rx="6" fill="#059669" />
      <text
        x="175"
        y="182"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
        fontWeight="700"
      >
        100本の答えを平均
      </text>
      <text x="175" y="198" textAnchor="middle" fontSize="9" fill="#d1fae5">
        → 確率のできあがり
      </text>

      <text x="175" y="228" textAnchor="middle" fontSize="9" fill="#475569">
        各木はデータも見る特徴量もランダムに変えて学習。
      </text>
      <text x="175" y="243" textAnchor="middle" fontSize="9" fill="#475569">
        1本1本は粗くても、間違いが互いに打ち消し合い
      </text>
      <text x="175" y="258" textAnchor="middle" fontSize="9" fill="#475569">
        平均すると安定した予測になる（バギング）
      </text>

      {/* ===== 右: V2 LightGBM ===== */}
      <text
        x="525"
        y="30"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#4f46e5"
        fontWeight="700"
      >
        V2 LightGBM
      </text>
      <text x="525" y="48" textAnchor="middle" fontSize="10" fill="#4338ca">
        「間違いを直しながら積み上げ」
      </text>

      <TreeGlyph x={425} y={70} color="#4f46e5" />
      <line
        x1="452"
        y1="90"
        x2="478"
        y2="90"
        stroke="#4f46e5"
        strokeWidth="1.5"
        markerEnd="url(#poirot-arrow-i)"
      />
      <TreeGlyph x={510} y={70} color="#4f46e5" />
      <line
        x1="537"
        y1="90"
        x2="563"
        y2="90"
        stroke="#4f46e5"
        strokeWidth="1.5"
        markerEnd="url(#poirot-arrow-i)"
      />
      <TreeGlyph x={595} y={70} color="#6366f1" />
      <text
        x="640"
        y="94"
        textAnchor="middle"
        fontSize="12"
        fill="#4f46e5"
        fontWeight="700"
      >
        …
      </text>

      <text x="425" y="122" textAnchor="middle" fontSize="8" fill="#4338ca">
        木1: 大まかに予測
      </text>
      <text x="510" y="136" textAnchor="middle" fontSize="8" fill="#4338ca">
        木2: 木1の外した分を学習
      </text>
      <text x="595" y="122" textAnchor="middle" fontSize="8" fill="#4338ca">
        木3: さらに補正
      </text>

    </>
  );
}

function LearningV2Sum() {
  return (
    <>
      {/* 各木 → 合計 */}
      <line
        x1="425"
        y1="144"
        x2="495"
        y2="162"
        stroke="#4f46e5"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-i)"
      />
      <line
        x1="510"
        y1="144"
        x2="518"
        y2="158"
        stroke="#4f46e5"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-i)"
      />
      <line
        x1="595"
        y1="144"
        x2="545"
        y2="160"
        stroke="#4f46e5"
        strokeWidth="1.2"
        markerEnd="url(#poirot-arrow-i)"
      />

      <rect x="435" y="164" width="180" height="42" rx="6" fill="#4f46e5" />
      <text
        x="525"
        y="182"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
        fontWeight="700"
      >
        全部の木の合計
      </text>
      <text x="525" y="198" textAnchor="middle" fontSize="9" fill="#e0e7ff">
        → 確率のできあがり
      </text>

      <text x="525" y="228" textAnchor="middle" fontSize="9" fill="#475569">
        前の木が外した分「だけ」を次の木が学ぶ。
      </text>
      <text x="525" y="243" textAnchor="middle" fontSize="9" fill="#475569">
        数百本重ねると細かいパターンまで拾える
      </text>
      <text x="525" y="258" textAnchor="middle" fontSize="9" fill="#475569">
        （勾配ブースティング）
      </text>
    </>
  );
}

export { LearningDefs, LearningV1Trees, LearningV1V2Mid, LearningV2Sum };
