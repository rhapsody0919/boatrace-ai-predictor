# モック Version 10 のソース（BOA-271）

公開先: https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw （Version 10）。検証は [../verification-round2.md](../verification-round2.md)。

- `template.html`: 画面と計算。`build-data.mjs` が実データ・モデルの集計（prep*.json・model-prep.json）から `data.js` を作り、`/*DATA*/` に差し込んで1枚の HTML にする
- `prep.md`・`prep2.md`: 本番 DB を 120 の母集団の定義で数えた集計（表と出典）。SQL・組み立てスクリプトは `prep-sql/`（120 の関数本体を SELECT にインラインで写したもの。読み取りのみ）
- `model-prep/`: 寄与度用の本番モデル（版 2026-10-02）での計算。特徴量は学習時のコード（dc6d02084）で作る。手順は `model-prep/assemble.py` の docstring と `run.sh`
- 集計結果の JSON（prep*.json・model-prep.json、合計約1.5MB）はコミットしていない。上のスクリプトで作り直せる
