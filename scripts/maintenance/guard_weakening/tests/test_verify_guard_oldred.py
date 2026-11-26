#!/usr/bin/env python3
"""scripts/verify_guard.py の old_red（変異なしで旧の verify が PR の木で通らないときの見分け、11/19 オーナー yes）の試験。
小さな fixture と、龍神 #2900（分けよ）・#2901（決まりの変更）のマージ前の head の実の木の再生。どれも通さず、弱めの赤と別の型と次の手を返すことを見る。
test_verify_guard.py と分けたのは pre-commit の1本90秒の上限のため。@babel/parser は龍神の node_modules を使う。無ければ node の試験を飛ばす。
実の木は ~/boatrace-ai-predictor の git から読むだけ（git archive で一時の場所へ出す。龍神の作業ツリー・.git には書かない）。commit が手元に無ければ飛ばす。
実の木の再生は長い（11/19 実測: #2900 74秒、#2901 は verify-pr-lane.js が1回 約23秒で数分）ので VG_REPLAY=1 のときだけ回す（pre-commit では飛ばす）。
`python3 tests/test_verify_guard_oldred.py`、再生も: `VG_REPLAY=1 python3 tests/test_verify_guard_oldred.py`"""
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

W = Path(__file__).resolve().parent.parent
os.environ["HQ_TEST"] = "1"  # 変異のロック（scripts/mut_lock.py）を試験では迂回する（pre-commit の1本90秒の上限・負荷の線で待たない）
spec = importlib.util.spec_from_file_location("verify_guard", W / "verify_guard.py")
vg = importlib.util.module_from_spec(spec)
sys.modules["verify_guard"] = vg
spec.loader.exec_module(vg)

RYUJIN = W.parents[2]
NM = RYUJIN / "node_modules"
HAVE_NM = (NM / "@babel" / "parser").is_dir()
ok, skipped = [], 0


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:900]}"))


def mk(files):
    d = Path(tempfile.mkdtemp(prefix="vg-test-"))
    (d / "package.json").write_text('{"type":"module"}')
    for p, t in files.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_text(t)
    return d


def outcomes(v):
    return {str(r["script"]): r.get("outcome") for r in v.record.get("mutation") or []}


CFG = {"node_modules": str(NM), "max_mutants_per_verify": 40, "run_timeout_sec": 60, "direction_mutants": 4}
V = "scripts/maintenance/verify-calc.js"
CALC = "export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\nexport function isBig(x) {\n  return x >= 5;\n}\n"
OLD_V = 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'

if not (HAVE_NM and vg.sandbox_available()):
    skipped += 1
    print("   SKIP @babel/parser（~/boatrace-ai-predictor/node_modules）か sandbox-exec が無い。node を回す試験を飛ばした")
