# 「風とイン逃げ率」タブの集計の作り直し（四半期ごと）

分析ツールの「風とイン逃げ率」タブ（BOA-211）は、DB ではなく静的な集計 `public/data/weather-in-escape.json` を読む。集計は公式Kファイルから、分析と同じスクリプトで作る（2026-10-02 ユーザー判断: 四半期ごとに手で作り直し、集計期間を画面に出す）。

## 時期

1月・4月・7月・10月の上旬。前の四半期の末日までのKファイルが揃ってから行う。次回は Linear のチケットで管理する（作り直しのたびに次回のチケットを起票する）。

## 手順

1. Kファイルの解析済みファイルが前の四半期の末日まで揃っていることを確かめる（`~/boatrace-archive-backup/kb-archive/parsed/YYYYMM/`。足りない月は `scripts/maintenance/kb-backfill.js` で取得・解析する）
2. スクリプトの期間の終わり（`TO`）を前の四半期の末日に変える
3. 実行する

   ```bash
   node scripts/analysis/analyze-weather-in-escape.js
   ```

   `data/analysis/weather-in-escape.json`（分析の全結果）と `public/data/weather-in-escape.json`（画面用）が更新される。Kファイルの場所が既定と違う場合は `KB_ARCHIVE_DIR` を付ける
4. 判定（`wind.judge`）を確かめる。事前登録（`docs/design/weather-in-escape/preregistration.md` §6）の5基準のどれかが崩れたら、画面の一言（`weatherInEscape.headline`）が言い過ぎになっていないかを見直し、`results.md` に追記する。崩れていなければ文言はそのまま
5. 期間を延ばしたことは、事前登録の判定を同じデータで見直したことになる。`results.md` の末尾に「YYYY-MM-DD 作り直し: 期間・行数・判定・inputHash」を1行で追記する
6. PR を作る（変更は2つの JSON と、必要なら `results.md`・スクリプトの `TO`）

## 注意

- 集計方法（区分・会場の向きの変換・区間）を変えるときは、作り直しではなく新しい分析として事前登録からやり直す（`.claude/rules/analysis.md`「モデル・統計分析の検証」）
- 会場の向き（`VENUE_WIND_OFFSET`）は、水面の改修等で変わらない限りそのまま。変わった疑いがあるときは、公式の結果ページの `is-direction{d}` を取り直して `(d + 7) mod 16` と照合する（事前登録 1.1）
