// 図1: 予想ができるまでの全体フロー（PoirotExplanation から分離）

function FlowDiagram() {
  return (
    <>
      {/* ============================================================ */}
      {/* 図1: 予想ができるまでの全体フロー                              */}
      {/* ============================================================ */}
      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 330"
          width="100%"
          height="auto"
          aria-label="ポアロ予想の処理フロー図: 過去データから特徴量を作り、3つのAIヘッドで着順確率を推定し、校正とPlackett-Luce展開を経て買い目1点を出力する"
        >
          <defs>
            <marker
              id="poirot-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L8,3 z" fill="#7c3aed" />
            </marker>
          </defs>

          {/* --- ① 過去データ --- */}
          <rect
            x="10"
            y="20"
            width="140"
            height="112"
            rx="6"
            fill="#ede9fe"
            stroke="#7c3aed"
            strokeWidth="1.5"
          />
          <text
            x="80"
            y="42"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#6d28d9"
            fontWeight="700"
          >
            過去の実戦データ
          </text>
          <text x="80" y="62" textAnchor="middle" fontSize="9" fill="#5b21b6">
            全レース
          </text>
          <text x="80" y="76" textAnchor="middle" fontSize="9" fill="#5b21b6">
            （2025年12月〜）
          </text>
          <text x="80" y="94" textAnchor="middle" fontSize="9" fill="#5b21b6">
            着順・払戻・展示
          </text>
          <text x="80" y="108" textAnchor="middle" fontSize="9" fill="#5b21b6">
            気象・ST・選手成績
          </text>

          <line
            x1="152"
            y1="76"
            x2="176"
            y2="76"
            stroke="#7c3aed"
            strokeWidth="1.5"
            markerEnd="url(#poirot-arrow)"
          />

          {/* --- ② 特徴量 --- */}
          <rect
            x="180"
            y="20"
            width="150"
            height="112"
            rx="6"
            fill="#ede9fe"
            stroke="#7c3aed"
            strokeWidth="1.5"
          />
          <text
            x="255"
            y="42"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#6d28d9"
            fontWeight="700"
          >
            36個の特徴量
          </text>
          <text x="255" y="62" textAnchor="middle" fontSize="9" fill="#5b21b6">
            選手勝率・級別・年齢
          </text>
          <text x="255" y="76" textAnchor="middle" fontSize="9" fill="#5b21b6">
            モーター/ボート2連率
          </text>
          <text x="255" y="90" textAnchor="middle" fontSize="9" fill="#5b21b6">
            展示タイム・展示ST
          </text>
          <text x="255" y="104" textAnchor="middle" fontSize="9" fill="#5b21b6">
            ST履歴・風・波・会場
          </text>
          <text x="255" y="118" textAnchor="middle" fontSize="9" fill="#5b21b6">
            レース内の相対順位
          </text>

          <line
            x1="332"
            y1="76"
            x2="366"
            y2="76"
            stroke="#7c3aed"
            strokeWidth="1.5"
            markerEnd="url(#poirot-arrow)"
          />

          {/* --- ③ 3つのヘッド --- */}
          <rect
            x="370"
            y="22"
            width="140"
            height="30"
            rx="5"
            fill="#dbeafe"
            stroke="#2563eb"
            strokeWidth="1.5"
          />
          <text
            x="440"
            y="41"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#1d4ed8"
            fontWeight="700"
          >
            P(1着) を出すAI
          </text>
          <rect
            x="370"
            y="60"
            width="140"
            height="30"
            rx="5"
            fill="#dbeafe"
            stroke="#2563eb"
            strokeWidth="1.5"
          />
          <text
            x="440"
            y="79"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#1d4ed8"
            fontWeight="700"
          >
            P(2着) を出すAI
          </text>
          <rect
            x="370"
            y="98"
            width="140"
            height="30"
            rx="5"
            fill="#dbeafe"
            stroke="#2563eb"
            strokeWidth="1.5"
          />
          <text
            x="440"
            y="117"
            textAnchor="middle"
            fontSize="10"
            fontFamily="system-ui, sans-serif"
            fill="#1d4ed8"
            fontWeight="700"
          >
            P(3着) を出すAI
          </text>
          <text x="440" y="146" textAnchor="middle" fontSize="9" fill="#64748b">
            6艇それぞれに 3つの確率
          </text>

          <line
            x1="512"
            y1="76"
            x2="543"
            y2="76"
            stroke="#7c3aed"
            strokeWidth="1.5"
            markerEnd="url(#poirot-arrow)"
          />

          {/* --- ④ 校正 --- */}
          <rect
            x="547"
            y="36"
            width="143"
            height="80"
            rx="6"
            fill="#fef3c7"
            stroke="#d97706"
            strokeWidth="1.5"
          />
          <text
            x="618"
            y="58"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#b45309"
            fontWeight="700"
          >
            確率の校正
          </text>
          <text x="618" y="76" textAnchor="middle" fontSize="9" fill="#92400e">
            「10%」と言ったら
          </text>
          <text x="618" y="90" textAnchor="middle" fontSize="9" fill="#92400e">
            本当に10%当たるよう
          </text>
          <text x="618" y="104" textAnchor="middle" fontSize="9" fill="#92400e">
            実測値で補正
          </text>

          {/* 校正 → PL展開（下段へ） */}
          <line
            x1="618"
            y1="118"
            x2="600"
            y2="166"
            stroke="#7c3aed"
            strokeWidth="1.5"
            markerEnd="url(#poirot-arrow)"
          />

          {/* --- ⑤ Plackett-Luce 展開 --- */}
          <rect
            x="400"
            y="170"
            width="290"
            height="72"
            rx="6"
            fill="#fce7f3"
            stroke="#db2777"
            strokeWidth="1.5"
          />
          <text
            x="545"
            y="192"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#be185d"
            fontWeight="700"
          >
            着順の組み立て（Plackett-Luce法）
          </text>
          <text x="545" y="212" textAnchor="middle" fontSize="9" fill="#9d174d">
            「1着はA」×「Aを除いて2着はB」×「残りから3着はC」
          </text>
          <text x="545" y="228" textAnchor="middle" fontSize="9" fill="#9d174d">
            を掛け算して 3連単120通り全部の確率を計算
          </text>

          <line
            x1="398"
            y1="206"
            x2="362"
            y2="206"
            stroke="#7c3aed"
            strokeWidth="1.5"
            markerEnd="url(#poirot-arrow)"
          />

          {/* --- ⑥ 出力 --- */}
          <rect
            x="80"
            y="170"
            width="280"
            height="72"
            rx="6"
            fill="#5b21b6"
            stroke="#5b21b6"
          />
          <text
            x="220"
            y="194"
            textAnchor="middle"
            fontSize="11"
            fontFamily="system-ui, sans-serif"
            fill="#ffffff"
            fontWeight="700"
          >
            本日の買い目 1点 ＋ 信頼度
          </text>
          <text x="220" y="212" textAnchor="middle" fontSize="9" fill="#ddd6fe">
            最も確率の高い並びを表示（例: 1-3-5 予測確率15.5%）
          </text>
          <text x="220" y="228" textAnchor="middle" fontSize="9" fill="#ddd6fe">
            信頼度バッジ: 高 = 10%以上 / 中 = 5〜10% / 低 = 5%未満
          </text>

          {/* 脚注 */}
          <text
            x="350"
            y="290"
            textAnchor="middle"
            fontSize="10"
            fill="#64748b"
          >
            この流れを V1・V2 の2つのAIが独立に実行 ——
            学習し直しは毎週、予想の更新は毎日3回
          </text>
          <text x="350" y="308" textAnchor="middle" fontSize="9" fill="#94a3b8">
            （展示タイムはレース直前にしか出ないため、朝・昼・夕方に再計算して反映）
          </text>
        </svg>
      </div>
    </>
  );
}

export default FlowDiagram;
