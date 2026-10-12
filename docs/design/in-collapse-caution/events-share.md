# AI用にコピー・SNS シェアの GA4 のイベント（BOA-822 の計測の基準）

BOA-822 で展開予測を画面から外すと、AI用にコピーの文（展開予測の節）と、結果確定後のシェア文が変わる。今はどちらもイベントを送っていないので、前後を比べる基準を先に取る（measurement-planner の推奨、2026-10-12 オーケストレーター決定。公開の7日以上前に入れる）。画面は変えない。

## イベント

| イベント | パラメータ | いつ送るか |
|---|---|---|
| `ai_copy` | race_id, ai_copy_prompt, ai_copy_place | 「AI用にコピー」でクリップボードに書けたとき（失敗は送らない） |
| `race_share` | race_id, share_channel, share_kind | レース詳細・的中レースの X・Facebook・LINE のボタンを押したとき |

| パラメータ | 値 |
|---|---|
| ai_copy_prompt | `win` / `trifecta` / `trio` / `turn` / `dataOnly` / `volatilityTrifecta`（`AI_COPY_PROMPT_TYPES`）。無ければ `default` |
| ai_copy_place | `banner`（上のバナー）/ `inline`（ページ末尾のボタン） |
| share_channel | `x` / `facebook` / `line` |
| share_kind | `prediction`（発走前の予想の文）/ `result`（結果確定後の的中の文）/ `hit`（的中レース一覧のカード） |

- 送るかどうかと中身は `src/utils/shareEvents.js` の純関数。GA4 の予約語（source・medium・campaign・term・content・id）は使わない
- 再現テスト: `scripts/maintenance/verify-share-events.js`（ci）、`e2e/race-share-text.spec.js`「GA4 イベント」

## GA4 管理画面での登録（ユーザー操作）

範囲はすべてイベント。`race_id` は登録しない。登録した日より前には遡らないので、マージの前後に登録する。手順は `docs/design/analogy-reaction-measurement/ga4-custom-dimensions.md` の「手順」と同じ。

| ディメンション名 | 範囲 | 説明 | イベント パラメータ |
|---|---|---|---|
| AIコピーの質問 | イベント | AI用にコピーで付けた質問の種類 | `ai_copy_prompt` |
| AIコピーの場所 | イベント | 押したボタン（banner / inline） | `ai_copy_place` |
| シェアの送り先 | イベント | x / facebook / line | `share_channel` |
| シェアの種類 | イベント | prediction / result / hit | `share_kind` |

## 読み方

基準は公開の前日まで7日以上。BOA-822 の公開後に、`ai_copy`（質問の種類別）と `race_share`（種類別、とくに `result`・`hit` は展開予測の的中の文なので公開後に0になる）の1日あたりの件数を比べる。
