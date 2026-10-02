# モック Version 11 のソース（BOA-271）

公開先: https://claude.ai/artifact/PmBJj2kX13venVRWs5E2Cw （Version 11）。検証は [../verification-round3.md](../verification-round3.md)。

- `template11.html`: 画面と計算。`build-data.mjs`（mock-v10 と共通の組み立てに prep5 を足したもの）が data.js を作り、`/*DATA*/` に差し込む
- 似たレースの集計: `pool_base5.sql`（120 の母集団の定義をインライン化し、ステージ名と払戻を足したもの）＋`p5_tail.sql`（`gen_p5.js` が生成）、合算と検算は `build5.js`。4条件の全16通り＋任意3条件、例のレースの前日（2026-09-26）まで
- 寄与度・cube などの残りは [../mock-v10/](../mock-v10/) と同じ
