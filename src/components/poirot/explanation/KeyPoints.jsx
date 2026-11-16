// 図1の下の要点リスト（PoirotExplanation から分離）

function KeyPoints() {
  return (
    <>
      <ul className="explanation-key-points">
        <li>
          {/* #7c3aedはダーク時のカード背景で2.6:1しかなくAA未達のため両テーマ対応の銀トークンに変更 */}
          <span
            style={{ color: "var(--brand-accent-secondary)", fontWeight: 600 }}
          >
            ルールを書かない、データに聞く
          </span>
          —— 既存の本命/スタンダード/穴モデルは人間が設計したスコア計算。
          ポアロは2025年12月以降の全レースの結果そのものから「勝ちパターン」を自動で学習します
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
          ——
          学習に使っていない約7千レースの検証（2026年9月時点）で単勝ベタ買い回収率91%前後・3連単83%前後
          （還元率75%が理論上の平均）。まだ100%は超えておらず、
          超えるための期待値フィルタを開発中です（下の詳細参照）
        </li>
      </ul>
    </>
  );
}

export default KeyPoints;
