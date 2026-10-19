# 161 の適用手順（全貌動画の自動送信の item）

2026-10-18 オーナー決定（承認なしの自動投稿）。このレーンが代行してよいとオーナー本人が許可した。

## 1. 適用前の確認（読み取り）

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.sns_auto_send_items'::regclass
  AND conname IN ('sns_auto_send_items_kind_check', 'sns_auto_send_items_kind_source');
```

期待: kind_check が `race`・`digest` の2つ、kind_source が race・digest の2つの枝（158 のとおり）。

## 2. 適用

`161_sns_full_picture_items.sql` をそのまま1回実行する。

## 3. 適用後の確認（読み取り）

1 と同じ SELECT を実行し、kind_check に `full_picture`、kind_source に `kind = 'full_picture'` の枝があることを確かめる。

## 4. 送信設定（#1616 のデプロイの後）

```sql
UPDATE public.sns_auto_send_control SET mode = 'auto', dry_run = false WHERE channel IN ('x', 'youtube');
UPDATE public.sns_x_send_control
SET paused = false, daily_limit_x = 2, daily_limit_youtube = 2, budget_microusd = 20000000
WHERE id = true;
```

止めるとき（X・YouTube・/today すべて止まる）:

```sql
UPDATE public.sns_x_send_control SET paused = true WHERE id = true;
```

## 5. hq の受け渡し

```bash
npm run sns:push-full-picture -- /Users/terukina/full-picture/out/full-picture-daily/<race_id>
```

先に `--dry-run` で検査だけ通すことができる（DB・Storage に書かない）。
