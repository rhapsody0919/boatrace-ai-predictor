# ADR 0038: revise/redoのルーティング解決キー

## ステータス
採用

## 背景
現状`api/admin/sns-hub/drafts/[id]/revise.js`・`redo.js`は、下書きの生成元パイプラインに関わらず一律`fireRoutine("SNS_HUB_ROUTINE", ...)`を呼んでいる。このため、`content-multi-channel-pipeline`（Pipeline B）が生成した下書きに対して「一部修正」「作り直し」を行っても、実際には`sns-hub-content-generation`（Pipeline A）のRoutineが発火してしまう既存バグがある（2026-09-03、実ファイルで確認済み）。`docs/design/sns-topic-gate/spec.md`要件11の修正、およびチャネル別パイプライン分離後（ADR 0037）は5つの発火先候補から正しいものを選ぶ必要があり、その解決キーを決める。

## 決定
**`sns_drafts.platform`列から、プラットフォームごとに固定の環境変数プレフィックスへマッピングする表を`api/_lib/snsHubHelpers.js`に持たせる方式を採用する。**

```js
const PLATFORM_ROUTINE_ENV_PREFIX = {
  blog: "SNS_BLOG_ROUTINE",
  note: "SNS_NOTE_ROUTINE",
  x: "SNS_X_ROUTINE",
  tiktok: "SNS_TIKTOK_ROUTINE",
  youtube: "SNS_YOUTUBE_ROUTINE",
};
```

`revise.js`/`redo.js`は下書きの`platform`を見てこの表からプレフィックスを引き、`fireRoutine(prefix, payload)`を呼ぶ。1プラットフォーム=1パイプラインという本spec全体の設計（ADR 0037）と対応が一致するため、実装がシンプルになる。

## 却下した選択肢

- **`sns_drafts.routine_run_id`から生成元Routineを逆引きする**: `routine_run_id`は「どの実行が生成したか」というトレーサビリティの記録であり、「再修正依頼をどのRoutineに送るべきか」という宛先マッピングを直接には持たない。将来、同じプラットフォームに複数の役割違いパイプラインが対応する場合（例: 同じXでも通常投稿用と速報用で別Routine）には必要になるが、現状のスコープ（1プラットフォーム1パイプラインが前提、ADR 0037）ではオーバーエンジニアリングと判断した。この必要性が生じた際に再検討する
- **`sns_drafts`に新規列`source_pipeline`を追加し明示的に記録する**: platformベースのマッピングで同じ結果が得られ、新規列を増やす理由が無い

## 影響
- チャネル別パイプラインの段階的展開（ADR 0037）が完了するまでの間、未展開チャネルの下書きに対する`revise`/`redo`は、暫定的に旧`SNS_HUB_ROUTINE`にフォールバックする経過措置が必要になる。`/step3`のタスク分解で、展開順序とこのフォールバック解除のタイミングを対応付ける
