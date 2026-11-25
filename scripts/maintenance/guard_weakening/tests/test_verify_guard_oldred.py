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
