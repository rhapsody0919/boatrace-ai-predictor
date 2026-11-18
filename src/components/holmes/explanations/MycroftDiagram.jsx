import {
  MycroftDiagramDefs,
  MycroftDiagramSequenceEncoder,
  MycroftDiagramStaticFeatures,
  MycroftDiagramEmbedding,
} from "./MycroftDiagramLayers";

function MycroftDiagramInteraction() {
  return (
    <>
      <rect
        x="342"
        y="70"
        width="160"
        height="126"
        rx="6"
        fill="#fef3c7"
        stroke="#ca8a04"
        strokeWidth="2"
      />
      <text
        x="422"
        y="94"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#ca8a04"
        fontWeight="600"
      >
        ② 6艇の相互作用
      </text>
      <text
        x="422"
        y="114"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        set-attention
      </text>
      <text
        x="422"
        y="134"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        6艇を見比べる
      </text>
      <text
        x="422"
        y="154"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        「誰が誰に
      </text>
      <text
        x="422"
        y="170"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#92400e"
      >
        沈められるか」
      </text>
      <text
        x="422"
        y="188"
        textAnchor="middle"
        fontSize="9"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
      >
        ※ 並び順に依存しない
      </text>
    </>
  );
}

function MycroftDiagramOutput() {
  return (
    <>
      <line
        x1="504"
        y1="133"
        x2="522"
        y2="133"
        stroke="#ca8a04"
        strokeWidth="1.5"
        markerEnd="url(#mycroft-arrow)"
      />

      {/* ===== 出力 ===== */}
      <rect
        x="524"
        y="96"
        width="110"
        height="74"
        rx="6"
        fill="#ca8a04"
        stroke="#ca8a04"
        strokeWidth="1.5"
      />
      <text
        x="579"
        y="120"
        textAnchor="middle"
        fontSize="12"
        fontFamily="system-ui, sans-serif"
        fill="#ffffff"
        fontWeight="600"
      >
        ③ 順位・勝率
      </text>
      <text
        x="579"
        y="140"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#fef9c3"
      >
        Plackett-Luce
      </text>
      <text
        x="579"
        y="158"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#fef9c3"
      >
        1位〜6位
      </text>

      {/* ===== 説明性の注記（線で結ぶと「埋め込み」ボックスを貫通するため独立表示） ===== */}
      <rect
        x="342"
        y="206"
        width="292"
        height="52"
        rx="4"
        fill="#fffbeb"
        stroke="#d9a441"
        strokeWidth="1"
      />
      <text
        x="488"
        y="226"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
        fontWeight="600"
      >
        ① の「どの過去走を重視したか」の重みが
      </text>
      <text
        x="488"
        y="244"
        textAnchor="middle"
        fontSize="10"
        fontFamily="system-ui, sans-serif"
        fill="#a16207"
        fontWeight="600"
      >
        タブの「マイクロフトの記憶」になる
      </text>
    </>
  );
}

function MycroftDiagram() {
  return (
    <div className="explanation-diagram">
      <svg
        viewBox="0 0 640 266"
        width="100%"
        height="auto"
        aria-label="マイクロフト処理フロー図: 選手の過去32走をフォームエンコーダで読み、静的特徴量と合わせて6艇の相互作用にかけ、順位と勝率を出力する"
      >
        <MycroftDiagramDefs />
        <MycroftDiagramSequenceEncoder />
        <MycroftDiagramStaticFeatures />
        <MycroftDiagramEmbedding />
        <MycroftDiagramInteraction />
        <MycroftDiagramOutput />
      </svg>
    </div>
  );
}

export default MycroftDiagram;
