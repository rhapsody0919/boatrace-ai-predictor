#!/usr/bin/env python3
"""scripts/verify_guard.py の verifyData/（verify-*.js が import する本・fixture）の判定の試験（ops 審査 20261118-165852 §1 P1）。
test_verify_guard.py と分けたのは pre-commit の1本90秒の上限のため。@babel/parser は龍神の node_modules を使う。無ければ node の試験を飛ばす。
`python3 tests/test_verify_guard_vdata.py`"""
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

W = Path(__file__).resolve().parent.parent
os.environ["HQ_TEST"] = "1"  # 変異のロック（scripts/mut_lock.py）を試験では迂回する（pre-commit の1本90秒の上限・負荷の線で待たない）
spec = importlib.util.spec_from_file_location("verify_guard", W / "verify_guard.py")
vg = importlib.util.module_from_spec(spec)
sys.modules["verify_guard"] = vg
spec.loader.exec_module(vg)

NM = W.parents[2] / "node_modules"
HAVE_NM = (NM / "@babel" / "parser").is_dir()
ok, skipped = [], 0


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:600]}"))


def mk(files):
    d = Path(tempfile.mkdtemp(prefix="vg-test-"))
    (d / "package.json").write_text('{"type":"module"}')
    for p, t in files.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_text(t)
    return d


CALC = ("export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
        "export function isBig(x) {\n  return x >= 5 && x !== 7;\n}\n")
STRONG = 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 10) process.exit(1);\n'
V = "scripts/maintenance/verify-calc.js"
CFG = {"node_modules": str(NM), "max_mutants_per_verify": 40, "run_timeout_sec": 60}

# ---------- verifyData/（ops 審査 20261118-165852 §1 P1: verify の本だけを変える PR も変異で比べる） ----------
print("verifyData/: 読む verify を逆に辿り、旧の本と新の本で比べる")
DV = "scripts/maintenance/verify-dcalc.js"
DC = "scripts/maintenance/verifyData/calc-cases.js"
DCL = "scripts/maintenance/verifyData/calc-clamp.js"
DBG = "scripts/maintenance/verifyData/calc-big.js"
CASES = 'export const CASES = [[20, 10], [3, 3]];\nexport const BIG = [[5, true], [4, false], [7, false]];\n'
DVER = ('import { clamp, isBig } from "../../src/calc.js";\nimport { CASES, BIG } from "./verifyData/calc-cases.js";\n'
        'for (const [x, y] of CASES) if (clamp(x) !== y) process.exit(1);\nfor (const [x, y] of BIG) if (isBig(x) !== y) process.exit(1);\n')
DMASTER = {DV: DVER, DC: CASES}
check("is_verify_path: verifyData/ の下（どの深さも）", vg.is_verify_path(DC) and vg.is_verify_path(DC.replace("calc-cases", "sub/x")) and not vg.is_verify_path("scripts/maintenance/verifyData/"))
d = mk({V: STRONG, DV: DVER, DC: CASES.replace("[7, false]", ""), "src/calc.js": CALC,
        DBG: 'import { BIG } from "./calc-cases.js";\nexport { BIG };\n', "scripts/maintenance/verify-other.js": 'import { x } from "./verifyData/other.js";\n'})
r = vg.data_readers(d, {DC: "M", "scripts/maintenance/verifyData/gone.js": "D"}, {DC: CASES, "scripts/maintenance/verifyData/gone.js": "export {};\n"}.get)
check("data_readers: 直と verifyData/ を経た推移で verify を拾う・読まれない本は空", r == {DC: [DV], "scripts/maintenance/verifyData/gone.js": []}, r)
shutil.rmtree(d)
d = mk({"src/calc.js": CALC, DV: DVER, DC: CASES})
check("product_files: verifyData/ の本は製品に数えず、その本が指す物を辿る",
      vg.product_files(d, DV, [DVER]) == ["src/calc.js"]
      and vg.product_files(d, DV, ['import { CASES } from "./verifyData/calc-cases.js";\n'], {DC: ['import "../../../src/calc.js";\n']}) == ["src/calc.js"], vg.product_files(d, DV, [DVER]))
shutil.rmtree(d)
if HAVE_NM:
    d = mk({"src/calc.js": CALC, DV: DVER, DC: CASES.replace(", [7, false]", "")})
    v = vg.evaluate(d, {DC: "M"}, DMASTER.get, CFG)
    rec = [x for x in v.record.get("mutation") or [] if x.get("via_data")]
    check("fixture を削って弱める（verifyData/ だけの PR）: 赤（人へ）", DC not in v.excused and any("読む verify" in h for h in v.human) and rec and rec[0].get("missed"), (v.excused, v.human, rec))
    check("弱めの見本でも本と製品は元に戻っている", (d / "src/calc.js").read_text() == CALC and (d / DC).read_text() == CASES.replace(", [7, false]", ""))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, DV: DVER, DC: 'export { CASES } from "./calc-clamp.js";\nexport { BIG } from "./calc-big.js";\n',
            DCL: 'export const CASES = [[20, 10], [3, 3]];\n', DBG: 'export const BIG = [[5, true], [4, false], [7, false]];\n'})
    v = vg.evaluate(d, {DC: "M", DCL: "A", DBG: "A"}, DMASTER.get, CFG)
    check("無害な分割（本を2つに割って再輸出）: 緑", v.excused == {DC, DCL, DBG} and not v.human, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, DV: DVER.replace("process.exit(1);\n", "process.exit(1);\nconst more = 1;\n", 1), DC: CASES.replace(", [7, false]", "")})
    v = vg.evaluate(d, {DV: "M", DC: "M"}, DMASTER.get, CFG)
    check("verify と本を一緒に変えて弱める: verify も本も赤（旧は master の本で回す）", DV not in v.excused and DC not in v.excused, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, DV: DVER, DC: CASES, "scripts/maintenance/verifyData/orphan.js": "export const X = 1;\n"})
    v = vg.evaluate(d, {"scripts/maintenance/verifyData/orphan.js": "A"}, DMASTER.get, CFG)
    check("どの verify も読まない本の追加: 人へ（辿れない）", not v.excused and any("辿れず" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, DV: DVER, DC: CASES + 'import { execSync } from "node:child_process";\n'})
    v = vg.evaluate(d, {DC: "M"}, DMASTER.get, CFG)
    check("本に child_process を足す: 人へ（静的な語）", DC not in v.excused and any("child_process" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

if not HAVE_NM:
    skipped = 1
    print("   SKIP @babel/parser が無い（~/boatrace-ai-predictor/node_modules）。node を回す試験を飛ばした")
print(f"\n{sum(ok)}/{len(ok)} OK" + (f"（飛ばし {skipped}）" if skipped else ""))
sys.exit(0 if all(ok) else 1)
