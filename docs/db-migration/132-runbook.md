# 132 の適用と学習1回の手順（BOA-271 AIの見立て）

マイグレーション 132（`analogy_contribution_profiles` に `stage`・`frame_ratio`、主キーの作り直し）の本番適用と、
7テーマ・Version 14・出走表時点のモデル3本・優勝戦の判定 v2 を入れた学習を1回流す手順。

## 順序（入れ替えない）
1. ユーザー: SQL Editor で 132 を適用する（下の「1」）
2. Claude: 適用の確認（下の「2」の SELECT。読み取りなので Claude が実行してよい）
3. ユーザー: PR をマージする（stage を読み書きするコード）
4. ユーザー: GitHub → Actions → Train Analogy Finder → Run workflow（branch: master、版の名前は空欄でよい）
5. Claude: 学習後の確認（下の「4」）

コードを 1 より先にマージすると、API（`/api/analogy/contribution`）と画面の直読みが `stage=eq.…` で「列が無い」と失敗する
（AIの見立ては機能フラグで非公開なので、一般の画面には出ない）。学習の書き込みも `stage` 列が無いので失敗する（表示は前の版のまま）。

## 1. 適用する SQL（全文）
`docs/db-migration/132_analogy_contribution_profiles_stage.sql` と同じ。

```sql
BEGIN;

ALTER TABLE public.analogy_contribution_profiles
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'exhibition';

ALTER TABLE public.analogy_contribution_profiles
  DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_stage_check;
ALTER TABLE public.analogy_contribution_profiles
  ADD CONSTRAINT analogy_contribution_profiles_stage_check
  CHECK (stage IN ('exhibition', 'racecard'));

ALTER TABLE public.analogy_contribution_profiles
  ADD COLUMN IF NOT EXISTS frame_ratio double precision;

-- 主キーを stage を含む形に作り直す（同じ版・同じスライスに2段の行を置くため）
ALTER TABLE public.analogy_contribution_profiles
  DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_pkey;
ALTER TABLE public.analogy_contribution_profiles
  ADD CONSTRAINT analogy_contribution_profiles_pkey
  PRIMARY KEY (model_version, stage, finish_target, venue_code, grade, round, boat_number);

COMMENT ON COLUMN public.analogy_contribution_profiles.stage IS
  'BOA-271 段。exhibition＝展示後のモデル（直前情報あり）、racecard＝出走表時点のモデル（直前情報なし）';

COMMENT ON COLUMN public.analogy_contribution_profiles.frame_ratio IS
  'BOA-271 枠（boat_number）の SHAP の大きさ ÷ テーマの大きさの和（割合から除いた枠の分。同じ二重の中心化）';

COMMIT;
```

- 既存の 12,180 行（版 2026-10-02）は `stage = 'exhibition'`、`frame_ratio = NULL` になる
- 主キーの作り直しで索引を作り直す（12,180 行なので一瞬）。テーブルのロックは適用の間だけ

## 2. 適用の確認（読み取り）
```sql
-- 列（stage は text・NOT NULL・既定 'exhibition'、frame_ratio は double precision・NULL 可）
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'analogy_contribution_profiles'
  and column_name in ('stage', 'frame_ratio');

-- 制約（主キーが stage を含む、stage の CHECK がある）
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.analogy_contribution_profiles'::regclass and contype in ('p', 'c');

-- 既存の行がすべて exhibition（期待: 2026-10-02 / exhibition / 12180）
select model_version, stage, count(*) from analogy_contribution_profiles group by 1, 2;
```

## 3. 学習（Actions の手動実行）
- 前提: 欠場艇の行の補完（#1199）・風向（#1213）が入った master であること（入っている）
- 長期分のキャッシュは kb_races だけ v3 になる（名前 `stage` を足したため）。初回は kb_races の長期分（2019-04〜2025-12、約37万行）を
  DB から読み直して `analogy/source/v3/kb_races/` に置く。ほかの表は v2 のキャッシュを読む。前後で Supabase Dashboard の Disk IO を確認する
- 所要時間の見込み: 前回（約50分）に、出走表時点の3本の学習・seed の再学習・集計の分（数十分）が加わる。timeout は240分
- 品質ゲート（事前登録5 の判定1〜5）で止まったら何も書かれず、今の版の表示が続く。そのときは Step Summary の理由をオーケストレーターに知らせる

## 4. 学習後の確認（読み取り）
```sql
-- 表示中の版が新しい版に変わった
select model_version, is_active, jsonb_array_length(themes) as n_themes from analogy_models order by trained_at desc limit 2;

-- 新しい版の段ごとの行数（展示後・出走表時点の両方がある）
select p.stage, p.finish_target, count(*)
from analogy_contribution_profiles p join analogy_models m using (model_version)
where m.is_active group by 1, 2 order by 1, 2;

-- 全国の1号艇の行: 7テーマ（出走表時点は天候・水面が無い6テーマ）と frame_ratio（1着の展示後で 0.15 前後の見込み）
select p.stage, p.finish_target, p.shares, p.frame_ratio
from analogy_contribution_profiles p join analogy_models m using (model_version)
where m.is_active and p.venue_code = 0 and p.grade = 'all' and p.round = 'all' and p.boat_number = 1
order by 1, 2;
```
- Step Summary の「版 … に切り替えた」、一致検査（Parity check）が緑
- 事前登録5 の記録（`perrace_record.json`、Storage の `{版}/perrace_record.json.gz`）を、事前登録の SHA（e115e3592・24081d9d8）つきで `analysis/` に書く（学習側レーン）
- 古いキャッシュ `analogy/source/v2/kb_races/` は読まれなくなる。学習が1回成功した後に Dashboard → Storage で消してよい（ほかの表の `source/v2/` は消さない）

## 戻し方
コードを先に戻す（PR の revert をマージする）。その後、出走表時点の行を消してから列と主キーを戻す。

```sql
BEGIN;
DELETE FROM public.analogy_contribution_profiles WHERE stage = 'racecard';
ALTER TABLE public.analogy_contribution_profiles DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_pkey;
ALTER TABLE public.analogy_contribution_profiles
  ADD CONSTRAINT analogy_contribution_profiles_pkey
  PRIMARY KEY (model_version, finish_target, venue_code, grade, round, boat_number);
ALTER TABLE public.analogy_contribution_profiles DROP CONSTRAINT IF EXISTS analogy_contribution_profiles_stage_check;
ALTER TABLE public.analogy_contribution_profiles DROP COLUMN IF EXISTS stage;
ALTER TABLE public.analogy_contribution_profiles DROP COLUMN IF EXISTS frame_ratio;
COMMIT;
```
- 新しい版で学習した後に戻すと、表示中の版の展示後の行は7テーマの新しい定義のまま残る（前の版の行は db.py の prune でロールバック先として残っている）。
  前の版に戻すなら、`select activate_analogy_model('2026-10-02');`（service_role）で表示に使う版を切り替える
