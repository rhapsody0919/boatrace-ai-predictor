# ADR 0090: SNS 素材を v1 にして、手元のスクリプトから Storage に直接上げる

## ステータス
提案中（docs/design/sns-pdca-loop/plan.md §1）

## 背景
自動送信（docs/design/sns-pdca-loop/spec.md A8）には、Codex が毎日作る動画と X スレッドを人の操作なしで取り込む口が要る。今のプレビューバンドル v0 は、(1) 設計上いつも公開保留（135 のトリガー `guard_sns_preview_bundle_draft`）、(2) 管理画面でファイルを手で選び Vercel の関数を経由するのでリクエスト全体が 4 MiB まで（Vercel のボディ上限 4.5 MB）、(3) 動画1本 2 MiB まで、のため使えない。Codex には鍵を渡さない（ユーザー決定）。

## 決定
- ファイル構成と検査（`validateBundle`）は v0 のまま使い、`schema_version=ryujin-preview/1` を足す。v1 は X スレッド（`x_thread`）・照合できる主張（`claims[].source`）・締切を持つ
- 運び方は `scripts/sns/push-bundle.js`（Mac で hq が実行、本体の `.env.local` の service key を読む）が Storage に直接上げ、既存の `import_sns_preview_bundle` を呼ぶ
- v1 は龍神側の検査（禁止表現・数値の照合・リンク先の表示）を通った記録があるときだけ公開保留を外せる（153 でトリガーを置き換える）。v0 は今のまま
- 動画は1本 32 MiB まで（送信契約と同じ）

## 却下した選択肢
- **v0 のまま、管理画面で毎日手で取り込む**: 動画が 2 MiB に収まらない。人の操作が毎日入り、自動化の目的に合わない
- **管理 API に署名付きアップロード URL を出す口を作り、Codex がそこへ送る**: Codex に API の資格情報を渡すことになる（鍵を渡さない決定に反する）。Vercel の関数を経由する部分が残り、認証の設計も増える
- **Codex の出力先フォルダを cron が読みに行く**: Vercel からオーナーの Mac のフォルダは読めない
- **v1 を新しい表・新しい取り込み RPC で作り直す**: v0 の検査・保存・重複排除（版ハッシュ・行ロック）をもう一度作ることになる

## 影響
- 取り込みは hq がコマンドを1回打つ（または hq の定期処理）ことに依存する。Mac が止まっている日は素材が入らない（自動送信も起きないので安全側）
- service key を使うスクリプトが1本増える。Codex はこのスクリプトを実行しない（hq の手順に書く）