else:
    print("old_red: 旧の verify が PR の木で通らない赤の見分け（fixture）")
    # (i) 守りと本文を同じ PR で動かした: clamp を別のファイルへ移し、verify の読みも同じ PR で変えた。新の verify は移す前の本文でも通る
    LIB = "export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
    NEW_V = ('const m = await import("../../src/calc.js");\nconst clamp = m.clamp ?? (await import("../../src/clampLib.js")).clamp;\n'
             'if (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n')
    base = {V: OLD_V, "src/calc.js": CALC}
    d = mk({V: NEW_V, "src/calc.js": "export function isBig(x) {\n  return x >= 5;\n}\n", "src/clampLib.js": LIB})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M", "src/clampLib.js": "A"}, base.get, CFG)
    check("(i) 本文の移動と verify の読みの変更が同じ PR: 通さず「分けよ」（型 split）",
          V not in v.excused and outcomes(v) == {V: vg.OUT_SPLIT} and any("【分けよ】" in h and "前段の PR" in h and "弱めかは未判定" in h for h in v.human), (v.excused, v.human, v.record))
    check("(i) 写しの外（作業場所）は戻したままにしない", (d / "src/clampLib.js").is_file() and "clamp" not in (d / "src/calc.js").read_text())
    shutil.rmtree(d)

    # (ii) 決まりそのものを変えた: 上限 10 → 12。旧の verify は旧の決まり（10）を、新は新しい決まり（12）を assert する
    d = mk({V: OLD_V.replace("!== 10", "!== 12"), "src/calc.js": CALC.replace("return 10;", "return 12;")})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    # 11/25 A2: 落とす変異の数が減らず確かめの形の数も減らないので rule_change_kept（excused でなく、incomparable と同じ警告の並びへ）
    check("(ii) 決まりの変更（旧は旧の値を assert、新は同じ形で新の値を assert）: excused にせず rule_change_kept・警告の並び（A2）",
          V not in v.excused and rec.get("outcome") == vg.OUT_RULE_KEPT and any("【決まりの変更: 警告】" in h for h in v.incomparable)
          and (rec.get("direction") or {}).get("old_killed", 0) > 0
          and (rec.get("direction") or {}).get("new_killed", 0) >= (rec.get("direction") or {}).get("old_killed", 0), (v.excused, v.human, v.incomparable, rec))
    shutil.rmtree(d)

    # 決まりを変え、新の verify の確かめを1つ減らした（clamp(3) の確かめを消した）: 確かめの形の数が減るので rule_change の赤のまま（A2 の外）
    d = mk({V: 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 12) process.exit(1);\n', "src/calc.js": CALC.replace("return 10;", "return 12;")})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("決まりの変更＋確かめを減らした: rule_change の赤のまま、警告の並びに入らない",
          V not in v.excused and rec.get("outcome") == vg.OUT_RULE and not v.incomparable
          and any("【決まりの変更: 人が見る】" in h for h in v.human), (v.excused, v.human, v.incomparable, rec))
    shutil.rmtree(d)

    # 11/27: 死んだ関数（isBig）とその試験を一緒に消した片付け。消した行の変異を除くと旧が落とす変異を新も全部落とす → deleted_code（警告）
    BOTH_V = ('import { clamp, isBig } from "../../src/calc.js";\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'
              'if (!isBig(7) || isBig(2)) process.exit(1);\n')
    ONLY_CLAMP = "export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
    base2 = {V: BOTH_V, "src/calc.js": CALC}
    d = mk({V: OLD_V, "src/calc.js": ONLY_CLAMP})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base2.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("死んだ関数とその試験を一緒に消した: deleted_code・警告の並び（excused にしない）",
          V not in v.excused and rec.get("outcome") == vg.OUT_DELETED_OK and any("【消したコードの片付け: 警告】" in h for h in v.incomparable)
          and (rec.get("deleted_code") or {}).get("deleted_lines", 0) > 0 and not (rec.get("deleted_code") or {}).get("missed"), (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    # ファイルごと消した（死んだファイル）: 残る calc.js の確かめは新も同じなので deleted_code
    DEAD = "export function unused(x) {\n  if (x > 1) {\n    return x;\n  }\n  return 0;\n}\n"
    base3 = {V: BOTH_V.replace('import { clamp, isBig } from "../../src/calc.js";', 'import { clamp, isBig } from "../../src/calc.js";\nimport { unused } from "../../src/dead.js";\nif (unused(2) !== 2 || unused(0) !== 0) process.exit(1);'), "src/calc.js": CALC, "src/dead.js": DEAD}
    d = mk({V: BOTH_V, "src/calc.js": CALC})
    v = vg.evaluate(d, {V: "M", "src/dead.js": "D"}, base3.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("死んだファイルとその試験を一緒に消した: deleted_code・警告",
          V not in v.excused and rec.get("outcome") == vg.OUT_DELETED_OK
          and any("書き換えていない" in h for h in v.incomparable), (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    # 消した関数（isBig）の中身を呼び出し元（clamp）へ書き戻し、isBig の試験を消した: clamp を書き換えたので deleted_code にせず split の赤のまま
    CALL = ("export function isBig(x) {\n  return x >= 5;\n}\nexport function clamp(x) {\n  if (isBig(x) && x > 10) {\n    return 10;\n  }\n  return x;\n}\n")
    INLINE = "export function clamp(x) {\n  if (x >= 5 && x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
    d = mk({V: OLD_V, "src/calc.js": INLINE})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, {V: BOTH_V, "src/calc.js": CALL}.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("消した関数の中身を呼び出し元へ書き戻した: 製品の宣言を書き換えたので split の赤のまま",
          V not in v.excused and rec.get("outcome") == vg.OUT_SPLIT and not v.incomparable and (rec.get("deleted_code") or {}).get("rewritten") == ["clamp"], (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    # 消したうえで、残る関数（clamp）の確かめも弱めた: 消した行の外の変異を新が落とさないので split の赤のまま
    d = mk({V: 'import { clamp } from "../../src/calc.js";\nif (clamp(3) !== 3) process.exit(1);\n', "src/calc.js": ONLY_CLAMP})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base2.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("消したうえで残る関数の試験も弱めた: split の赤のまま、警告の並びに入らない",
          V not in v.excused and rec.get("outcome") == vg.OUT_SPLIT and not v.incomparable and (rec.get("deleted_code") or {}).get("missed"), (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    # 名前を変えて書き直し（clamp → cap、本体の行は25字未満）、残る isBig と cap の試験を弱めた: 新しい名前を足したので split の赤のまま
    CAP = "export function cap(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\nexport function isBig(x) {\n  return x >= 5;\n}\n"
    d = mk({V: 'import { cap, isBig } from "../../src/calc.js";\nif (cap(3) !== 3 || !isBig(7) || isBig(2)) process.exit(1);\n', "src/calc.js": CAP})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base2.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("名前を変えて書き直し試験を弱めた: deleted_code にせず赤（新の verify は base に無い名を読むので rule_change）",
          V not in v.excused and rec.get("outcome") in (vg.OUT_RULE, vg.OUT_SPLIT) and not v.incomparable, (v.human, v.incomparable, rec))
    # 新の verify が古い名にも頼れる形（m.cap ?? m.clamp）で base の本文でも通る: split に入るが、新しい名 cap を足したので deleted_code にしない
    d = mk({V: 'const m = await import("../../src/calc.js");\nconst cap = m.cap ?? m.clamp;\nif (cap(3) !== 3 || !m.isBig(7)) process.exit(1);\n', "src/calc.js": CAP})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base2.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("名前を変えて書き直し、新の verify が base でも通る: 新しい名前を足したので split の赤のまま",
          V not in v.excused and rec.get("outcome") == vg.OUT_SPLIT and not v.incomparable and (rec.get("deleted_code") or {}).get("added") == ["cap"], (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    check("added_names: 新しく出た最上位の名前だけ",
          vg.added_names(NM, b"export function f() {}\n", b"export function f() {}\nconst g = 1;\n") == frozenset({"g"})
          and vg.added_names(NM, b"export function f() {}\n", None) == frozenset() and vg.added_names(NM, None, b"const a = 1;\n") == frozenset({"a"}))
    TSA = b"export function f(x: number): number {\n  return x + 1;\n}\nexport const g = (y: string): string => y;\n"
    check("TS の本文も元の拡張子で解析する（.js にすると型注釈で解析に失敗していた）",
          vg.deleted_lines(NM, TSA, b"export function f(x: number): number {\n  return x + 1;\n}\n", ".ts") == frozenset({4})
          and vg.deleted_lines(NM, TSA, TSA, ".js") is None)
    # 旧の verify が消した関数（isBig）だけを確かめていた: 残るコードを旧が1つも確かめないので空の通過にせず split の赤のまま
    d = mk({V: 'import { clamp } from "../../src/calc.js";\nif (typeof clamp !== "function") process.exit(1);\n', "src/calc.js": ONLY_CLAMP})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, {V: 'import { isBig } from "../../src/calc.js";\nif (!isBig(7) || isBig(2)) process.exit(1);\n', "src/calc.js": CALC}.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("旧が消した関数だけを確かめていた: 空の通過にせず split の赤のまま",
          V not in v.excused and rec.get("outcome") == vg.OUT_SPLIT and not v.incomparable, (v.human, v.incomparable, rec))
    shutil.rmtree(d)
    # deleted_lines は名前ごと消えた最上位の宣言の行だけ。名前が残る宣言は書き換えても入れない
    A = b"export function f(x) {\n  return x + 1;\n}\nexport function g(x) {\n  return x * 2;\n}\nconst k = 3;\nimport z from './z.js';\n"
    check("deleted_lines: 名前ごと消えた宣言（g・k）の行だけ、書き換えた f は入れない",
          vg.deleted_lines(NM, A, b"export function f(x) {\n  return x - 1;\n}\n") == frozenset({4, 5, 6, 7})
          and vg.deleted_lines(NM, A, A) == frozenset() and vg.deleted_lines(NM, A, None) == frozenset(range(1, 8))
          and vg.deleted_lines(NM, None, A) == frozenset() and vg.deleted_lines(NM, b"export function (", A) is None,
          [vg.deleted_lines(NM, A, b"export function f(x) {\n  return x - 1;\n}\n"), vg.deleted_lines(NM, A, None)])

    # 決まりを変え、新の verify を空にした: 新は base の本文でも通るので「分けよ」。言われたとおり前段（verify だけ）に出すと、そこで弱めの赤になる（抜け道にならない）
    EMPTY_V = 'import { clamp } from "../../src/calc.js";\nif (typeof clamp !== "function") process.exit(1);\n'
    d = mk({V: EMPTY_V, "src/calc.js": CALC.replace("return 10;", "return 12;")})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M"}, base.get, CFG)
    check("決まりを変えて新の verify を空にした: 通さず「分けよ」", V not in v.excused and outcomes(v) == {V: vg.OUT_SPLIT}, (v.excused, v.human, v.record))
    shutil.rmtree(d)
    d = mk({V: EMPTY_V, "src/calc.js": CALC})
    v = vg.evaluate(d, {V: "M"}, base.get, CFG)
    check("その前段（空にした verify だけ）: 弱めの赤（型 weakened）", V not in v.excused and outcomes(v) == {V: vg.OUT_WEAKENED}, (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # verify の削除と本文の変更が同じ PR
    d = mk({"src/calc.js": CALC.replace("return 10;", "return 12;")})
    v = vg.evaluate(d, {V: "D", "src/calc.js": "M"}, base.get, CFG)
    check("verify の削除＋本文の変更: 通さず「決まりの変更」（守りが無くなる）",
          V not in v.excused and outcomes(v) == {V: vg.OUT_RULE} and any("守りが無くなる" in h for h in v.human), (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # 本文を変えていないのに旧が通らない（base で既に赤・環境の違い）
    d = mk({V: OLD_V, "src/calc.js": CALC})
    v = vg.evaluate(d, {V: "M"}, {V: OLD_V.replace("!== 10", "!== 99")}.get, CFG)
    check("本文を変えていないのに旧が通らない: 「比べられない」（型 old_red_on_base）",
          V not in v.excused and outcomes(v) == {V: vg.OUT_OLD_RED} and any("【比べられない】" in h for h in v.human), (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # ファイルとディレクトリの入れ替え（base は src/lib というファイル、PR は src/lib/index.js）: 戻せて見分けられ、写しも元へ戻る
    DIRV = 'import { clamp } from "../../src/lib/index.js";\nif (clamp(20) !== 10) process.exit(1);\n'
    swapped = {V: "M", "src/lib/index.js": "A", "src/lib": "D", "src/calc.js": "D"}
    d = mk({V: DIRV, "src/lib/index.js": LIB})
    v = vg.evaluate(d, swapped, {**base, "src/lib": "export const x = 1;\n"}.get, CFG)
    check("ファイル↔ディレクトリの入れ替え: 例外で落ちず型が付く（通さない）", V not in v.excused and outcomes(v) == {V: vg.OUT_RULE}, (v.excused, v.human, v.record))
    shutil.rmtree(d)
    # 戻す先が空でないディレクトリ（変更の一覧に無い物が残る）: 戻せないので「比べられない」
    d = mk({V: DIRV, "src/lib/index.js": LIB, "src/lib/keep.js": "export const k = 1;\n"})
    v = vg.evaluate(d, swapped, {**base, "src/lib": "export const x = 1;\n"}.get, CFG)
    check("本文を base へ戻せない: 例外で落ちず「比べられない」",
          V not in v.excused and outcomes(v) == {V: vg.OUT_OLD_RED} and any("戻せない" in h for h in v.human), (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # 戻せない物（base を字で読めない）が混じる: 分けよと言わない
    def bin_base(p):
        if p == "src/logo.bin":
            raise UnicodeDecodeError("utf-8", b"\xff", 0, 1, "x")
        return base.get(p)
    d = mk({V: NEW_V, "src/calc.js": "export function isBig(x) {\n  return x >= 5;\n}\n", "src/clampLib.js": LIB, "src/logo.bin": "x"})
    v = vg.evaluate(d, {V: "M", "src/calc.js": "M", "src/clampLib.js": "A", "src/logo.bin": "M"}, bin_base, CFG)
    check("戻せない物が混じる: split と言わず「比べられない」", V not in v.excused and outcomes(v) == {V: vg.OUT_OLD_RED} and v.record.get("unreverted") == ["src/logo.bin"],
          (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # 弱めの赤は別の型のまま
    d = mk({V: 'import { clamp } from "../../src/calc.js";\nif (clamp(3) !== 3) process.exit(1);\n', "src/calc.js": CALC})
    v = vg.evaluate(d, {V: "M"}, base.get, CFG)
    check("弱め（旧が落とす変異を新が落とさない）: 型 weakened のまま、分けよ・決まりの変更と言わない",
          V not in v.excused and outcomes(v) == {V: vg.OUT_WEAKENED} and any("【弱め】" in h for h in v.human) and not any("分けよ" in h or "決まりの変更" in h for h in v.human),
          (v.excused, v.human, v.record))
    shutil.rmtree(d)

    # ---------- 龍神の実の木の再生 ----------
    BASE = "f8447a7feabd0907e7cfabcd07636075136948f4"  # 2本とも PR の base

    def git(*a):
        return subprocess.run(["git", "-c", "core.quotepath=false", *a], cwd=RYUJIN, capture_output=True, check=True).stdout

    def have(sha):
        return subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=RYUJIN, capture_output=True).returncode == 0

    def replay(head):
        """head の木を一時の場所へ出し（git archive）、索引だけ持たせて evaluate を回す。(Verdict, 変更の数)"""
        mb = git("merge-base", BASE, head).decode().strip()
        d = Path(tempfile.mkdtemp(prefix="vg-replay-"))
        try:
            subprocess.run(["tar", "-x", "-C", str(d)], input=git("archive", head), check=True)
            vg.seed_git_index(RYUJIN, d, [x for x in git("ls-tree", "-r", "--name-only", "-z", head).decode().split("\0") if x])
            changes = {}
            for ln in git("diff", "--name-status", "--no-renames", mb, head).decode().splitlines():
                st, _, p = ln.partition("\t")
                if st[:1] in "AMD" and p:
                    changes[p] = st[:1]
            return vg.evaluate(d, changes, vg.git_show(RYUJIN, mb), {**CFG, "run_timeout_sec": 120, "sandbox": True, "direction_mutants": 2}), len(changes)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    print("龍神 #2900・#2901 のマージ前の head の再生")
    H2900, H2901 = "ff74ba9f00876834c5621aaf7de9a7e422e7895e", "702ec9a3792d73906065dd542cf8068bd6c858c5"
    if os.environ.get("VG_REPLAY") != "1":
        skipped += 1
        print("   SKIP 実の木の再生は VG_REPLAY=1 のときだけ（長い）")
    elif not all(have(s) for s in (BASE, H2900, H2901)):
        skipped += 1
        print("   SKIP 龍神の commit（#2900・#2901 の head と base）が手元に無い")
    else:
        v, n = replay(H2900)
        o = outcomes(v)
        check("#2900（本文の移動と verifyData の読みの変更が同じ PR）: verify-motor-* 5本とも split、通さない",
              n == 9 and len(o) == 5 and set(o.values()) == {vg.OUT_SPLIT} and not v.excused, (n, o, v.human))
        check("#2900: verifyData/motorChartSource.js にも「分けよ: 前段の PR へ」", any(h.startswith("scripts/maintenance/verifyData/motorChartSource.js: 【分けよ】") for h in v.human), v.human)
        v, n = replay(H2901)
        rec = (v.record.get("mutation") or [{}])[0]
        check("#2901（旧の verify-pr-lane.js が旧の決まりを assert）: rule_change と向き、通さない",
              n == 2 and outcomes(v) == {"scripts/maintenance/verify-pr-lane.js": vg.OUT_RULE} and not v.excused and rec.get("direction")
              and any("【決まりの変更: 人が見る】" in h and "向き" in h for h in v.human), (n, v.human, rec))

print(f"\n{sum(ok)}/{len(ok)} OK" + (f"（飛ばし {skipped}）" if skipped else ""))
sys.exit(0 if all(ok) else 1)
