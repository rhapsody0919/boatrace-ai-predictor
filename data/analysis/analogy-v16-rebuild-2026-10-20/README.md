# analogy-v16（龍神ソナー）の過去の1日分の作り直しの実測

hq のバックアップ（ST10）の問い「analogy-v16 の保存済みの値は、後から作り直せるか」への答えの記録。2026-10-20 に、2026-10-14 の1日分（156レース）を手元で作り直し、Storage の保存済みの値と比べた。**本番には書いていない。**

## 結論
- 専用の作り直しの CLI は無く、`scripts/ml/analogy/v16_morning.py --date` がその役をする（ADR-0085 の「結果」）。本番に書くのは `--upload` の分岐だけ
- 出走表の段の9種類のうち7種類（facts・scenario・scenario-boat・scenario-races・scenario-boat-races・today、run_id を除いた layer）は、解凍後のバイト列まで一致した
- similar-racecard・similar のずれは、すべて「当日のレースの行の時点」から来ていた。朝 07:12 の実行では天候・風・展示が空で、今は入っている。当日の行を朝の状態に戻すと（下の B）、similar-racecard は156件すべてバイト一致になった。similar は最大 1.2e-7 の端数だけが残った（CI の Linux と手元の Mac の差とみる。未検証）
- 母集団の時点の差（10-14 から 10-20 までの DB の後からの更新）は0だった。ただしこの日の結果で、補完・訂正が入った日には差が出うる（推測）
- モデルの版は、保存時と同じ 2026-10-06 を使えた（表示中なので消えない）。analogy バケットはモデルを最新3つしか残さないので、版が消えた日を作り直すと距離が変わりうる

## ファイルの種類ごとの比較

A は今のデータのまま作り直したもの。B は当日（10-14）の exhibition・results・start_timings の行を除き、conditions の天候・風向・風速・波高を空にして作り直したもの（朝の状態に近づけた）。

| 種類 | 件数 | バイト一致 A / B | 値の一致率 A | 数値の差 A（平均 / 最大） | 上位 N の重なりほか |
|---|---|---|---|---|---|
| facts | 1253 | 1253 / 1253 | 100% | 0 / 0 | |
| scenario | 217 | 217 / 217 | 100% | 0 / 0 | |
| scenario-boat | 1038 | 1038 / 1038 | 100% | 0 / 0 | |
| scenario-races | 217 | 217 / 217 | 100% | 0 | |
| scenario-boat-races | 1038 | 1038 / 1038 | 100% | 0 | |
| today | 156 | 156 / 156 | 100% | 0 / 0 | |
| layer | 156 | 0 / 0（run_id だけ違う） | run_id を除くと 100% | 0 / 0 | race_id の Jaccard 1.0 |
| similar-racecard | 156 | 0 / **156** | 96.57% | 0.073 / 3（展示で決まる5項目の判定が −1 → 0〜2） | 上位10・50・100・800 の重なりは全レース 1.0、距離の差は 0 |
| similar | 156 | 0 / 0 | 99.998%（B は 99.9996%） | A: 最大 1、B: 最大 1.19e-7 | 候補の上位3万の重なりは 1.0 |

- 比べなかったもの: similar-display と pool は、保存側が夜の掃除で翌日に消えている。展示後の段（exh-*）は Vercel の JS が作るので、この CLI の範囲外
- 全文: `cmp_saved_vs_A.{json,txt}`・`cmp_saved_vs_B.{json,txt}`。実行の記録: `runA.log`（約13分、最大メモリ 3.4GB）・`runB.log`・`export.log`。その日の snapshot（run_id・racecard_hash）: `snaps-1014.json`。保存側の一覧: `inspect-1014.txt`

## 注意
- 作り直したものを Storage に置く経路は無い。`--upload --races` で過去の日を作ると、racecard の snapshot を上書きして、run_id の指す先が置き換わる（`v16_morning.py:356-358,607`）。過去の日には `--upload` を付けない
- 当日の行を朝の状態に戻す引数は、今の CLI に無い。今回は CSV を手で加工した（BOA-910 で起票済み）
- 展示後の段は作り直せない（similar-display・pool が翌日に消えるため）

## 再実行の手順（本番に書かない）

スクリプトは `scripts/analysis/analogy-v16-rebuild/`。

1. 保存済みの値を読み取りだけで落とす（`guard.mjs` は GET・HEAD・Storage の一覧以外の通信を例外にする）
   ```bash
   node --env-file=.env.local --import ./scripts/analysis/analogy-v16-rebuild/guard.mjs scripts/analysis/analogy-v16-rebuild/download.mjs
   ```
   中の日付・run_id・出力先を、作り直す日に合わせて書き換える（`snaps.mjs` でその日の snapshot から run_id を読む）。similar/ は7日、similar-display/・pool/ は1日で消える
2. 母集団を書き出し、モデルを取る（`ANALOGY_DATA_DIR` を手元の作業用のディレクトリにする。`--refresh-kb` は付けない）
   ```bash
   ANALOGY_DATA_DIR=<作業用> node --env-file=.env.local --import ./scripts/analysis/analogy-v16-rebuild/guard.mjs scripts/ml/analogy/export_pool.js --daily
   ```
   ```bash
   ANALOGY_DATA_DIR=<作業用> node --env-file=.env.local --import ./scripts/analysis/analogy-v16-rebuild/guard.mjs scripts/ml/analogy/storage.js download-active-model
   ```
3. 作り直す。`SUPABASE_*` を外し、`--upload` は付けない。Python は 3.12 と `scripts/ml/analogy/requirements.txt` の版（pandas 3 は 3.11 以上が要る）
   ```bash
   env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY python scripts/ml/analogy/v16_morning.py --date 2026-10-14 --model <作業用>/model_win.txt --out <出力先>
   ```
   朝の状態（B）にするには、書き出した CSV から当日の exhibition・results・start_timings の行を除き、conditions の天候・風向・風速・波高を空にしてから動かす
4. 比べる
   ```bash
   python scripts/analysis/analogy-v16-rebuild/compare.py <保存済み> <作り直し> <結果.json>
   ```
