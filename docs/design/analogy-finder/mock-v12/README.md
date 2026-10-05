# モック Version 12 のソース（BOA-271）

公開先: https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw （Version 12）。検証は [../verification-round4.md](../verification-round4.md)。

- `template12.html`: 画面と計算。`build-data.mjs` が data.js を作って `/*DATA*/` に差し込む
- `knn/`: 例のレースの近傍の計算（MD-6 の knn_p を土台に、出走表時点の特徴量、寄与度用モデル 2026-10-02 の重要度で重み付け）。knn2 = 全部を似ている順、knn3 = 勝率差の帯・1号艇の級別・勝率トップの艇をそろえた中を似ている順。再実行の順は knn2_md.py・knn3_md.py の docstring。結果の JSON（数MB）はコミットしていない
