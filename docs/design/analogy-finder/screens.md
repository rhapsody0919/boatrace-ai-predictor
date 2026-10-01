# アナロジー・ファインダー screens

元: [spec.md](./spec.md)。置き場所はレース詳細の AI予想タブ（`src/components/race/RaceAiPredictionTab.jsx`）内の新しい節。既存の展開予測・イン崩れ・出現パターンのブロックはそのまま残し、その下に足す。

## 画面

### S-1 レース詳細 > AI予想タブ（既存画面の拡張）
- 既存ブロック（PredictionCard / TurnPatternList / VolatilityDisplay / OutcomePatternPreview）の下に「アナロジー・ファインダー」節を足す
- 節の中は3つの切り替え（①寄与度 ②似たレース ③組み合わせ）。②③は同じ似たレースの集合を使うので、類似度しきい値（または条件チップ）は②③共通の場所に置き、①では隠す
- 読みの入力（FR-4）は②の下に置く。発走後は結果モード（`finished`）で答え合わせを出す
- 中止確定のレースは既存どおり節ごと出さない（`isCancelled`）
- 発走前のデータ段（出走表時点／直前情報時点）を節の見出しの下に1行で出す（例: 「直前情報 14:52 時点のデータ」）

App.jsx 側にこの節は置かない（レース詳細のタブにだけ出す）。共通化の対象は無い。

## コンポーネント

新規はすべて `src/components/race/analogy/` に置き、`src/components/race/index.js` の barrel export に足す。

| コンポーネント | 新規/既存 | 役割・主要素 |
|---|---|---|
| `AnalogyFinderSection` | 新規 | 節の外枠。3つの切り替え、データ段の表示、②③共通のしきい値。データ取得のフックを呼ぶ |
| `ContributionView`（FR-1） | 新規 | テーマ別の相対シェア。レーダー（recharts `RadarChart`）または横棒（recharts `BarChart`）。着順タブ（1着／2着以内／3着以内）、詳細条件（グレード・ラウンド・艇番比較）の折りたたみ、n・期間・モデル版、n<30 の小標本フラグ |
| `ContributionBreakdown` | 新規 | テーマを押したときの内訳。似た意味の項目をまとめ、個別値は参考の注記 |
| `BoatCompareTable` | 新規 | 艇番2つの比較表（テーマ／艇番A／艇番B） |
| `SimilarRacesView`（FR-2） | 新規 | 分布の4ブロック（決まり手6分類・1着艇・1着の進入コース・出目トップ3）、n・期間、事故情報の常設注記、類似レース一覧 |
| `SonarChart` | 新規（k-NN 採用時） | 自作 SVG（viewBox）。中心＝今日、同心円＝類似度、6扇形＝艇番、光点＝過去レース。しきい値で自動ズーム。光点⇄一覧行の双方向ハイライト |
| `ConditionChips` | 新規（層別採用時） | 会場・1号艇の級別・風・グレードのチップ。外すと条件がゆるみ件数が増える |
| `SimilarityThreshold` | 新規（k-NN 採用時） | 65〜95% のスライダー |
| `CombinationView`（FR-3） | 新規 | サンキー図、組み合わせ一覧（上位10件）、干渉効果のコールアウト、「1号艇以外が1着」の切り替え |
| `FinishSankey` | 新規 | 自作 SVG。1着→2着を主、3着の段は n が基準以上のときだけ。少数の流れは「その他」。帯タップで件数・%。帯とノードは艇の公式色、1号艇の白は枠線つき |
| `ReadCheck`（FR-4） | 新規 | 読みの入力（1着艇＋決まり手）。発走前は分布上の位置、発走後は多数派／少数派と「よくある決着か」 |
| `BoatBadge` | 既存を共通化 | 今は `RaceOddsListTab.jsx` 内のローカル関数。本機能でも使うので `src/components/race/BoatBadge.jsx` に切り出し、色は `src/utils/colors.js` の `BOAT_COLORS` を使う（2箇所以上で使うため共通化の規約に該当） |
| `RaceAiPredictionTab` | 既存を拡張 | 末尾に `AnalogyFinderSection` を足すだけ。既存ブロックは触らない |

recharts のサンキー（`Sankey`）は帯の色を艇ごとに変える・帯タップで件数を出す・「その他」をまとめる、の3点を自前で描くほうが単純なので使わない。

## データ取得

| フック | 中身 |
|---|---|
| `useContributionProfile(venueCode, grade, round, finishPos)` | 永続化した SHAP 集計（モデル版つき）を読む |
| `useSimilarRaces(raceId, threshold or conditions)` | BOA-627 のスナップショットがあればそれを、無ければ計算結果を読む。②③で共有する |
| `useRaceRead(raceId)` | localStorage の読み（1着艇＋決まり手、入力時刻） |

テーブル・RPC・Edge Function の形は `/step2` で決める。

## デザイントークンと CSS

- トークンで足りる部分: 余白（`--space-*`）、文字（`--font-size-*`）、カード（`--surface-card`）、文字色（`--text-primary` / `--text-secondary`、ダークモードで反転するもの）、境界線
- 艇の公式色: `src/utils/colors.js` の `BOAT_COLORS`（JS 定数）を SVG の fill に渡す。CSS 変数は新設しない
- 新規 CSS が要る部分: ソナーとサンキーの SVG の配置、帯のハイライト、比較表の列。クラス名は `af-` 接頭辞（`.af-sankey-band` 等）で衝突を避ける（`verify:css-collisions`）
- 375px で横スクロールなし。サンキーは幅に合わせて viewBox で縮め、ラベルは艇番だけにする。`e2e/layout.spec.js` に AI予想タブの節を足す

## i18n

翻訳対象。文言は `src/locales/{ja,en,zh-TW,ko}/` の `aiPredictionTab.analogy.*` に置く。決まり手6分類は既存の訳語キーがあればそれを使う。
