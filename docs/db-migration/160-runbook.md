# 160 の適用手順（sns-pdca-loop: /today の X 投稿に画像を最大4枚）

マイグレーション160（承認の関数 `approve_sns_x_send` の X の媒体の照合を、下書きの `source_data.image_paths`（1〜4枚）に合わせる）の本番適用の手順。2026-10-16 のユーザー決定（/today の X 投稿の画像を、対象レースの龍神ソナーの図に変え、別々に最大4枚にする）。設計は `docs/design/sns-pdca-loop/plan.md` §8。

適用しても**送信は始まらない**（x の `dry_run` と `sns_x_send_control.paused` はそのまま）。

## 変わること・変わらないこと
- 変わる: X の下書きに `source_data.image_paths` があるときだけ、承認の snapshot の媒体を「その数（1〜4）・その順・画像（png・jpeg）・1枚 5 MB（5,000,000 バイト）まで」と照合する。先頭は `cover_image_path` と同じでなければならない。動画と一緒には使えない
- 変わらない: `image_paths` の無い下書き（今までの X の1枚・YouTube）の照合。承認の後に `image_paths` が変われば、148 のトリガー（source_data の変化）が承認を外す。個別承認の版（140 `sns_mobile_revision`）も source_data を含むので、そのまま効く
- 置き換えるのは `approve_sns_x_send` の1関数だけ（土台は 158 の定義）。表・列・トリガーは変えない

## 手順1（実行前の確認・読み取りのみ）
```sql
-- 期待値: ok=true（本番が 158 の定義のまま）。false なら適用しない
SELECT md5(pg_get_functiondef('public.approve_sns_x_send(uuid,uuid,jsonb,timestamptz)'::regprocedure)) = '72126a0fd13dd053827ffef57bc55232' AS ok;
-- 期待値: paused=true、x の dry_run=true（適用しても送信が始まらないことの確認）
SELECT (SELECT paused FROM public.sns_x_send_control WHERE id = true) AS paused,
       (SELECT dry_run FROM public.sns_auto_send_control WHERE channel = 'x') AS x_dry_run;
-- 期待値: 0（送信中・要照合の job が無い）
SELECT count(*) FROM public.sns_x_send_jobs WHERE state IN ('sending', 'reconcile');
```

## 手順2（本体）
`docs/db-migration/160_sns_x_multiple_images.sql` の全文を1回で実行する（BEGIN〜COMMIT）。

## 手順3（実行後の確認・読み取りのみ。Claude が行う）
```sql
-- 期待値: ok=true
SELECT md5(pg_get_functiondef('public.approve_sns_x_send(uuid,uuid,jsonb,timestamptz)'::regprocedure)) = '7ef31819208cccc44ca6bf65b8a6df09' AS ok;
-- 期待値: anon・auth は false、sr は true
SELECT has_function_privilege('anon', 'public.approve_sns_x_send(uuid,uuid,jsonb,timestamptz)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.approve_sns_x_send(uuid,uuid,jsonb,timestamptz)', 'EXECUTE') AS auth,
       has_function_privilege('service_role', 'public.approve_sns_x_send(uuid,uuid,jsonb,timestamptz)', 'EXECUTE') AS sr;
```

## 戻し方
`docs/db-migration/158_sns_lanes_digest_period.sql` の `approve_sns_x_send` の定義（`CREATE OR REPLACE FUNCTION public.approve_sns_x_send` から `$$;` まで）と、その後の REVOKE・GRANT の2行を実行する。戻した後、手順1の md5 が true になることを確かめる。戻すと、`image_paths` のある下書き（/today の画像が2枚以上）は承認できなくなる（承認の関数が媒体を1つとして照合するため）。ただし、160 の下で承認済みの queued の job は、戻した後もそのまま複数枚で送られる（送信の関数・runXSendJob は媒体の数を照合し直さない）。止めたいなら、戻す前にその job を取り消す（下書きを pending_review に戻すと 148 のトリガーが cancelled にする）。
