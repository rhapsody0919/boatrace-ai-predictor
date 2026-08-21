// ポアロ予想の「仕組みを知る」セクション（BOA-104）
// Holmes ページの explanations と同じ構成・スタイルを踏襲する
import "../holmes/explanations/ExplanationSection.css";

/** 決定木のミニアイコン（7ノードの二分木） */
function TreeGlyph({ x, y, color }) {
  return (
    <g transform={`translate(${x}, ${y})`} aria-hidden="true">
      {/* 枝 */}
      <line x1="0" y1="0" x2="-14" y2="18" stroke={color} strokeWidth="1.5" />
      <line x1="0" y1="0" x2="14" y2="18" stroke={color} strokeWidth="1.5" />
      <line
        x1="-14"
        y1="18"
        x2="-21"
        y2="36"
        stroke={color}
        strokeWidth="1.2"
      />
      <line x1="-14" y1="18" x2="-7" y2="36" stroke={color} strokeWidth="1.2" />
      <line x1="14" y1="18" x2="7" y2="36" stroke={color} strokeWidth="1.2" />
      <line x1="14" y1="18" x2="21" y2="36" stroke={color} strokeWidth="1.2" />
      {/* ノード */}
      <circle cx="0" cy="0" r="4.5" fill={color} />
      <circle cx="-14" cy="18" r="3.5" fill={color} />
      <circle cx="14" cy="18" r="3.5" fill={color} />
      <circle cx="-21" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="-7" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="7" cy="36" r="2.5" fill={color} opacity="0.7" />
      <circle cx="21" cy="36" r="2.5" fill={color} opacity="0.7" />
    </g>
  );
}

