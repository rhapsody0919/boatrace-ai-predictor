# レース詳細×分析ツールデータ統合 spec

種別: UI機能
対応Linearチケット: なし

## 背景・目的

レース詳細ページを見た後、分析ツール（`/winning-technique`、17タブ）のどこを見ればいいか分からず、辿り着かないことがある、という課題認識から着手した。

ただし調査の結果、`DataRaceTable`の既存8行（勝率・当地勝率・モーター・調子・ST・展示ST・展示タイム・進入コース別勝率・決まり手・回収率）は既に`/winning-technique`各タブへの深掘りリンクを持ち、`RaceDetail.jsx`/`VolatilityDisplay`/`OutcomePatternPreview`からも計4箇所で導線が既存と判明。過去にBOA-88で「会場勝率の重複表示を根本排除」した実績もあり、同型の重複を過去に自ら削除している。

9人の専門家ペルソナ（統計家/UXデザイナー/フロントエンドエンジニア/プロダクトマネージャー/誤読リスクレビュー/データエンジニア/コンテンツ戦略/回収率アナリスト/懐疑派）による並列レビューを経て、分析ツール17タブそれぞれについて「レース詳細に統合する価値があるか」を個別判定した。本specは、その判定結果を実装可能な要件に落とし込む。

## 機能要件

### FR-1 深掘りリンクのクリック計測（優先度: 高）
- 既存4箇所（`DataRaceTable`の各行リンク、`VolatilityDisplay`、`OutcomePatternPreview`、その他の`/winning-technique`導線）に`trackEvent`（`src/utils/analytics.js`）を追加する
- FR-2以降の実装前後でCTRを比較できるよう、施策前のベースラインを計測できる状態にする
- 受入基準: GA4に`deep_link_click`イベント（tab・source等のパラメータ付き）が発火することを確認する

### FR-2 「この会場の枠番別傾向」パネル（優先度: 高）
- `DataRaceTable`直下に新設する。デフォルト展開
- 4行構成、列は6艇（枠番）:
  1. 決まり手出現率（`technique`、`getWinningTechniqueStats`）
  2. トップ発走率（`topstart`、`getTopStartStats`）
  3. 負けた際の相手決まり手（`losing`、`getLosingTechniqueStats`）
  4. 展示最速→1着転換率（`extime`、`getExhibitionTimeTopStats`）
- 決まり手行には、逃げ限定の出目分布（`nige`タブ）への深掘りリンクを併設する
- 各セルにn数を併記する。カテゴリ分割指標（決まり手・負け決まり手）はn未満の閾値（目安n<20〜30、Wilson区間で機械的に決める）で「データ不足」表示にし数値を隠す。2値指標（トップ発走率・展示最速転換率）はn数併記のみで表示は維持する
- 見出しに「選手個人の実績ではなく、この会場・枠番の過去傾向」である旨の注記を必須表示する
- パネル下部に集計基準日（前夜更新・過去90日ローリング、当日結果は未反映の旨）を表示する
- 各行ラベルから対応タブへの深掘りリンクを設置する
- 受入基準: 表示された%値・n数がSupabase実データと一致する。n閾値未満セルが「データ不足」表示になる

### FR-3〜FR-9 埋め込み折りたたみセクション×7（優先度: 高、実装は1コンポーネントずつ段階的に進める）
- 対象: モーター調子（`motor`）／選手調子推移（`racer`）／STの安定性（`st`）／展示タイムの推移（`extrend`）／決まり手の内訳・選手別（`techprofile`）／回収率の詳細（`returnrate`）／超展開データ（`attackdefense`）
- 対応する既存の分析ツールコンポーネント（`MotorConditionChart`等）を「embedded mode」で埋め込む
  - embedded modeでは会場・レース選択プルダウンを非表示にし、レース詳細側の`venueCode`/`raceId`をそのまま渡す
  - 折りたたみはデフォルト閉じ。開くまでデータ取得しない（lazy mount）
- 実装順序: まずモーター調子（FR-3）を実装しembedded modeの改修パターンを確立する。残り6つ（FR-4〜FR-9）はその横展開として1つずつ進める
- 受入基準: 各セクションを開いた時のみ対応APIが呼ばれる（閉じている間はネットワークリクエストが発生しない）。表示内容が単独の`/winning-technique`ページと一致する

## スコープ

### やること
FR-1〜FR-9

### やらないこと
- `racecard`（出走表データ詳細版）の埋め込み: `DataRaceTable`の既存11行とほぼ全て重複し、新規性は年齢・全国2連率の2項目のみのため見送り
- `outcome`（出目分布）の新規UI: 既存`OutcomePatternPreview`（AIデータ分析セクション内）で対応済みのため何もしない。発見性（デフォルト折りたたみ）の改善は別途検討の余地があるが今回のスコープ外
- `volatility`の新規UI: 既存`VolatilityDisplay`で対応済み
- `formranking`/`venueranking`のレース詳細への統合: 本来「レース選択前の会場横断発見導線」として設計されているため対象外。ホーム/一覧側の別課題として切り出し済み（別セッションで対応）
- 予想モデル・イン崩れ指数のロジック変更

## 非機能要件

特になし（既存の`.claude/CLAUDE.md`モバイル余白ルールに従う）

## 制約・前提

- 対象6コンポーネント（`motor`/`racer`/`st`/`extrend`/`techprofile`/`returnrate`）は全て`initialVenueCode`/`initialRaceId`propsを既に持つが、自前の会場・レース選択プルダウンをレンダリングする実装のため、embedded mode切替propの追加が各コンポーネント共通の前提作業になる
- `attackdefense`は`DataRaceTable`と同じ`racerStats`データソースを再利用でき、追加フェッチが不要
- `technique`/`topstart`/`losing`/`extime`の集計テーブルは90日ローリングウィンドウ・日次（JST 00:30〜00:44）洗い替え。`getTopStartStats`/`getExhibitionTimeTopStats`はAPI層で`last_updated`がトップレベルに正規化されていないため、実装時に4関数共通のレスポンス形に揃える
- 用語ルール（「競艇」禁止）・design-tokens使用・`!important`禁止に従う
- 会場統計は選手個人の実績ではないことを明示するラベリングを必須とする（誤読防止）

## 未確定事項（ユーザー確認待ち）

1. **FR-2「負けた際の相手決まり手」行の具体的な表示形式**: トップ1パターンのみか、内訳全部を出すかは`/step1-screens`で画面詳細を詰める際に決める
2. **FR-3以降（モーター調子の次）の実装順序**: 着手時にその都度判断する
3. **FR-1のGA4イベント名・パラメータ設計の詳細**: `trackEvent`の既存呼び出しパターンに合わせて実装時に確定する
