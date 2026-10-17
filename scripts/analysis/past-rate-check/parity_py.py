"""BOA-635 T0-1a: 判定式の二重実装の検査（Python 側）。

固定の行データ（JSON、layer の rows と同じ形）を label-threshold.py の options()・outcome_matrix() に通し、
選択肢ごとの一致件数 count と判定できる行数 n を JSON で標準出力に出す。JS 側は parity-check.mjs。
実行: python3 scripts/analysis/past-rate-check/parity_py.py <rows.json>
"""
import importlib.util
import json
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("label_threshold", HERE / "label-threshold.py")
LT = importlib.util.module_from_spec(spec)
spec.loader.exec_module(LT)

rows = json.loads(Path(sys.argv[1]).read_text())
cand = pd.DataFrame(rows)
opts = LT.options()
H, J = LT.outcome_matrix(cand, opts)
out = [{"sub": o["sub"], "key": o["key"], "opt": {k: (sorted(v) if isinstance(v, set) else v) for k, v in o.items() if k not in ("j",)},
        "count": int(H[:, k].sum()), "n": int(J[:, o["j"]].sum())} for k, o in enumerate(opts)]
print(json.dumps({"tech4": list(LT.TECH4), "options": out}, ensure_ascii=False))