function PoirotExplanation() {
  return (
    <section className="explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        ポアロ予想は、過去2年分・約14万レースの実戦データから学習した
        <strong>機械学習モデル</strong>です。人間がルールを書くのではなく、
        「どんな条件の艇が何着に来たか」をAIが自分で見つけ出します。
        6艇それぞれの「1着になる確率・2着になる確率・3着になる確率」を計算し、
        3連単120通りの中から最も起こりやすい並びを1点だけ提示します。
        学習アルゴリズムの異なる V1（ランダムフォレスト）と
        V2（LightGBM）の2機を並走させ、タブで比較できます。
      </p>

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
            約14万レース
          </text>
          <text x="80" y="76" textAnchor="middle" fontSize="9" fill="#5b21b6">
            （2024年〜現在）
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

      <ul className="explanation-key-points">
        <li>
          {/* #7c3aedはダーク時のカード背景で2.6:1しかなくAA未達のため両テーマ対応の銀トークンに変更 */}
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            ルールを書かない、データに聞く
          </span>
          —— 既存の本命/スタンダード/穴モデルは人間が設計したスコア計算。
          ポアロは約14万レースの結果そのものから「勝ちパターン」を自動で学習します
        </li>
        <li>
          {/* #2563ebはダーク時のカード背景で2.87:1しかなくAA未達のため両テーマ対応の銀トークンに変更 */}
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            1着・2着・3着を別々のAIで予測
          </span>
          —— ボートレースは「1着を取る力」と「2〜3着に粘る力」が別物
          （逃げ切る1号艇、差して2着の2号艇など）。役割別に3つのモデルを分けるのが精度の鍵です
        </li>
        <li>
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            {/* #d97706は白背景で3.18:1未達、濃色化した#92400eもダークカードで2.10:1未達だったため
                両テーマ対応の銀トークンに変更（axe-core検出） */}
            確率は「校正済み」
          </span>
          —— 予測確率10%のレース群は実際に約10%的中することを検証済み。
          信頼度バッジ（高/中/低）はこの校正された確率に基づきます
        </li>
        <li>
          {/* #db2777はライトカードで4.36:1・ダーク時はさらに未達のため両テーマ対応の銀トークンに変更 */}
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            成績は誇張なしで公開
          </span>
          —— 2万レースの検証で単勝ベタ買い回収率90%・3連単78〜80%
          （還元率75%が理論上の平均）。まだ100%は超えておらず、
          超えるための期待値フィルタを開発中です（下の詳細参照）
        </li>
      </ul>

      {/* ============================================================ */}
      {/* 図2: V1 と V2 の学習方法の違い                                */}
      {/* ============================================================ */}
      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 285"
          width="100%"
          height="auto"
          aria-label="V1ランダムフォレストとV2 LightGBMの違い: V1は多数の決定木の平均、V2は誤差を順番に補正する木の合計"
        >
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
        </svg>
      </div>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>なぜ「1着・2着・3着」を別々のAIにするのか</h4>
            <p>
              1着確率だけから3連単を組むと精度が出ません。ボートレースでは
              「勝つ力」と「2〜3着に残る力」が本質的に別物だからです
              （インから逃げ切るタイプ、外から差して2着を拾うタイプなど）。
              そこで P(1着)・P(2着)・P(3着) を独立に学習し、 Plackett-Luce
              法で並びの確率に組み立てます。
              実際、この3ヘッド化だけで3連単の回収率が大きく改善しました。
            </p>
            <code className="explanation-formula">
              P(i→j→k) = P₁(i)/ΣP₁ × P₂(j)/(ΣP₂−P₂(i)) × P₃(k)/(ΣP₃−P₃(i)−P₃(j))
            </code>
            <p>
              意味:
              「iが1着」×「iを除いた中でjが2着」×「i,jを除いた中でkが3着」。
              これを120通り全部計算し、最大のものを買い目として表示します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>V1: ランダムフォレストとは</h4>
            <p>
              「はい/いいえ」の質問を繰り返して答えにたどり着く
              <strong>決定木</strong>
              （例:「1号艇の勝率は6.0以上？」→「展示タイムはレース内1位？」→
              1着確率高）を、
              データと特徴量を毎回ランダムに変えながら100本育て、答えを平均します。
              1本の木は覚えすぎ（過学習）で不安定ですが、ランダムに違う100本の
              間違いは方向がバラバラなので、平均すると打ち消し合う——
              これが「フォレスト（森）」の原理です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>V2: LightGBM（勾配ブースティング）とは</h4>
            <p>
              木を並列に育てる代わりに、<strong>順番に</strong>育てます。
              1本目が大まかに予測 → 2本目は「1本目が外した分（誤差）」だけを学習
              →
              3本目はさらに残った誤差を学習…と数百回繰り返し、全部を足し合わせます。
              表形式データの機械学習では現在の世界標準で、
              データ分析コンペ（Kaggle等）の優勝常連手法です。
              検証データで精度が伸びなくなった時点で自動停止し、過学習を防ぎます。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>確率の校正（isotonic回帰）と信頼度バッジ</h4>
            <p>
              AIの出す「生の確率」は過信・過小評価の癖があるため、
              学習に使っていない検証データで「予測10%のグループは実際何%当たったか」を測り、
              ズレを補正します。補正後は予測確率と実測的中率がほぼ一致することを
              確認済み（例: 予測13.6% → 実測13.1%）。
              画面の信頼度バッジはこの校正済み確率で、
              <strong>高 = 3連単の予測確率10%以上</strong>
              （120通りの平均は0.83%なので約12倍）、 中 = 5〜10%、低 =
              5%未満です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>学習データとカンニング防止</h4>
            <p>
              2024年1月〜現在の約14万レース・74万艇分。公式サイトの
              番組表・競走成績アーカイブと自前収集データ（展示・気象・ST）を結合しています。
              評価で最も重要なのは「未来のカンニング」を防ぐこと: 学習は必ず
              <strong>過去→未来の時系列分割</strong>で行い、
              「直近30走の平均ST」のような履歴系の特徴量も、
              そのレースより前の情報だけから計算します。
              毎週日曜の未明に最新データで自動的に学習し直します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>
              実測パフォーマンス（テスト20,704レース・学習に未使用の期間）
            </h4>
            <p>
              1着予測のAUC（識別力の指標、0.5=当てずっぽう〜1.0=完璧）は
              V1が0.840、V2が0.847。単勝をベタ買いした場合の回収率は両機90%
              （何も考えずに買うと還元率75%に収束するので、+15ポイントの上乗せ）。
              3連単1点ベタ買いはV1 80.0%・V2 77.9%、 信頼度「高」に絞るとV1
              83.6%・V2 90.3%です。
              <strong>まだどの戦略も回収率100%は超えていません</strong>。
              これは誇張のない実測値です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>強み・弱み</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>約14万レースからの自動学習（ルール手書きなし）</li>
                  <li>確率が校正済みで「信頼度」に意味がある</li>
                  <li>2〜3着専用モデルで3連単の組み立てが得意</li>
                  <li>毎週自動で学び直し、毎日3回予想を更新</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>回収率100%超は未達（最良でも約90%）</li>
                  <li>オッズをまだ使っておらず「人気の盲点」を狙えない</li>
                  <li>展示データが出る前の予想は精度が落ちる</li>
                  <li>節間の調子・隊形変化など反映できない情報も残る</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="explanation-detail-block">
            <h4>次の一手: 期待値フィルタ（開発中）</h4>
            <p>
              舟券は的中率ではなく<strong>「確率 × オッズ」の期待値</strong>
              で決まります。
              予測確率10%の買い目でも、オッズが15倍付いていれば期待値1.5（買い）、
              8倍なら0.8（見送り）。現在、締切直前の3連単全120通りのオッズを
              毎日自動収集しており、蓄積でき次第「モデルの確率が市場の評価を上回る
              買い目だけを狙う」期待値フィルタを実装します。
              これが回収率100%の壁を超えるための本命ルートです
              （香港競馬で長期利益を実証した Benter (1994) と同じ考え方）。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>ホームズ予想（シャーロック等）との違い</h4>
            <p>
              シャーロックは「実力×市場オッズ」を統計的に融合する
              <strong>解釈しやすい線形モデル</strong>
              で、ブラウザ内で推論します。 ポアロは
              <strong>非線形の機械学習</strong>をサーバー側で学習させ、
              特徴量同士の複雑な組み合わせ（例:「強風×アウトコース×展示1位」）を
              自動で拾いにいく設計です。アプローチの異なる2系統を並走させ、
              成績で競わせています。
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default PoirotExplanation;
