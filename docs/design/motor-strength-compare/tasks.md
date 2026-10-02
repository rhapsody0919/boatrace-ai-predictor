# モーターの強さをひと目で比べる（tasks）

spec: [spec.md](./spec.md) / screens: [screens.md](./screens.md) / plan: [plan.md](./plan.md)（BOA-428）

PR は2本に分ける。PR-A（子1）は UI統一レーンの PR2（`bestOf` の export・R1 の共通クラス）のマージ後に R1 の部分を入れる（plan.md「UI統一レーンとの順番」）。PR-B（子3）は PR-A と並行でよい。

## 共通（PR-A に含める。PR-B が先なら PR-B に含める）

- [x] T1 サービス層: `getVenueMotorSnapshot(venueCode, asOfDate)` を足す（`{state:"ok"|"empty"|"error"}`）。浜名湖・宮島を読まないのは T4・T11 の側（`VENUE_SITE_STATS_HIDDEN`）。既存のドリルダウンは変えない。`getVenueMotorRanking` の中身をこれに差し替える（戻り値・キャッシュキーは変えない）
- [x] T2 `RateBar`（`src/components/common/RateBar.jsx` / `.css`）: value / max / fill / best / label（best は複数行で true になりうる）。札は `--surface-card`、1号艇の白に `--border-hairline` の内線、`max` が 0・null なら棒なし。R1 は UI統一レーンの共通クラスを付けるだけ
- [x] T3 純関数（`src/utils/venueMotorRanking.js`）: 並べ替え（列ごとの固定の向き、値なしは末尾）と順位（`competitionRank`、機番で並べたときは2連率の順位）。`scripts/maintenance/verify-venue-motor-ranking.js` で同値・値なし・機番の並べ替えを固定し、`verify-registry.json` に `ci` で登録

## PR-A 子1: 6艇の比較（MotorConditionChart）

- [x] T4 `getVenueMotorRanks(venueCode, asOfDate)`: スナップショットから `Map<motor_number, {rank, tied}>`・total・scrapedDate。当日は null、過去は raceDate
- [x] T5 6艇表の列の並びを変える: 枠 / 選手 / 機番 / 公式2連率 / 会場内順位 / 期間の2連率（当日のみ）/ 3連率 / … 。過去レースは2連率の列（公式値）を使う。BOA-451 の列順コメントを新しい理由に書き換える
- [ ] T6 公式2連率を RateBar（艇色、`max` は6基の最大、`toFixed(1)`）。最良の札に R1（`bestOf` の艇の集合。同じ値の最良は全部、全艇同値・値なしは付けない）。行全体の `.best-motor` を外す
  - 進捗: 棒・最良の判定（同じ値は全部、全艇同値・値なしは付けない）・`.best-motor` の除去は済み（a837b07・d446479）。残りは UI統一 PR2a のマージ後に、判定を `bestOf`（艇の集合）に置き換え、`.rate-bar-label.is-best` に R1 の共通クラスを付けること
- [x] T7 会場内順位の列（「20位/60」「17位タイ/60」）。`empty` は列ごと畳む、`error` は印、スナップショットに無い機番は「-」。表の下に注記2行（出典と取得日、選手の実力が混ざる）。4言語のキー
- [x] T8 E2E（`e2e/`）: 棒の長さの比が値の比と一致、最良の札だけ R1、全艇同値なら R1 なし（ルートで加工）、375px で順位まで横スクロールなしで見える。分析ツールの「モーター調子」タブでも同じ表になる
- [ ] T9 データ精度: 6基の順位が `getVenueMotorRanking`（ドリルダウン）と一致することを `data-accuracy-verifier` で確認（当日・過去レース・データの無い会場の3通り）
- [ ] T10 自動レビュー（`/code-review`）→ build → 関連 spec と `npm run test:layout` を --workers=1 → PR・レビューコメント → ファン評価ループ（オーケストレーターの指定に従う）

## PR-B 子3: 会場モーターランキング（新しいタブ）

- [ ] T11 `getVenueMotorList(venueCode)`: スナップショット＋会場の最新の前検日1日分の `motor_pretest_stats`（使用者・前検・データの無い会場の公式2連率）＋その節の出走表（選手名・モーターが走った直近の `race_id`）。戻り値に state・出典の種類（会場サイト / BOATRACE 公式の前検データ）・取得日・前検日
- [ ] T12 `VenueMotorRanking.jsx` / `.css`: 会場の選択、出典・取得日の行、表（順位・機番・2連率の棒（中立色）・優出・優勝・前検・使用者）、並べ替え（T3）、2連率1位の札に R1（同率は全部）、機番→ドリルダウン（`race_id` 付き、使われていないモーターはリンクなし）、使用者→選手ページ（`translate="no"`）、前検日が今日でなければ「直近の節の使用者（{{date}}）」、`error` はエラー表示、`useHorizontalScrollHint`、注記
- [ ] T13 タブの登録: `TAB_KEYS` の `motor` の次に `motorranking`、`analysisPage.tabs` / `analysisPage.info` / `analysisPage.features.motorranking` を4言語、`scripts/lib/contentTopics/dataInsightSource.js` のタブ一覧、`venue_code` のディープリンク
- [ ] T14 ADR-0067 に追記（会場公式サイトのモーター成績の全モーター一覧での再表示。出典と取得日を出す。取得は増やさない。戸田・平和島・浜名湖・宮島は前検データの値だけ。ADR-0067:21 と実装の食い違い、BOA-681）
- [ ] T15 `docs/design/motor-strength-compare/content-index.json` を作る
- [ ] T16 E2E: タブが開く、直近の節の前検のモーターがすべて一覧にある、取得失敗でエラー（ルートで加工）、2連率の並べ替えで同値が同じ順位、データの無い会場で出典の行が替わる、375px でページに横スクロールなし。`e2e/layout.spec.js` に新しいタブを足す
- [ ] T17 データ精度: 件数・順位・優出・優勝を本番の `venue_motor_stats` と、使用者を出走表と突き合わせる（`data-accuracy-verifier`）
- [ ] T18 自動レビュー → build → 関連 spec と layout → PR・レビューコメント → ファン評価ループ

## 完了監査

- [ ] T19 受け入れE2E（`e2e/acceptance/motor-strength-compare.spec.js`）を `playwright.acceptance.config.js` でローカル実行し、全件通ることを確認
- [ ] T20 このファイルの全チェックとコミット・コードを突き合わせる
