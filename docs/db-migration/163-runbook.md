# 163 の適用手順（個別承認の RPC と表の削除）

コードの PR（このマイグレーションを含む PR）が Vercel の本番デプロイに入ったことを確かめてから適用する。
#1645 が本番に出ていれば、今の本番に 2 関数と表を呼ぶ経路は無い。

## 1. 適用前の確認（読み取り、Claude が実行）

```sql
SELECT (SELECT count(*) FROM public.sns_mobile_reviews) n_reviews,
 (SELECT max(reviewed_at) FROM public.sns_mobile_reviews) last_review,
 (SELECT string_agg(p.oid::regprocedure::text, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname NOT IN ('read_sns_mobile_race','approve_sns_mobile_channel')
   AND (p.prosrc ILIKE '%read_sns_mobile_race%' OR p.prosrc ILIKE '%approve_sns_mobile_channel%' OR p.prosrc ILIKE '%sns_mobile_reviews%')) other_callers,
 (SELECT count(*) FROM pg_views WHERE definition ILIKE '%sns_mobile_reviews%') views,
 (SELECT count(*) FROM pg_constraint WHERE confrelid='public.sns_mobile_reviews'::regclass) inbound_fks,
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sns_mobile_revision(public.sns_drafts)'::regprocedure) revision_md5;
```

期待（2026-10-19 の本番）: `2` / `2026-10-18 01:28:53.946935+00` / `NULL` / `0` / `0` / `de924e8953e175677495feb450f1d675`。
n_reviews が 2 より多ければ、まだ使っている経路がある。適用せず調べる。

## 2. 適用（オーナー）

`163_drop_sns_mobile_approval.sql` を SQL Editor でそのまま1回実行する。

## 3. 適用後の確認（読み取り、Claude が実行）

```sql
SELECT to_regclass('public.sns_mobile_reviews') t,
 to_regprocedure('public.read_sns_mobile_race(uuid)') r,
 to_regprocedure('public.approve_sns_mobile_channel(uuid,uuid,text,jsonb,timestamptz,integer)') a,
 (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sns_mobile_revision(public.sns_drafts)'::regprocedure) keep_md5;
```

期待: `NULL` / `NULL` / `NULL` / `de924e8953e175677495feb450f1d675`。確かめたら APPLIED.md の 163 を「適用済み」にする。

## 戻し方

画面を戻すとき（#1645 とこの PR のコードの revert とセット）だけ、140 の次の部分を再実行する。

- `read_sns_mobile_race` と `approve_sns_mobile_channel` の CREATE FUNCTION
- `sns_mobile_reviews` の CREATE TABLE・RLS・REVOKE/GRANT
- 2関数の REVOKE/GRANT

`sns_mobile_revision` と `guard_sns_x_approval` は再実行しない（後のマイグレーションの定義を古い版で上書きするため）。
`approve_sns_mobile_channel` が呼ぶ `approve_sns_x_send(uuid,uuid,jsonb,timestamptz)` は 160 でも引数が同じなので、140 の本文のまま動く。
消した2行は APPLIED.md の 163 の行に値を残してある。

Vercel の Instant Rollback で #1645 より前に戻すと、旧画面が消えた RPC を呼んでエラーになる（失敗する側に倒れるだけで、データは壊れない）。
