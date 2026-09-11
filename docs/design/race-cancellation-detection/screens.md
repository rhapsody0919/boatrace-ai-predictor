# レース中止・順延検出の永続化 画面・コンポーネント洗い出し

`spec.md`のFR4・FR5に基づく。対象は「レースの中止・順延状態を表示するUI」に限る（データ層・スクレイピングは対象外）。

## 対象コンポーネント

### 1. `RaceCard.jsx`（`src/components/race/`）— 拡張
- 役割: 会場ページ（`VenueRaceListPage.jsx`）の1R〜12Rレース一覧で使われる、レース1件分のカード。グレードバッジ・イン崩れバッジ・的中/外れバッジ・「結果反映待ち」バッジを持つ
- 対応方針: **既存コンポーネントの拡張**。新規コンポーネントは作らない。`isFinished`/`isAwaitingResult`と排他的な新しい分岐（「中止」）を追加する。`.claude/rules/component-reuse.md`のコンポーネント一覧に既に「RaceCard | レースカード」として登録済みの共通部品であり、これを拡張する方針はルールに整合する
- デザイントークン: 既存の「結果反映待ち」バッジが使っている`--color-gray-600`系（無彩色・グレーアウト系）を「中止」バッジにも流用できる見込み。的中/外れで使う`--color-error`/`--color-warning`系とは意味が異なるため転用しない。新規トークン新設は不要と見られるが、実際の見た目は`/step2`〜実装時にPlaywrightで確認して最終判断する
- 影響範囲: `VenueRaceListPage.jsx`（本日`/venue/:code`・過去日`/races/:date/:code`）に反映される

### 2. `PredictionPanel.jsx`（`src/components/race/`）— 拡張
- 役割: レース詳細ページ（`RaceDetailPage.jsx`）でAI予想・データ出走表を表示するパネル。`isAwaitingResult`判定で「結果反映待ち」バナー（`panel.awaitingResultBanner`）を独自に表示している（`RaceCard.jsx`とは別実装・別i18nキー）
- 対応方針: **既存コンポーネントの拡張**。`RaceCard.jsx`と同じ「中止」状態を参照し、同じ状態に基づいて矛盾なく分岐を追加する。RaceCardとPredictionPanelは同じUIパターン（結果反映待ちの表現）を別々に持っている既存の重複だが、今回のスコープでは統合・共通化は行わず、両方に同じ分岐ロジックを個別に追加するに留める（既存の重複を新たに拡大しないことが目的で、今回のPRで重複を解消するのはスコープ超過と判断）
- デザイントークン: 既存の`awaitingResultBanner`のスタイルを踏襲し、文言のみ「中止」に対応する分岐を追加する想定。新規CSSは基本的に不要
- 影響範囲: `RaceDetailPage.jsx`（レース詳細ページ）に反映される

## 対象外（調査の結果、影響なしと判断したコンポーネント）

| コンポーネント/画面 | 対象外の理由 |
|---|---|
| `src/components/holmes/`配下（HolmesSherlock/Watson/Adler/Mycroft.jsx） | `src/components/race/RaceCard.jsx`とは無関係の同名ローカル関数（`function RaceCard({ race })`）を各ファイルが個別実装しており、importもしていない。本機能の対象コンポーネントとは別物 |
| `VenueGridCard.jsx` / `VenueGridPage.jsx`（日別会場グリッド） | 会場単位の集約表示（開催中/非開催、次レース時刻）のみを持ち、個別レースの状態バッジを表示する仕組みがそもそも無い |
| `AdminRules.jsx`（`/admin/rules`） | レース一覧・バッジ表示ではなく回収率等の集計ダッシュボード。中止レースが集計に混入するリスクはあるが、表示コンポーネントの追加・変更ではないため本ドキュメント（画面・コンポーネント洗い出し）の対象外。spec.mdの「やらないこと」に集計面の対応見送りを明記済み |

## 新規コンポーネントの要否

新規コンポーネントは作らない。上記2つの既存コンポーネントへの分岐追加のみで完結する。`App.jsx`とレース詳細ページの両方に同じUIパターンを新設する必要はない（RaceCard・PredictionPanelはそれぞれ既存の別コンポーネントとして既に存在し、今回はその中に分岐を足すだけのため、`.claude/rules/component-reuse.md`が想定する「同じUIパターンを2箇所以上に新設する場合の共通コンポーネント化」には該当しない）。
