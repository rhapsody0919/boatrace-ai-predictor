# 写しの出どころ（BOA-1477）

guard_direction.py・verify_guard.py と、その試験（tests/test_guard_direction.py・tests/test_verify_guard.py）は hq（rhapsody0919/hq）の同名のファイルの写し。判定を二重に書かないため、中身は変えない。

| この写し | hq の元 | hq の commit |
|---|---|---|
| guard_direction.py | scripts/guard_direction.py | 12b36749 |
| verify_guard.py | scripts/verify_guard.py | 0893e34b |
| tests/test_guard_direction.py | tests/test_guard_direction.py | 12b36749 |
| tests/test_verify_guard.py | tests/test_verify_guard.py | 0893e34b |

写すときに変えたのは試験の読み込みの場所だけ（判定器の本文は1字も変えない）:
- 両方の試験: `W / "scripts" / "<名>.py"` → `W / "<名>.py"`、`sys.path.insert(0, str(W / "scripts"))` → `sys.path.insert(0, str(W))`
- tests/test_verify_guard.py: node_modules と renderJsx の読みを `~/boatrace-ai-predictor` からこのリポジトリの根（`W.parents[2]`）へ

この写しだけのファイル: spec_guard.py（e2e の spec の比較）・run.py（CI の入口。3つの判定を束ねる）・tests/test_spec_guard.py・tests/test_run.py。
hq の側で元を直したら、同じ PR の形でこの写しを上書きする（上の置き換えだけを当てる）。
