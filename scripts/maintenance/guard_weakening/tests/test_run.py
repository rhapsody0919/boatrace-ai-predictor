#!/usr/bin/env python3
"""run.py（CI の job の判定の全体）の試験。小さな本物の git（外へ出ない）に base と枝を作り、弱める PR 各1本が赤・弱めない PR が緑になるか。
verify の変異検査の場合は @babel/parser（リポジトリの根の node_modules）が要る。無ければその場合だけ飛ばす（飛ばした数を出す）。
`python3 scripts/maintenance/guard_weakening/tests/test_run.py`"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

W = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(W))
import run as rn  # noqa: E402

NM = W.parents[2] / "node_modules"
HAVE_NM = (NM / "@babel" / "parser").is_dir()
ok, skipped = [], 0


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:800]}"))


M = "scripts/maintenance/"
SPEC = "e2e/racer.spec.js"
ND = M + "verify-no-undef-allowlist.json"
KY = M + "kyotei-wording-allowlist.json"
REG = M + "verify-registry.json"
V = M + "verify-calc.js"
SPEC_TEXT = ('import { test, expect } from "./fixtures.js";\n'
             'test("F の点が出る", async ({ page }) => {\n  await page.goto("/racer/1");\n'
             '  const box = await page.locator(".f-dot").boundingBox();\n  expect(box).not.toBeNull();\n  expect(box.width).toBeGreaterThan(0);\n});\n')
ND_DOC = {"rules": {"no-undef": {"src/a.js": {"names": ["window", "document", "x1", "x2"], "reason": "古い"}}}}
KY_DOC = {"entries": [{"file": "src/a.jsx", "line": "競艇"}]}
CALC = "export function clamp(x) {\n  if (x > 10) return 10;\n  return x;\n}\n"
STRONG = 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'
EMPTY = 'import { clamp } from "../../src/calc.js";\nvoid clamp;\n'
REG_DOC = {"entries": [{"script": "verify-calc.js", "tier": "ci"}]}


def J(o):
    return json.dumps(o, ensure_ascii=False, indent=2) + "\n"


def g(d, *a):
    subprocess.run(["git", *a], cwd=d, check=True, capture_output=True)


def repo(files):
    d = Path(tempfile.mkdtemp(prefix="gw-run-"))
    g(d, "init", "-q", "-b", "master")
    g(d, "config", "user.email", "t@example.invalid")
    g(d, "config", "user.name", "t")
    write(d, files)
    g(d, "add", "-A")
    g(d, "commit", "-q", "-m", "base")
    g(d, "branch", "base")
    if HAVE_NM:
        os.symlink(NM, d / "node_modules")
        (d / ".git" / "info" / "exclude").write_text("node_modules\n")
    return d


def write(d, files):
    for p, t in files.items():
        f = d / p
        if t is None:
            f.unlink()
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(t, encoding="utf-8")


def pr(files, base_files=None, mv=None):
    """base_files の上に枝を作り files を書いて commit。(赤の理由, 警告)"""
    d = repo(base_files or BASE)
    try:
        if mv:
            g(d, "mv", *mv)
        write(d, files)
        g(d, "add", "-A")
        g(d, "commit", "-q", "--allow-empty", "-m", "head")
        e, w, _ = rn.evaluate(d, "base")
        return e, w
    finally:
        shutil.rmtree(d, ignore_errors=True)


BASE = {SPEC: SPEC_TEXT, ND: J(ND_DOC), KY: J(KY_DOC), "src/calc.js": CALC, V: STRONG, REG: J(REG_DOC), "README.md": "x\n"}

print("弱める PR は赤")
e, _ = pr({SPEC: SPEC_TEXT.replace("  expect(box.width).toBeGreaterThan(0);\n", "")})
check("spec の expect を減らす: 赤", any(x.startswith("SPEC") and "expect が減った" in x for x in e), e)
e, _ = pr({SPEC: SPEC_TEXT.replace('test("F の点', 'test.skip("F の点')})
check("spec に skip を足す: 赤", any("skip が増えた" in x for x in e), e)
e, _ = pr({ND: J({"rules": {"no-undef": {"src/a.js": {"names": ["window", "document", "x1", "x2", "x3"], "reason": "古い"}}}})})
check("許可リストへ行を足す: 赤", any(x.startswith("ALLOW") and "行が増える" in x for x in e), e)
e, _ = pr({M + "new-thing-allowlist.json": J({"entries": []})})
check("形の表に無い許可リストを足す: 赤", any("形の表" in x for x in e), e)
if HAVE_NM:
    e, _ = pr({V: EMPTY})
    check("verify の検査を空にする: 赤（変異検査）", any(x.startswith("VERIFY") for x in e), e)
    e, _ = pr({REG: J({"entries": [*REG_DOC["entries"], {"script": "verify-old.js", "tier": "ci"}]})})
    check("新しい verify なしで registry に行を足す: 赤", any("新しく足した verify が無い" in x for x in e), e)
else:
    skipped += 2
    print("   SKIP node_modules（@babel/parser）が無い。verify の変異検査の2件を飛ばした")

print("弱めない PR は緑")
stab = SPEC_TEXT.replace('  const box', '  await page.locator(".f-dot").waitFor();\n  const box')
e, w = pr({SPEC: stab, ND: J({"rules": {"no-undef": {"src/a.js": {"names": ["window", "document", "x1"], "reason": "古い"}}}})})
check("#2382 型（許可リストの行の削除1・spec の安定化）: 緑", not e, e)
e, _ = pr({"README.md": "y\n", "src/calc.js": CALC.replace("10", "11")})
check("守りに関係しない変更: 緑", not e, e)
e, _ = pr({KY: J({"entries": [{"file": "src/b.jsx", "line": "競艇"}]})}, mv=("src/calc.js", "src/calc2.js"))
check("許可リストの中身を差し替える（付け替えで説明できない）: 赤", any(x.startswith("ALLOW") for x in e), e)
e, _ = pr({"e2e/new.spec.js": SPEC_TEXT})
check("spec の新規の追加: 緑", not e, e)
if HAVE_NM:
    e, _ = pr({V: STRONG + "if (clamp(11) !== 10) process.exit(1);\n"})
    check("verify の検査を強める: 緑", not e, e)
else:
    skipped += 1

print("止める側")
d = repo(BASE)
try:
    code = rn.main(["--repo", str(d), "--base", "no-such-ref"])
    check("base が読めない: 赤（終了コード 1）", code == 1, code)
finally:
    shutil.rmtree(d, ignore_errors=True)

print(f"\n{sum(ok)}/{len(ok)} OK" + (f"（飛ばし {skipped}）" if skipped else ""))
sys.exit(0 if all(ok) else 1)
