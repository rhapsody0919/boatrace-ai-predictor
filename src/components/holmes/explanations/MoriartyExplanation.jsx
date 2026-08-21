import "./ExplanationSection.css";

function MoriartyExplanation() {
  return (
    <section className="holmes-section explanation-section">
      <h3>仕組みを知る</h3>

      <p className="explanation-summary">
        既存3モデル（本命狙い・スタンダード・穴狙い）の予測を「本物の確率」に補正し、
        オッズと組み合わせて「儲かるレース」と「最適ベット額」を算出するメタモデルです。
        将来ワトソン等の新モデルが採用されれば、その出力も同じ仕組みで統合されます。
      </p>

      <div className="explanation-diagram">
        <svg
          viewBox="0 0 700 170"
          width="100%"
          height="auto"
          aria-label="モリアーティ処理フロー図"
        >
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
        </svg>
      </div>

      <ul className="explanation-key-points">
        <li>
          他3モデルは「誰が勝つか」を予想するが、
          {/* #1f2937はダーク時のカード背景で1.01:1（ほぼ不可視）だったためテーマ連動色に変更 */}
          <span style={{ color: "var(--text-primary)", fontWeight: "600" }}>
            モリアーティは「どう賭ければ儲かるか」
          </span>
          を計算するメタモデル
        </li>
        <li>
          オッズ条件付きロジスティック校正で、AIスコアと市場オッズから
          実際の的中確率を推定（キャリブレーション）
        </li>
        <li>
          EV（期待値）が1.0超のレースのみを推奨し、控除率25%を上回るエッジを狙う
        </li>
        <li>Kelly基準で資金の最適配分を数学的に決定し、破産リスクを制御</li>
      </ul>

      <details className="explanation-details">
        <summary>詳しい仕組みを見る</summary>
        <div className="explanation-detail-body">
          <div className="explanation-detail-block">
            <h4>なぜ「メタモデル」か</h4>
            <p>
              ベースとなる予想モデル（現在は本命狙い・スタンダード・穴狙いの既存3モデル）は
              「順位予想」に特化しており、
              出力スコアは「本物の確率」として使うには補正が必要です。
              また「正確に順位を当てる」ことと「長期的に儲かる」ことは別問題です。
              モリアーティはこの2つのギャップを埋めるメタモデルとして機能します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>オッズ条件付きキャリブレーション</h4>
            <p>
              過去の実績データから「AIスコアと市場オッズの組み合わせごとの
              実際の的中率」をロジスティック回帰で学習します。
              スコア単独の校正では「どんなオッズの買い目か」を無視してしまい、
              大穴の買い目に平均的な的中率を適用して期待値を過大評価します。
              市場オッズを条件に含めることで、期待値が1.0を超えるのは
              「AIスコアが市場の評価に上乗せする情報を持つ場合」だけになります
              （香港競馬で実証された Benter の二段階モデルと同じ構造です）。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>EV（期待値）計算</h4>
            <p>
              補正後の実確率 p とオッズ b（払戻倍率）から期待値を計算します。
            </p>
            <code className="explanation-formula">EV = p × b</code>
            <p>
              EV &gt; 1.0 は「1円賭けると平均1円以上戻る」=
              長期的に利益が出る状態です。 ボートレースの控除率は約25%なので、
              EV &gt; 1.0
              を実現するには補正確率がオッズに対して十分高い必要があります。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>Kelly 基準と Half Kelly</h4>
            <p>
              期待値がプラスのとき、資金の何割を賭けるべきかを数学的に最大化する公式です。
            </p>
            <code className="explanation-formula">
              f* = (b·p - q) / b　　（q = 1 - p）
            </code>
            <p>
              ただしフルKellyは確率推定の誤差が大きい場合に過大なベットになりがちです。
              実際には Half Kelly（f*/2）を推奨しており、
              長期リターンをやや犠牲にしつつ、破産リスクを大幅に低減します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>具体的なウォークスルー</h4>
            <p>
              例: 住之江8R の「1-3連単」、アドラー生スコア →
              キャリブレーション後 p=0.18、オッズ b=7.2 の場合：
            </p>
            <code className="explanation-formula">
              EV = 0.18 × 7.2 = 1.30　（30%のエッジあり）
            </code>
            <code className="explanation-formula">
              f* = (7.2 × 0.18 - 0.82) / 7.2 = 0.066 → Half Kelly: 資金の3.3%
            </code>
            <p>
              EV=1.30で推奨条件を満たすため、「3.3%を賭ける」と推奨されます。
              これを多数のレースで繰り返すことで、長期的に資金が増加します。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>控除率25%を上回る仕組み</h4>
            <p>
              ボートレースの総還元率は約75%（控除率25%）です。
              ランダムに賭け続ければ資金は0.75倍に収束します。
              モリアーティは「市場のオッズが過小評価しているレース」＝
              実際の勝率よりオッズが高いレースを選別して賭けることで、 EV &gt;
              1.0 のレースだけに絞り込みます。
              少数の高EV機会に集中することがカギです。
            </p>
          </div>

          <div className="explanation-detail-block">
            <h4>なぜ既存モデルより優れているか</h4>
            <div className="explanation-pros-cons">
              <div className="explanation-pros">
                <h5>強み</h5>
                <ul>
                  <li>確率とオッズを統合して判断</li>
                  <li>長期的な収益最大化を直接目標</li>
                  <li>複数モデルの出力を統合</li>
                  <li>ベット額を自動決定</li>
                </ul>
              </div>
              <div className="explanation-cons">
                <h5>弱み</h5>
                <ul>
                  <li>ベースモデルの精度に依存</li>
                  <li>キャリブレーションに過去データが必要</li>
                  <li>レース数が少ないと統計的に不安定</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}

export default MoriartyExplanation;
