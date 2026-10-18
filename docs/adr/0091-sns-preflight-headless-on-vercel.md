# ADR 0091: 送信直前のリンク先の表示確認を、Vercel の関数で未認証の Chromium を使って行う

## ステータス
採用（docs/design/sns-pdca-loop/plan.md §2。`api/_lib/snsHeadless.js`、cron `sns-auto-plan`）

## 背景
既存の `createDeadlinePreflight`（api/_lib/snsDeadlineQueue.js）は `headless.inspect({url, context:{storageState:null}, requiredSelectors})` を注入する契約だけがあり、実体はモック。自動送信では人の確認が外れるので、リンク先で対象の画面が未ログインで実際に見えることを機械で確かめる必要がある。新しい定期処理は Vercel Functions + Vercel Cron（ADR-0066）。

## 決定
- `playwright-core` と `@sparticuz/chromium`（どちらも依存に入っている。ビルド時の `scripts/generate-ai-snapshots.js` で実績あり）を使い、cron `sns-auto-plan` の中で起動する。関数のメモリは 2 GB 以上、`maxDuration` は 300 秒
- 毎回新しい context（Cookie・Storage なし）で開き、`markers[screen_key]` の要素が実際に表示されているか（`isVisible`）を返す
- バンドルが 250 MB を超える場合は、Vercel の公式ガイドの `@sparticuz/chromium-min`＋リモートの tar の構成に切り替える（/step4 で関数のサイズを測って決める）

## 却下した選択肢
- **HTTP で HTML を取って文字列を探す**: SPA なので、クライアントで描かれる画面の要素は HTML に出ない。「見える」ことを確かめられない
- **GitHub Actions の Playwright で確認する**: ADR-0066 で新しい定期処理を Actions に足さないと決めている。送信（Vercel）と確認（Actions）が別の基盤になり、時刻の整合も取りにくい
- **確認を省き、承認時の人の目視に任せる**: 自動送信では人の承認が外れるので成り立たない

## 影響
- Chromium の起動に数秒〜十数秒かかる。1回の cron で確認する画面は最大3件にする
- 関数のサイズとメモリが増える。Vercel のプランの上限（Pro 4 GB）の範囲
