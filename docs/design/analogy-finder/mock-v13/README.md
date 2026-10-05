# モック Version 13 のソース（BOA-271）

公開先: https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw （Version 13）。検証は [../verification-round5.md](../verification-round5.md)。

- `template13.html`: 画面と計算（3タブ）。`build-data.mjs` が data.js を作って差し込む
- `env-check.md`・`env_check.py`: 天候・水面とレースの条件の、艇番ごとの向き（寄与度用モデル 2026-10-02）
- `prep6.md`・`gen_p6.js`・`build6.js`・`pool_base6.sql`・`p6_tail.sql`: 艇番×風速・波高・天候・グレード・ラウンドの着順率（数えた値、120 の母集団、前日まで）
- `share-cube2.md`・`share_cube.py`: 会場×グレード×ラウンドごとのテーマ単位の割合と SD（前日まで、穴の月を除く）
- 近傍の計算は [../mock-v12/knn/](../mock-v12/knn/)
