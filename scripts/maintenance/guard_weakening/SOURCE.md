# 写しの出どころ（BOA-1477）

guard_direction.py・verify_guard.py と、その試験（tests/test_guard_direction.py・tests/test_verify_guard.py・tests/test_verify_guard_vdata.py・tests/test_verify_guard_oldred.py・tests/test_verify_guard_falsered.py）は hq（rhapsody0919/hq）の同名のファイルの写し。判定を二重に書かないため、中身は変えない。

| この写し | hq の元 | hq の commit |
|---|---|---|
| guard_direction.py | scripts/guard_direction.py | 12b36749 |
| verify_guard.py | scripts/verify_guard.py | 996bf252 |
| tests/test_guard_direction.py | tests/test_guard_direction.py | 12b36749 |
| tests/test_verify_guard.py | tests/test_verify_guard.py | 996bf252 |
| tests/test_verify_guard_oldred.py | tests/test_verify_guard_oldred.py | 996bf252 |
| tests/test_verify_guard_falsered.py | tests/test_verify_guard_falsered.py | 996bf252 |
| tests/test_verify_guard_vdata.py | tests/test_verify_guard_vdata.py | 996bf252 |

写すときに変えたのは試験の読み込みの場所だけ（判定器の本文は1字も変えない）:
- どの試験も: `W / "scripts" / "<名>.py"` → `W / "<名>.py"`、`sys.path.insert(0, str(W / "scripts"))` → `sys.path.insert(0, str(W))`
- node_modules・龍神の git の場所の読みを `~/boatrace-ai-predictor` からこのリポジトリの根（`W.parents[2]`）へ（`Path(os.path.expanduser("~/boatrace-ai-predictor…"))` → `W.parents[2]…`）
- sandbox-exec の無い所（Linux の CI）では、test_verify_guard_oldred.py・test_verify_guard_falsered.py は node を回す試験を自分で飛ばす

この写しだけのファイル: spec_guard.py（e2e の spec の比較）・run.py（CI の入口。3つの判定を束ねる）・mut_lock.py（hq の変異のロックの代わり。verify_guard.py が import する名前を置くだけで、GitHub Actions の上では何も取らない）・tests/test_spec_guard.py・tests/test_run.py。
hq の側で元を直したら、同じ PR の形でこの写しを上書きする（上の置き換えだけを当てる）。
