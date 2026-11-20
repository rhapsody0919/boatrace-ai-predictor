#!/usr/bin/env python3
"""scripts/verify_guard.py の偽の赤3型の直し（11/20 オーナー yes、drafts/hr34-guard-false-red-20261120.md）の試験。
(1) 比べられない（製品の import が無い・base でも旧が通らない・base でも旧が変異を落とさない）は Verdict.incomparable に分かれ、excused には入らない。
    確かめの形の数が弱い側へ動いた物・削除・base_ref の無い呼び方・base では旧が変異を落とす物（PR の木の水増し）は赤のまま
(2) apply_mutant は @babel/parser の位置（UTF-16 の単位）で切る（絵文字入りの見本）
(3) 取りこぼしは旧・新を1回ずつ回し直す（旧の揺れは数えない・新の揺れは緑にしない・2回とも同じなら弱め）
@babel/parser は龍神の node_modules を使う。無ければ node の試験を飛ばす。`python3 tests/test_verify_guard_falsered.py`"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

W = Path(__file__).resolve().parent.parent
os.environ["HQ_TEST"] = "1"  # 変異のロック（scripts/mut_lock.py）を試験では迂回する
spec = importlib.util.spec_from_file_location("verify_guard", W / "verify_guard.py")
vg = importlib.util.module_from_spec(spec)
sys.modules["verify_guard"] = vg
spec.loader.exec_module(vg)

RYUJIN = W.parents[2]
NM = RYUJIN / "node_modules"
HAVE_NM = (NM / "@babel" / "parser").is_dir()
ok, skipped = [], 0
CFG = {"node_modules": str(NM), "max_mutants_per_verify": 40, "run_timeout_sec": 60}
V = "scripts/maintenance/verify-x.js"
DATA = "scripts/maintenance/verifyData/x-cases.js"


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:1200]}"))


def git(d, *a):
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *a], cwd=d, check=True, capture_output=True)


def repo(base, head):
    """base の木を commit し、その上に head の木（None は消す）を commit した git の作業場所。返す: (場所, base の SHA, 変更の一覧)"""
    d = Path(tempfile.mkdtemp(prefix="vg-fr-"))
    git(d, "init", "-q")
    for p, t in {"package.json": '{"type":"module"}', **base}.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_text(t, encoding="utf-8")
    git(d, "add", "--", *["package.json", *base])
    git(d, "commit", "-q", "-m", "base")
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=d, capture_output=True, text=True, check=True).stdout.strip()
    for p, t in head.items():
        if t is None:
            git(d, "rm", "-q", "--", p)
        else:
            (d / p).parent.mkdir(parents=True, exist_ok=True)
            (d / p).write_text(t, encoding="utf-8")
            git(d, "add", "--", p)
    git(d, "commit", "-q", "-m", "head")
    return d, sha, vg.name_status(d, sha)


def judge(base, head, cfg=None, with_base=True, run=None):
    d, sha, changes = repo(base, head)
    try:
        kw = {"run": run} if run else {}
        return vg.evaluate(d, changes, vg.git_show(d, sha), {**CFG, **(cfg or {})}, base_ref=sha if with_base else None, **kw)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def outcomes(v):
    return {str(r["script"]): r.get("outcome") for r in v.record.get("mutation") or []}


def red(v, p=V):
    return p not in v.excused and not v.incomparable and any(h.startswith(p) for h in v.human)


def inc(v, p=V):
    return p not in v.excused and any(h.startswith(p) and vg.INCOMPARABLE_HEAD in h for h in v.incomparable) and all(h in v.human for h in v.incomparable)


print("(2) apply_mutant は UTF-16 の位置で切る")
src = 'const A = "😀"; const B = "x";\nexport const f = (x, y) => x && y;\n'.encode("utf-8")
u16 = src.decode("utf-8").encode("utf-16-le")
at = u16.index(" && ".encode("utf-16-le")) // 2
out = vg.apply_mutant(src, {"start": at, "end": at + 4, "repl": " || "}).decode("utf-8")
check("絵文字の後ろの && を || に（前後の字は変わらない）", out == src.decode("utf-8").replace("&&", "||"), out)
check("BMP の中だけの本文は今までと同じ", vg.apply_mutant("ab && cd".encode(), {"start": 2, "end": 6, "repl": " || "}) == b"ab || cd")

if not (HAVE_NM and vg.sandbox_available()):
    skipped += 1
    print("   SKIP @babel/parser（~/boatrace-ai-predictor/node_modules）か sandbox-exec が無い。node を回す試験を飛ばした")
else:
    EMOJI = ('// 🚤 風の強い日 🌊🌊\nconst MARK = "🎯🎯🎯";\nexport function pick(a, b) {\n  if (a > 3 && b < 5) {\n    return a + 10;\n  }\n'
             '  const label = "強風😀";\n  return label.length === 4 || a >= b ? 7 : 8;\n}\nexport const mark = MARK;\n')
    d = Path(tempfile.mkdtemp(prefix="vg-fr-"))
    try:
        (d / "src").mkdir()
        (d / "src" / "e.js").write_text(EMOJI, encoding="utf-8")
        ms, why = vg.make_mutants(d, NM, "src/e.js")
        u = EMOJI.encode("utf-16-le")
        seg = lambda m: u[2 * m["start"]: 2 * m["end"]].decode("utf-16-le")  # noqa: E731
        shape = {"op": lambda t: t.strip() in ("&&", "||", ">", "<", ">=", "===", "+") or t.strip() in vg_ops, "num": lambda t: t.isdigit(),
                 "str": lambda t: t[:1] == '"' and t[-1:] == '"', "return": lambda t: bool(t.strip()), "stmt": lambda t: t.rstrip().endswith(";")}
        vg_ops = {"&&", "||", "===", "!==", "==", "!=", "<", ">=", ">", "<="}
        bad = [(m["kind"], seg(m)) for m in ms if m["kind"] in shape and not shape[m["kind"]](seg(m))]
        check("絵文字入りの見本: 全部の変異の位置が狙いの字（演算子・数字・引用符つきの文字列）に当たる", not why and len(ms) >= 8 and not bad, (why, len(ms), bad))
        broken = []
        for m in ms:
            (d / "src" / "m.js").write_bytes(vg.apply_mutant(EMOJI.encode("utf-8"), m))
            if vg.make_mutants(d, NM, "src/m.js")[1]:
                broken.append(vg.mkey(m))
        check("絵文字入りの見本: 変異の後の本文が全部 @babel/parser で読める（名前の途中を切らない）", not broken, broken)
        py = [m for m in ms if m["kind"] == "op" and EMOJI[m["start"]: m["end"]].strip() not in vg_ops]
        check("同じ見本を Python の文字の位置で切ると演算子に当たらない変異がある（直す前の誤り）", bool(py), len(ms))
    finally:
        shutil.rmtree(d, ignore_errors=True)

    print("(1) 比べられない（人が見る）")
    YML = "docs/flow.yml"
    BASE_YML = "name: x\nsteps:\n  - run: push\n    env: TOKEN\n"
    OLD_NP = ('import fs from "fs";\nconst y = fs.readFileSync(new URL("../../docs/flow.yml", import.meta.url), "utf8");\nconst problems = [];\n'
              'if (!y.includes("TOKEN")) problems.push("env の TOKEN が無い");\nif (!y.includes("steps:")) problems.push("steps が無い");\n'
              'if (problems.length) {\n  console.error(problems.join("\\n"));\n  process.exit(1);\n}\n')
    NEW_NP = ('import fs from "fs";\nconst y = fs.readFileSync(new URL("../../docs/flow.yml", import.meta.url), "utf8");\n'
              'function checkAll(text) {\n  const problems = [];\n  if (!text.includes("TOKEN")) problems.push("env の TOKEN が無い");\n'
              '  if (!text.includes("steps:")) problems.push("steps が無い");\n  return problems;\n}\nconst problems = checkAll(y);\n'
              'if (problems.length) {\n  console.error(problems.join("\\n"));\n  process.exit(1);\n}\n')
    base = {V: OLD_NP, YML: BASE_YML}
    v = judge(base, {V: NEW_NP})
    check("製品の import が無い verify の書き換え（確かめの数は同じ）: 比べられない。excused に入らず human にも在る",
          inc(v) and outcomes(v) == {V: vg.OUT_INCOMPARABLE} and not v.excused, (v.excused, v.human, v.incomparable, v.record))
    v = judge(base, {V: NEW_NP}, with_base=False)
    check("同じ変更でも base_ref を渡さない呼び方: 今までどおり赤", red(v) and outcomes(v) == {V: None}, (v.human, v.incomparable))
    v = judge(base, {V: NEW_NP.replace('  if (!text.includes("steps:")) problems.push("steps が無い");\n', "")})
    check("確かめを1つ消した（push・リテラルが減る）: 【弱めの疑い】で赤", red(v) and outcomes(v) == {V: vg.OUT_FEWER} and any("【弱めの疑い】" in h for h in v.human), (v.human, v.incomparable))
    v = judge(base, {V: NEW_NP.replace("const problems = checkAll(y);\n", "const problems = checkAll(y);\nif (y.length > 0) process.exit(0);\n")})
    check("早抜け（process.exit(0)）を足した: 赤", red(v) and outcomes(v) == {V: vg.OUT_FEWER} and any("exit0" in h for h in v.human), (v.human, v.incomparable))
    v = judge(base, {V: NEW_NP.replace("const problems = checkAll(y);\n", "let problems = [];\ntry {\n  problems = checkAll(y);\n} catch (e) {\n  problems = [];\n}\n")})
    check("catch を足した（握りつぶし）: 赤", red(v) and outcomes(v) == {V: vg.OUT_FEWER}, (v.human, v.incomparable))
    v = judge(base, {V: NEW_NP.replace('"TOKEN"', '"TOKEN_X"')})
    check("新の verify が変異なしで通らない: 赤", red(v), (v.human, v.incomparable))
    v = judge(base, {V: None})
    check("製品の import が無い verify の削除: 赤（比べられないにしない）", red(v), (v.human, v.incomparable))

    # 場面の表を verifyData/ へ移す（#3021 の形）と、移したうえで場面を削る形
    OLD_T = ('import fs from "fs";\nconst y = fs.readFileSync(new URL("../../docs/flow.yml", import.meta.url), "utf8");\n'
             'const cases = [\n  { word: "TOKEN", want: true },\n  { word: "steps:", want: true },\n  { word: "secret", want: false },\n];\n'
             'const failed = [];\nfor (const c of cases) if (y.includes(c.word) !== c.want) failed.push(c.word);\nif (failed.length) process.exit(1);\n')
    NEW_T = ('import fs from "fs";\nimport { CASES } from "./verifyData/x-cases.js";\nconst y = fs.readFileSync(new URL("../../docs/flow.yml", import.meta.url), "utf8");\n'
             'const failed = [];\nfor (const c of CASES) if (y.includes(c.word) !== c.want) failed.push(c.word);\nif (failed.length) process.exit(1);\n')
    CASES = 'export const CASES = [\n  { word: "TOKEN", want: true },\n  { word: "steps:", want: true },\n  { word: "secret", want: false },\n];\n'
    v = judge({V: OLD_T, YML: BASE_YML}, {V: NEW_T, DATA: CASES})
    check("場面の表を verifyData/ へ移しただけ: verify も本も比べられない（赤は無い）",
          inc(v) and inc(v, DATA) and len(v.incomparable) == len(v.human) == 2 and not v.excused, (v.human, v.incomparable, v.record))
    v = judge({V: OLD_T, YML: BASE_YML}, {V: NEW_T, DATA: CASES.replace('  { word: "secret", want: false },\n', "")})
    check("移したうえで場面を1つ削った（リテラルが減る）: 赤", red(v) and outcomes(v) == {V: vg.OUT_FEWER} and not inc(v, DATA), (v.human, v.incomparable))
    BIG = "scripts/maintenance/verifyData/big.js"
    v = judge({V: OLD_T, YML: BASE_YML, BIG: 'export const BIG = ["a", "b", "c", "d", "e", "f", "g", "h"];\n'},
              {V: NEW_T.replace('import { CASES }', 'import "./verifyData/big.js";\nimport { CASES }'), DATA: CASES.replace('  { word: "secret", want: false },\n', "")})
    check("変えていない大きな本を import に足して数を埋めても赤（数えるのは PR が変えた本だけ）", red(v) and outcomes(v) == {V: vg.OUT_FEWER}, (v.human, v.record))

    # base でも旧が変異なしで通らない（鍵が要る verify。#3108 の形）
    CALC = "export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
    OLD_ENV = ('import { clamp } from "../../src/calc.js";\nif (!process.env.VG_TEST_NO_SUCH_KEY) {\n  console.error("鍵が未設定");\n  process.exit(1);\n}\n'
               'if (clamp(20) !== 10) process.exit(1);\n')
    NEW_ENV = OLD_ENV.replace("if (clamp(20) !== 10) process.exit(1);\n", "const got = clamp(20);\nif (got !== 10) process.exit(1);\n")
    v = judge({V: OLD_ENV, "src/calc.js": CALC}, {V: NEW_ENV})
    check("鍵が無く旧も新も判定の場所で回せない: 比べられない", inc(v) and outcomes(v) == {V: vg.OUT_INCOMPARABLE}, (v.human, v.incomparable, v.record))
    OLD_OK = 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'
    v = judge({V: OLD_OK, "src/calc.js": CALC}, {V: OLD_OK.replace("!== 10", "!== 12"), "src/calc.js": CALC.replace("return 10;", "return 12;")})
    check("base では旧が通る（決まりの変更）: 今までどおり赤の型（rule_change）", red(v) and outcomes(v) == {V: vg.OUT_RULE}, (v.human, v.incomparable))

    # base でも旧が変異を1つも落とさない（import するだけの旧。#3123 の一部の形）と、PR の木の水増しで作った「落とさない」
    OLD_NK = 'import * as m from "../../src/calc.js";\nconst seen = [];\nseen.push(typeof m);\nif (seen.length !== 1) process.exit(1);\n'
    NEW_NK = OLD_NK.replace("seen.push(typeof m);\n", "seen.push(typeof m);\nseen.push(typeof m.clamp);\n").replace("!== 1", "!== 2")
    v = judge({V: OLD_NK, "src/calc.js": CALC}, {V: NEW_NK})
    check("base でも旧が変異を1つも落とさない: 比べられない", inc(v) and outcomes(v) == {V: vg.OUT_INCOMPARABLE}, (v.human, v.incomparable, v.record))
    PAD = "".join(f"export const pad{i} = {i + 100};\n" for i in range(60))
    GUT = 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== clamp(20) || typeof clamp(3) !== "number") process.exit(1);\n'
    v = judge({V: OLD_OK, "src/calc.js": CALC}, {V: GUT, "src/calc.js": PAD + CALC}, cfg={"max_mutants_per_verify": 2})
    rec = (v.record.get("mutation") or [{}])[0]
    check("製品に効かない定数を足して標本を薄め、条件を空にした新: base では旧が変異を落とすので赤のまま（比べられないにしない）",
          red(v) and rec.get("outcome") != vg.OUT_INCOMPARABLE and (rec.get("base") or {}).get("killed_old") == 1, (v.human, v.incomparable, rec))

    print("(3) 取りこぼしの回し直し")
    BASE3 = {V: OLD_OK, "src/calc.js": CALC}
    NEW3 = OLD_OK.replace("if (clamp", "const c = clamp;\nif (c").replace("|| clamp", "|| c")

    def flaky_run(old_seq, new_seq):
        """偽の実行。変異なしは通る。変異ありは、最初に見た変異（1つ目）だけ old_seq・new_seq の順（True=通る）で答え、ほかの変異は旧も新も落とす"""
        first, calls = [], {"old": 0, "new": 0}

        def run(argv, cwd, env, timeout):
            body = (Path(cwd) / "src/calc.js").read_text(encoding="utf-8")
            if body == CALC:
                return 0
            if not first:
                first.append(body)
            if body != first[0]:
                return 1
            who = "old" if str(argv[-1]).endswith(".__old__.js") else "new"
            seq = old_seq if who == "old" else new_seq
            i = min(calls[who], len(seq) - 1)
            calls[who] += 1
            return 0 if seq[i] else 1
        return run
    v = judge(BASE3, {V: NEW3}, cfg={"sandbox": False}, run=flaky_run([False, True], [True]))
    rec = (v.record.get("mutation") or [{}])[0]
    check("旧が1回だけ偶然に落ちた（回し直すと通る）: 取りこぼしに数えず緑、flaky_old に残る",
          V in v.excused and rec.get("outcome") == vg.OUT_OK and len(rec.get("flaky_old") or []) == 1 and not rec.get("missed"), (v.human, rec))
    v = judge(BASE3, {V: NEW3}, cfg={"sandbox": False}, run=flaky_run([False, False], [True, False]))
    rec = (v.record.get("mutation") or [{}])[0]
    check("旧は2回とも落とし、新は落としたり落とさなかったり: 【揺れる verify】で赤（緑にも比べられないにもしない）",
          red(v) and rec.get("outcome") == vg.OUT_FLAKY and len(rec.get("flaky_new") or []) == 1 and any("【揺れる verify】" in h for h in v.human), (v.human, rec))
    v = judge(BASE3, {V: NEW3}, cfg={"sandbox": False}, run=flaky_run([False, False], [True, True]))
    rec = (v.record.get("mutation") or [{}])[0]
    check("旧は2回とも落とし、新は2回とも落とさない: 【弱め】", red(v) and rec.get("outcome") == vg.OUT_WEAKENED and len(rec.get("missed") or []) == 1, (v.human, rec))
    v = judge(BASE3, {V: GUT})
    check("実の実行で、条件を空にした新は【弱め】のまま", red(v) and outcomes(v) == {V: vg.OUT_WEAKENED}, (v.human, v.record))
    v = judge({V: OLD_NP, YML: BASE_YML, "scripts/maintenance/verify-y.js": OLD_OK, "src/calc.js": CALC}, {V: NEW_NP, "scripts/maintenance/verify-y.js": GUT})
    check("赤と比べられないが混じるとき: human は赤が先、incomparable は比べられないだけ",
          len(v.human) == 2 and "【弱め】" in v.human[0] and v.incomparable == [v.human[1]], (v.human, v.incomparable))

print(f"\n{sum(ok)}/{len(ok)} OK" + (f"（飛ばし {skipped}）" if skipped else ""))
sys.exit(0 if all(ok) else 1)
