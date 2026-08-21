import "./ExplanationSection.css";
import mycroftModel from "../../../../data/mycroft/model.json";

const MAX_HISTORY = mycroftModel.max_history ?? 32;

function MycroftExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        各選手の過去{MAX_HISTORY}走を時系列としてTransformerに入力し、
        Self-attentionでフォームの変化・節間の調子・相手文脈を捕捉します。
        さらに6艇の「フォーム」同士を相互作用させ、
        誰が誰に沈められるかというレース展開まで含めて順位を予測します。
      </p>

      <div className="explanation-diagram">
        <svg
          viewBox="0 0 640 266"
          width="100%"
          height="auto"
          aria-label="マイクロフト処理フロー図: 選手の過去32走をフォームエンコーダで読み、静的特徴量と合わせて6艇の相互作用にかけ、順位と勝率を出力する"
        >
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
        </svg>
      </div>

      <ul className="explanation-key-points">
        <li>
          <span style={{ color: "var(--brand-accent-secondary)" }}>
            Self-attention
          </span>{" "}
          により、
          「3節前から調子が落ちている」「特定のコースで強い」という時系列パターンを自動発見
        </li>
        <li>
          集約統計（平均着順など）では失われる「最近の変化」と「流れ」を学習
        </li>
        <li>
          6艇のフォームに{" "}
          <span style={{ color: "var(--brand-accent-secondary)" }}>
            set-attention
          </span>{" "}
          をかけ、「強い選手が誰に沈められるか」というレース内の相互作用を捉える
        </li>
        <li>
          attention の重みから
          <strong>「どの過去走を根拠にしたか」</strong>
          を取り出せる（タブの「マイクロフトの記憶」）
        </li>
      </ul>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>Transformer とは</h4>
            <p>
              2017年に提案された Self-attention
              機構を中心とするニューラルネットアーキテクチャです。
              元々は自然言語処理のために開発されましたが、
              「系列データの長距離依存関係を捕捉する」能力から時系列データにも広く適用されています。
              LSTMやGRUと異なり、系列全体を並列に処理できるため学習が高速です。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>Self-attention の仕組み</h4>
            <p>
              各レース記録 (Query) が過去の全レース記録 (Key)
              との関連度を計算し、 重み付き和 (Value)
              としてコンテキスト情報を集約します。
            </p>
            <code className="explanation-formula">
              Attention(Q, K, V) = softmax(Q·Kᵀ / √d_k) · V
            </code>
            <p>
              例えば「2週前の節で大崩れした戦」に注目すれば、
              「現在の調子が一時的に落ちているパターン」を学習できます。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>Position Encoding</h4>
            <p>
              Self-attention は本来、順序を考慮しません。
              そこで各レース記録に「何戦前か」を示す位置情報を加算することで、
              時間的な前後関係を保持します。
              サイン・コサイン関数を使う固定エンコーディングや、
              学習可能な埋め込み (Learnable PE) を使用します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>選手 Embedding</h4>
            <p>
              各選手に固有のベクトル (Embedding) を割り当て、
              「この選手はイン艇でのスタートが得意」「向かい風で成績が落ちやすい」という
              選手固有の傾向をパラメータとして学習します。
              レース記録のエンコードに加算することで、過去戦の文脈と選手特性を統合します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>具体的なウォークスルー</h4>
            <p>
              選手Aの直近{MAX_HISTORY}走をTransformerに入力すると： 1)
              各走を「着順・進入コース・会場・本番ST・展示順位・相手の強さ・
              何日前か・同じ節か」を束ねた1トークンに変換。 2)
              Self-attentionが「直近数走で着順が上向き」「この会場では毎回好走」
              といったパターンを検出。 3) attention pooling
              で1本の「フォーム埋め込み」に集約（このときの重みが
              「マイクロフトの記憶」として表示される根拠）。 4)
              6艇ぶんのフォームを相互作用させ、レース全体の順位スコアを出力。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>リーク（未来の情報の混入）を防ぐ工夫</h4>
            <p>
              系列モデルは過去参照の実装を誤ると簡単に未来の情報が漏れ、
              検証成績だけが良く見える状態になります。マイクロフトでは
              <strong>対象レースより厳密に過去の日付</strong>
              の走のみをトークンにし（同日レースは
              race_idの並び順が時刻順でないため除外）、
              選手IDが不明な走は「他人の履歴」が混ざらないよう履歴なしとして扱います。
              これらは学習のたびに自動検証しています。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>強み・弱み</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>時系列の流れ・フォームを捕捉</li>
                  <li>長距離依存関係を学習可能</li>
                  <li>並列処理で学習高速</li>
                  <li>大規模データで真価を発揮</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>十分な履歴データが必要</li>
                  <li>過学習リスクが高い</li>
                  <li>単独精度がGBDTを超えるとは限らない</li>
                  <li>履歴の薄い新人選手に弱い</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="explanation-detail-block">
            <h4>なぜ最後に実装したか</h4>
            <p>
              Transformerは大量のデータがあるほど真価を発揮するため、
              当初は「データ蓄積待ち」として見送っていました。公式アーカイブの
              過去データを取り込んだ結果、直近に出走している選手の履歴が
              中央値で500走を超え、系列{MAX_HISTORY}走はほぼ全選手で
              埋まる状態になったため着手しています。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>価値の測り方（正直な指標）</h4>
            <p>
              マイクロフトが読むのは「履歴の並び」という
              <strong>他のモデルが見ていない情報</strong>
              です。したがって単独の的中率がワトソンを上回るかよりも、
              <strong>ワトソンと併用したときに改善するか</strong>
              （アンサンブル増分）のほうが本質的な検定になります。
              単独精度が同等でも、両者を組み合わせて予測が良くなるなら、
              系列は本当に新しい情報を持っていたことになります。
              タブ上部にはこの増分を実測値として表示しています。
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

export default MycroftExplanation;
