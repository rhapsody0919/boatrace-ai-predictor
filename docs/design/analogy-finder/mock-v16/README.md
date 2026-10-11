# モック Version 16 の作り方

- template15.html（mock-v14 以前の流れ）から `make16.py` で template16.html を作る
- データ: data.js（build-data.mjs）＋ scn.js（`mkscn.cjs`。prep8.json・prep8b.json から）＋ tab1.json（`tab1_facts.py`。knn/work2 の母集団から、範囲別・同率込みで数える）
- `assemble16.py` で `/*DATA*/` に埋め込み、analogy-finder-v16.html にする
- 集計の記録: ../entry-slit/（prep7.md・prep8/）。統計の検証: ../verification-round8.md
