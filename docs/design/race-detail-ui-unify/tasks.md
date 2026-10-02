# レース詳細ページのスマホ幅・色分け統一 tasks

plan: [plan.md](./plan.md)。PR ごとに節を分ける。各 PR は画面が変わるので、Preview URL を添えてオーケストレーター経由でユーザー確認を取る。

## PR2a 最良値の判定と共通クラス（先行）

- [x] T1 `src/utils/bestOf.js` を作り、集合を返す `bestOf` を export する。`raceIndicators.jsx` はこれを import する
- [x] T2 `DataRaceTable` / `RaceBeforeInfoTab` / `RaceCardDataTable` の `cellClass` を `best?.has(boat)` に変える
- [x] T3 別実装5つ＋モーター表の rankClassFor（MotorConditionChart・RacerFormChart・StPredictabilityChart・ExhibitionTimeTrendChart・RacerBoatReturnRateChart）を `bestOf` に置き換える（行の `.best-motor` は残す）
- [x] T4 `src/styles/indicators.css` に `.ind-best` `.ind-good` `.ind-bad`、`design-tokens.css` に `--ind-best-bg` `--ind-best-ring`。`.drt-best` をトークン参照に
- [x] T5 `.motor-ranking-table td.rate` と `.usage-history-rate` の一律の緑を外す。機力指数の緑・赤と小標本の黄が残ることを確認
- [x] T6 `scripts/maintenance/verify-best-of.js` と `verify-registry.json` 登録
- [x] T7 build・smoke（`td.drt-best`）・ライト/ダークのスクショ確認、PR 作成

## PR1 余白

- [ ] 480px 以下のページ・セクション・カードの余白、表・グラフの広げ、`--rdp-bleed` の再計算（#1127 のマージ後）
- [ ] `e2e/layout.spec.js` に 320 / 375 のカード外側余白 8px の検査

## PR2b 基本情報

- [ ] データ出走表の調子 ↑緑・↓赤
- [ ] 6艇の横棒の最良ラベル、条件別の列ごとの最良、前期の差、得意会場の背景
- [ ] 埋め込み分析: 行全体の強調をセルの強調へ、Δ矢印、回収率100%、決まり手の色・1号艇見出しの直書き、超展開データの凡例

## PR3 今節・枠別情報

- [ ] 今節: 前検の最良、得点率早見の rgba、判定文、日別の走りの着順、推移の線色
- [ ] 枠別情報: コース別成績・全コースの最良、ST考察の抜出

## PR4 モータ情報・直前情報

- [ ] 直前情報: 展示タイムの最速印（同値は全部）、展示情報の未判定行
- [ ] モータ情報: 展示推移の縦軸。列の並びは BOA-428 子1

## PR5 AI予想・オッズ・結果

- [ ] イン崩れ注意度の直書き、確定後の検証の的中/不的中、オッズの濃淡、結果の rgba、BOA-619 の残り
