# 165 の適用手順（編集指摘の RPC と表の削除）

コードの PR（このマイグレーションを含む PR）が Vercel の本番デプロイに入ったことを確かめてから適用する。
163 と順番の決まりは無い（触る関数・表が重ならない）。

## 1. 適用前の確認（読み取り、Claude が実行）

```sql
SELECT (SELECT count(*) FROM public.sns_edit_inspections) n_inspections,
 (SELECT max(created_at) FROM public.sns_edit_inspections) last_inspection,
 (SELECT count(*) FROM public.sns_edit_decisions) n_decisions,
 (SELECT max(decided_at) FROM public.sns_edit_decisions) last_decision,
 (SELECT string_agg(p.oid::regprocedure::text, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname NOT IN ('read_sns_edit_inspection','save_sns_edit_inspection','decide_sns_edit_finding')
   AND (p.prosrc ILIKE '%sns_edit_inspection%' OR p.prosrc ILIKE '%decide_sns_edit_finding%' OR p.prosrc ILIKE '%sns_edit_decisions%')) other_callers,
 (SELECT count(*) FROM pg_views WHERE definition ILIKE '%sns_edit_%') views,
 (SELECT count(*) FROM pg_constraint WHERE confrelid IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)
   AND conrelid NOT IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)) outside_fks;
```

期待: `other_callers` が NULL、`views` が 0、`outside_fks` が 0。
件数と最後の時刻は APPLIED.md の 165 の行に残す（表を消すと戻らないため）。最後の時刻がこの PR の本番デプロイより後なら、まだ書いている経路がある。適用せず調べる。

## 2. 適用（オーナー）

`165_drop_sns_edit_assist.sql` を SQL Editor でそのまま1回実行する。

## 3. 適用後の確認（読み取り、Claude が実行）

```sql
SELECT to_regclass('public.sns_edit_inspections') i,
 to_regclass('public.sns_edit_decisions') d,
 to_regprocedure('public.read_sns_edit_inspection(uuid)') r,
 to_regprocedure('public.save_sns_edit_inspection(uuid,text,text,jsonb)') s,
 to_regprocedure('public.decide_sns_edit_finding(uuid,text,uuid,text,uuid,text)') f,
 to_regprocedure('public.sns_mobile_revision(public.sns_drafts)') keep;
```

期待: 先の5つが `NULL`、`keep` が NULL でない。確かめたら APPLIED.md の 165 を「適用済み」にする。

## 戻し方

コードの revert とセットで、`145_sns_edit_assist.sql` をそのまま再実行する（表・3関数・REVOKE/GRANT だけを作り、他の定義は上書きしない）。
消した行は戻らない。

Vercel の Instant Rollback でこの PR より前に戻しても、旧コードで 3 関数を呼ぶ経路は #1649 で無くなっているので影響は無い。
