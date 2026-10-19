# 168 の適用手順（編集指摘の RPC と表の削除）

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
   AND conrelid NOT IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)) outside_fks,
 (SELECT count(*) FROM pg_depend WHERE refobjid IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)
   AND deptype<>'i' AND NOT (classid='pg_constraint'::regclass AND objid IN (SELECT oid FROM pg_constraint
   WHERE conrelid IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)))
   AND NOT (classid='pg_attrdef'::regclass AND objid IN (SELECT oid FROM pg_attrdef
   WHERE adrelid IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)))
   AND NOT (classid='pg_class'::regclass AND objid IN (SELECT indexrelid FROM pg_index
   WHERE indrelid IN ('public.sns_edit_inspections'::regclass,'public.sns_edit_decisions'::regclass)))) outside_depends,
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sns_mobile_revision(public.sns_drafts)'::regprocedure) revision_md5;
```

期待: `other_callers` が NULL、`views` が 0、`outside_fks` が 0、`outside_depends` が 0、`revision_md5` が `de924e8953e175677495feb450f1d675`（163-runbook.md と同じ値）。

- 最後の時刻（`last_inspection`・`last_decision`）が #1645 のマージ（2026-10-18 15:45:51Z）の本番デプロイより後なら、まだ書いている経路がある。適用せず調べる。読むだけの `read_sns_edit_inspection` はこの判定では見えず、コードの grep だけが根拠になる
- 件数・最後の時刻・退避の有無は APPLIED.md の 168 の行に残す（表を消すと行は戻らない）
- 件数が数十行を超えるときは、適用前にオーナーが Table Editor で2表を CSV に書き出し、リポジトリの外に置く（鍵は含まないが、リポジトリには入れない）。数十行以下なら記録だけでよい（今のコードに2表を読む分析・学習の経路は無い）

## 2. 適用（オーナー）

`168_drop_sns_edit_assist.sql` を SQL Editor でそのまま1回実行する。

## 3. 適用後の確認（読み取り、Claude が実行）

```sql
SELECT to_regclass('public.sns_edit_inspections') i,
 to_regclass('public.sns_edit_decisions') d,
 to_regprocedure('public.read_sns_edit_inspection(uuid)') r,
 to_regprocedure('public.save_sns_edit_inspection(uuid,text,text,jsonb)') s,
 to_regprocedure('public.decide_sns_edit_finding(uuid,text,uuid,text,uuid,text)') f,
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sns_mobile_revision(public.sns_drafts)'::regprocedure) keep_md5;
```

期待: 先の5つが `NULL`、`keep_md5` が `de924e8953e175677495feb450f1d675`。確かめたら APPLIED.md の 168 を「適用済み」にする。

## 戻し方

コードの revert とセットで、`145_sns_edit_assist.sql` をそのまま再実行する（表・3関数・REVOKE/GRANT だけを作り、他の定義は上書きしない）。
消した行は戻らない（退避した CSV があれば手で入れ直す）。

Vercel の Instant Rollback で戻す先が #1645 以降なら、3 関数を呼ぶ経路は無いので影響は無い。
#1645 より前に戻すと、旧画面が消えた RPC を呼んでエラーになる（失敗する側に倒れるだけで、データは壊れない）。
