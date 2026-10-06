# モック Version 14 のソース（BOA-271）

公開先: https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw （Version 14）。検証は [../verification-round6.md](../verification-round6.md)。

- `template14.html`: 画面。`make14.py` が template13 の1つ目のタブを `part14_ai.html`・`part14_ai.js` で置き換えて作る。`build-data.mjs` が data.js を作って差し込む
- `boat_profile2.py`・`boat-profile2.md`: 艇番ごとの材料（寄与度用モデル 2026-10-02）。テーマ・グループ単位の SHAP を、レースの中で中心化してから艇番の中で中心化した値。枠は除く。1号艇は「1号艇の格」を全国勝率に合算する
- ②③のタブは [../mock-v13/](../mock-v13/)・[../mock-v12/](../mock-v12/) と同じ
