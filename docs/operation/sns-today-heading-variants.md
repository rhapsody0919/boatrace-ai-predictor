# /today の X 投稿の見出しの日替わり（2案）

/today の X 投稿の1行目（見出し）だけを、2案で日替わりに出す（2026-10-20 オーナー承認、hq 経由）。数字・区分・締切の順は今までどおり機械が作る。

- 案の置き場: `config/today-variants.json`（`default` と `variants` の2案。各案は `id`・`uuid`・`heading`。`heading` の `{date}` に日付の表示が入る）
- 選び方: 日の番号（1970-01-01 からの日数）の偶奇。1週は7日（奇数）なので、週ごとに順が逆になり、同じ曜日に同じ案が続かない（`scripts/lib/snsTodayVariants.js`）
- 札: 下書きの `source_data.today_variant`（`{id, uuid}`）に必ず残す。`uuid` が入っている案は `sns_post_tracking.template_variant_id` にも入る（`sns_template_variants(id)` への外部キー）
- 設定が無い・壊れている（2案でない・同じ id・改行・uuid の形が違う）ときは `default`（それも壊れていれば「本日のデータ一覧（{date}）」）に戻し、札は `default`
- 案の中身は hq が機械の検査（禁止語・risk-rules）を通して渡す。入れ替えは `config/today-variants.json` だけを変える小さな PR で行う

## 案の札を tracking に入れる（本番の2行。オーナーが実行）

`sns_post_tracking.template_variant_id` は uuid で、`sns_template_variants(id)` への外部キーがある。案の札を tracking に入れるには、`sns_template_variants` に /today の2案の行が要る。マイグレーションは要らない（データの2行だけ）。

この2行が入るまでは、`config/today-variants.json` の `uuid` は `null` のまま動く（tracking の `template_variant_id` は null、札は `source_data.today_variant` にだけ残る）。

### 手順1（実行前の確認・読み取り）

```sql
-- 期待値: 0行（まだ入っていない）
SELECT id, format, variant_name FROM public.sns_template_variants
WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a')
   OR (format = 'today_digest' AND variant_name IN ('today-heading-a', 'today-heading-b'));
```

### 手順2（書き込み）

```sql
BEGIN;
INSERT INTO public.sns_template_variants (id, format, variant_name, composition_name, active, notes, created_by)
VALUES
  ('0f88824e-c630-4f94-8c15-475297e4b242', 'today_digest', 'today-heading-a', 'TodayDigestX', true,
   '/today の X 投稿の見出しの案 a（config/today-variants.json の id "a"）', 'human'),
  ('be74c247-fa8f-442e-a29f-4d1d7866919a', 'today_digest', 'today-heading-b', 'TodayDigestX', true,
   '/today の X 投稿の見出しの案 b（config/today-variants.json の id "b"）', 'human');
COMMIT;
```

### 手順3（確認・読み取り）

```sql
-- 期待値: 2行（today-heading-a・today-heading-b、active=true）
SELECT id, format, variant_name, active FROM public.sns_template_variants
WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a')
ORDER BY variant_name;
```

手順3が通ったら、`config/today-variants.json` の案 a・b の `uuid` に上の2つを入れる小さな PR を出す（次の朝の /today から tracking に入る）。

### 戻し方

先に `config/today-variants.json` の `uuid` を `null` に戻す PR をマージしてから、まだ tracking から参照されていなければ消す。

```sql
-- 期待値: 0（参照があれば消さない。active=false にして使わないだけにする）
SELECT count(*) FROM public.sns_post_tracking
WHERE template_variant_id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a');

-- 参照が0のとき
DELETE FROM public.sns_template_variants
WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a');

-- 参照があるとき
UPDATE public.sns_template_variants SET active = false
WHERE id IN ('0f88824e-c630-4f94-8c15-475297e4b242', 'be74c247-fa8f-442e-a29f-4d1d7866919a');
```
