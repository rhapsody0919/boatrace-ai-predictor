#!/usr/bin/env python3
"""scripts/guard_direction.py（HR44 第1段: 許可リストの向き A の判定）の試験。純関数＋小さな本物の git（外へ出ない）。
今夜（11/11）の6件の想定の差分を材料にした照合を含む。`python3 tests/test_guard_direction.py`"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ["HQ_TEST"] = "1"
W = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(W))
spec = importlib.util.spec_from_file_location("guard_direction", W / "guard_direction.py")
gd = importlib.util.module_from_spec(spec)
sys.modules["guard_direction"] = gd
spec.loader.exec_module(gd)
ok = []


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:600]}"))


M = "scripts/maintenance/"
TYPES = {"allowlist": [M + "*-allowlist.json"]}
KY, ND, NU, RN, AL, CS = (M + "kyotei-wording-allowlist.json", M + "verify-no-undef-allowlist.json", M + "e2e-no-unroute-allowlist.json",
                          M + "verify-e2e-recorded-network-allowlist.json", M + "actionlint-allowlist.json", M + "css-class-collisions-allowlist.json")


def J(o):
    return json.dumps(o, ensure_ascii=False, indent=2)


def run(path, base, head, status="M", renames=()):
    """1パスの判定。base・head は JSON の辞書"""
    return gd.judge({path: status}, lambda p: J(base) if base is not None else None, lambda p: J(head) if head is not None else None, list(renames), TYPES)


def ky(*rows, c="x"):
    return {"$comment": [c], "entries": [{"file": f, "line": l} for f, l in rows]}


# --- 型 ---
check("型: 表に行の取り出し方がある許可リストだけ。表に無い *-allowlist.json・glob の外は対象外",
      gd.data_paths(TYPES, [KY, M + "other-allowlist.json", "package.json", ND]) == {KY, ND}, gd.data_paths(TYPES, [KY, M + "other-allowlist.json"]))
check("型: 6本とも PARSERS にある", set(gd.PARSERS) == {KY, ND, NU, RN, AL, CS}, set(gd.PARSERS))
check("型: 空の types なら何も当たらない", gd.data_paths({}, [KY]) == frozenset())

# --- A: 縮める ---
b = ky(("src/a.jsx", "競艇 a"), ("src/b.jsx", "競艇 b"))
d = run(KY, b, ky(("src/a.jsx", "競艇 a")))
check("A: 行の削除だけ → pass", d.excused == {KY} and not d.human and d.record["paths"][KY]["removed"] == 1, (d.human, d.record))
d = run(KY, b, b)
check("A: 変更なし（行は同じ）→ pass", d.excused == {KY}, d.human)
d = run(KY, b, {**ky(("src/a.jsx", "競艇 a"), ("src/b.jsx", "競艇 b")), "$comment": ["別の文"]})
check("A: $comment の書き換えは向きに関係しない → pass", d.excused == {KY}, d.human)
d = run(KY, b, ky(("src/a.jsx", "  競艇 a  "), ("src/b.jsx", "競艇 b")))
check("A: 行の中身の前後の空白（trim）だけの違いは同じ行", d.excused == {KY}, d.human)

# --- C: 増やす ---
d = run(KY, b, ky(("src/a.jsx", "競艇 a"), ("src/b.jsx", "競艇 b"), ("src/c.jsx", "競艇 c")))
check("C: 行が増える → human（理由に C 弱める）", not d.excused and any("C 弱める" in h for h in d.human), d.human)
d = run(KY, b, ky(("src/a.jsx", "競艇 a"), ("src/b.jsx", "競艇 b"), ("src/b.jsx", "競艇 b")))
check("C: 同じ行の複製（多重集合で増える）→ human", not d.excused, d.human)
d = run(KY, b, ky(("src/a.jsx", "競艇 a"), ("src/b.jsx", "競艇 B")))
check("C: 1行消して別の中身を足す（集合の差で増える）→ human", not d.excused, d.human)
d = run(KY, b, {**b, "extra": True})
check("C: 骨格（entries 以外の欄）の追加 → human", not d.excused and any("欄" in h for h in d.human), d.human)
d = run(KY, b, {"$comment": ["x"], "entries": [{"file": "src/a.jsx", "line": "x", "ignore": True}]})
check("C: 表に無い欄をもつ行 → human（解釈できない）", not d.excused, d.human)

# --- 読めない・形が違う・追加削除 ---
check("人: base が無い・JSON でない・辞書でない", all(not gd.judge({KY: "M"}, lambda p: bt, lambda p: ht, [], TYPES).excused
                                             for bt, ht in ((None, "{}"), ("{", "{}"), ("[]", "[]"), (J(b), None), (J(b), "not json"))), "")
d = run(KY, None, b, status="A")
check("人: 許可リストの新規追加・削除（A・D）は向きを言えない", not d.excused and len(d.human) == 1, d.human)
d = gd.judge({M + "other-allowlist.json": "M"}, lambda p: "{}", lambda p: "{}", [], TYPES)
check("人: 表に無い許可リストは判定に出ず、呼び出し側で従来どおり人（excused に入らない）", not d.excused and not d.human and d.record == {}, d)

# --- rename（付け替え） ---
b = ky(("src/old/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"))
h = ky(("src/shared/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"))
d = run(KY, b, h, renames=[("src/old/x.jsx", "src/shared/x.jsx")])
check("rename: 旧→新が1対1・中身が同じ → pass（集合の差だけなら落ちる物。BOA-1452 型）", d.excused == {KY} and d.record["paths"][KY]["relabeled"] == 1, (d.human, d.record))
d = run(KY, b, h)
check("rename: git の rename が無いパスの書き換え → human", not d.excused, d.human)
d = run(KY, b, ky(("src/shared/x.jsx", "競艇 x 改"), ("src/y.jsx", "競艇 y")), renames=[("src/old/x.jsx", "src/shared/x.jsx")])
check("rename: rename があっても行の中身が違えば付け替えでなく増えた行 → human", not d.excused, d.human)
d = run(KY, b, h, renames=[("src/old/x.jsx", "src/shared/x.jsx"), ("src/old/x.jsx", "src/other/x.jsx")])
check("rename: 旧が2つの新に分かれる（1対1でない）→ 使わない → human", not d.excused, d.human)
d = run(KY, b, h, renames=[("src/old/x.jsx", "src/shared/x.jsx"), ("src/zzz.jsx", "src/shared/x.jsx")])
check("rename: 2つの旧が同じ新に集まる（1対1でない）→ 使わない → human", not d.excused, d.human)
d = run(KY, b, h, renames=[("src/y.jsx", "src/shared/x.jsx")])
check("rename: 取り違え（別のパスの rename を当てても、旧に無い行）→ human", not d.excused, d.human)
b2 = ky(("src/old/x.jsx", "競艇 x"))
h2 = ky(("src/shared/x.jsx", "競艇 x"), ("src/shared/x.jsx", "競艇 x"))
d = run(KY, b2, h2, renames=[("src/old/x.jsx", "src/shared/x.jsx")])
check("rename: 付け替えと増やしを混ぜる → 増えた分が human", not d.excused and any("1 行" in x for x in d.human), d.human)
check("rename: one_to_one は重複する対を捨てる", gd.one_to_one([("a", "b"), ("a", "c"), ("d", "e"), ("x", "x")]) == {"e": "d"}, gd.one_to_one([("a", "b"), ("a", "c"), ("d", "e")]))


# --- 形式ごと ---
def ent(**k):
    return k


act = {"$comment": "c", "entries": [ent(file="f.yml", rule="expression", line="run: x", reason="r"), ent(file="g.yml", rule="syntax-check", line="y", reason="r")]}
check("形式 actionlint: 行の削除 pass", run(AL, act, {**act, "entries": act["entries"][:1]}).excused == {AL}, "")
check("形式 actionlint: 増 → human", not run(AL, act, {**act, "entries": act["entries"] + [ent(file="h.yml", rule="expression", line="z", reason="r")]}).excused, "")
css = {"$comment": "c", "entries": [{"class": "a", "files": ["x.css", "y.css"]}, {"class": "b", "files": ["z.css"]}]}
check("形式 css: files から1つ消す pass", run(CS, css, {**css, "entries": [{"class": "a", "files": ["x.css"]}, css["entries"][1]]}).excused == {CS}, "")
check("形式 css: entry ごと消す pass", run(CS, css, {**css, "entries": css["entries"][:1]}).excused == {CS}, "")
check("形式 css: files に足す → human", not run(CS, css, {**css, "entries": [{"class": "a", "files": ["x.css", "y.css", "w.css"]}, css["entries"][1]]}).excused, "")
check("形式 css: 別のクラスでファイルを足す → human", not run(CS, css, {**css, "entries": css["entries"] + [{"class": "c", "files": ["x.css"]}]}).excused, "")
check("形式 css: files が配列でない → human", not run(CS, css, {**css, "entries": [{"class": "a", "files": "x.css"}]}).excused, "")
cr = {"$comment": "c", "entries": [ent(file="e2e/a.js", code="await page.unrouteAll();", reason="12345678901"), ent(file="e2e/a.js", code="await page.unrouteAll();", reason="12345678901")]}
for P, name in ((NU, "e2e-no-unroute"), (RN, "recorded-network")):
    check(f"形式 {name}: 同内容2行から1行消す pass（多重集合）", run(P, cr, {**cr, "entries": cr["entries"][:1]}).excused == {P}, "")
    check(f"形式 {name}: 同内容を3行に複製 → human", not run(P, cr, {**cr, "entries": cr["entries"] + cr["entries"][:1]}).excused, "")
    check(f"形式 {name}: code の trim だけの違いは同じ行・reason の書き換えは向きに無関係",
          run(P, cr, {**cr, "entries": [ent(file="e2e/a.js", code=" await page.unrouteAll(); ", reason="別の理由の文でも向きに関係ない"), cr["entries"][1]]}).excused == {P}, "")
nu = {"$comment": "c", "rules": {"no-undef": {"a.js": {"names": ["foo", "bar"], "reason": "r"}}, "no-empty": {"b.js": {"count": 3, "reason": "r"}}}}


def nu_with(rules):
    return {**nu, "rules": rules}


check("形式 no-undef: names から1つ消す pass", run(ND, nu, nu_with({**nu["rules"], "no-undef": {"a.js": {"names": ["foo"], "reason": "r"}}})).excused == {ND}, "")
check("形式 no-undef: count を減らす pass", run(ND, nu, nu_with({**nu["rules"], "no-empty": {"b.js": {"count": 2, "reason": "r"}}})).excused == {ND}, "")
check("形式 no-undef: ファイルの行ごと消す pass", run(ND, nu, nu_with({"no-undef": nu["rules"]["no-undef"]})).excused == {ND}, "")
check("形式 no-undef: count を増やす → human", not run(ND, nu, nu_with({**nu["rules"], "no-empty": {"b.js": {"count": 4, "reason": "r"}}})).excused, "")
check("形式 no-undef: names に足す → human", not run(ND, nu, nu_with({**nu["rules"], "no-undef": {"a.js": {"names": ["foo", "bar", "baz"], "reason": "r"}}})).excused, "")
check("形式 no-undef: 新しいファイルの行 → human", not run(ND, nu, nu_with({**nu["rules"], "no-empty": {"b.js": {"count": 3, "reason": "r"}, "c.js": {"count": 1, "reason": "r"}}})).excused, "")
check("形式 no-undef: count が負・小数・文字列・真偽 → human", all(not run(ND, nu, nu_with({**nu["rules"], "no-empty": {"b.js": {"count": c, "reason": "r"}}})).excused for c in (-1, 1.5, "2", True)), "")
check("形式 no-undef: 別の規則へ件数を移す（規則名が違えば別の行）→ human",
      not run(ND, nu, nu_with({"no-undef": nu["rules"]["no-undef"], "no-empty": {"b.js": {"count": 2, "reason": "r"}}, "no-irregular-whitespace": {"b.js": {"count": 1, "reason": "r"}}})).excused, "")
check("形式 no-undef: rename で付け替えた file キー（中身 names が同じ）→ pass",
      run(ND, nu, nu_with({**nu["rules"], "no-undef": {"a2.js": {"names": ["foo", "bar"], "reason": "r"}}}), renames=[("a.js", "a2.js")]).excused == {ND}, "")

# --- 今夜の6件（想定の差分。PR の差分そのものの再確認は未検証）---
d = run(KY, ky(("src/old/Race.jsx", "<title>競艇</title>"), ("src/z.jsx", "競艇 z")), ky(("src/shared/Race.jsx", "<title>競艇</title>"), ("src/z.jsx", "競艇 z")),
        renames=[("src/old/Race.jsx", "src/shared/Race.jsx")])
check("今夜 BOA-1452（kyotei の1行のパス書き換え、src の移し）: A pass", d.excused == {KY}, d.human)
nu0 = {"$comment": "c", "rules": {"no-undef": {}, "no-irregular-whitespace": {"src/x.jsx": {"count": 1, "reason": "r"}, "src/gone.jsx": {"count": 1, "reason": "r"}}}}
nu1 = {"$comment": "c", "rules": {"no-undef": {}, "no-irregular-whitespace": {"src/x.jsx": {"count": 1, "reason": "r"}}}}
check("今夜 BOA-1029（no-undef 許可リストの消えた1行を消す）: 許可リスト分は A pass（e2e spec は D＝作らず人）", run(ND, nu0, nu1).excused == {ND}, "")
d = gd.judge({"scripts/lib/vercelIgnoreBuild.js": "M", M + "verify-vercel-ignore-build.js": "M"}, lambda p: "a", lambda p: "b", [], TYPES)
check("今夜 BOA-1473（IGNORED_DIRS・verify）: 許可リストでない → 判定に出ず従来どおり人（C はそのまま人）", not d.excused and not d.human and d.record == {}, d)
check("今夜 BOA-1459（verify の変更）: 許可リストでない → B（verify_guard）に任せ、ここでは何もしない",
      gd.data_paths(TYPES, [M + "verify-sitemap-coverage.js", M + "verify-sitemap-lastmod.js"]) == frozenset(), "")
st = ["scripts/maintenance/verify-a.js: child_process・ネットワーク等の語がある（新しい verify では不可）", "scripts/maintenance/verify-b.js: fs の書き・消す関数の呼び出しがある（新しい verify では不可）"]
check("今夜 ZB03 BOA-1454・1455（static_problems だけ）: 作り手の書き直しに返す", gd.static_only(st, {"static": st}), "")
check("static_only: 変異検査・通らない等が混じれば返さない（弱める疑いは人）", not gd.static_only(st + ["scripts/maintenance/verify-c.js: 新しい verify が通らない"], {"static": st}), "")
check("static_only: static の記録が無い・人行きが空 → False", not gd.static_only(st, {}) and not gd.static_only([], {"static": st}), "")

# --- head に結び付く ---
check("head: 記録の head が今の head と同じときだけ有効（違えば判定し直すか人へ）",
      gd.valid_for_head({"head": "abc"}, "abc") and not gd.valid_for_head({"head": "abc"}, "abd") and not gd.valid_for_head({}, "abc"), "")

# --- 本物の git（rename の検出・merge-base・head の記録）---
T = Path(tempfile.mkdtemp(prefix="gd-test-"))


def git(*a):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", *a], cwd=T, capture_output=True, text=True, check=True).stdout


try:
    git("init", "-q", "-b", "master")
    (T / "src/old").mkdir(parents=True)
    (T / M).mkdir(parents=True)
    (T / "src/old/x.jsx").write_text("".join(f"line {i} 競艇 のある行 padding padding\n" for i in range(30)))
    (T / KY).write_text(J(ky(("src/old/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"))))
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    git("update-ref", "refs/remotes/origin/master", "HEAD")
    git("checkout", "-q", "-b", "claude/boa-1")
    (T / "src/shared").mkdir()
    git("mv", "src/old/x.jsx", "src/shared/x.jsx")
    (T / KY).write_text(J(ky(("src/shared/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"))))
    git("add", "-A")
    git("commit", "-q", "-m", "move")
    head = git("rev-parse", "HEAD").strip()
    check("git: rename を類似度 90% で検出する", gd.git_renames(T, "origin/master") == [("src/old/x.jsx", "src/shared/x.jsx")], gd.git_renames(T, "origin/master"))
    d = gd.judge_worktree(T, "origin/master", TYPES)
    check("git: 本物の差分で A pass・記録に head の SHA が入る（判定は head に結び付く）", d.excused == {KY} and d.record["head"] == head and gd.valid_for_head(d.record, head), (d.human, d.record))
    git("checkout", "-q", "master")
    (T / KY).write_text(J(ky(("src/old/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"), ("src/w.jsx", "競艇 w"))))
    git("commit", "-q", "-am", "master adds")
    git("update-ref", "refs/remotes/origin/master", "HEAD")
    git("checkout", "-q", "claude/boa-1")
    d = gd.judge_worktree(T, "origin/master", TYPES)
    check("git: master が後から足した行は枝の変更に数えない（merge-base の版と比べる）", d.excused == {KY}, (d.human, d.record))
    git("checkout", "-q", "-b", "claude/boa-2", "master")
    (T / KY).write_text(J(ky(("src/old/x.jsx", "競艇 x"), ("src/y.jsx", "競艇 y"), ("src/w.jsx", "競艇 w"), ("src/new.jsx", "競艇 new"))))
    git("commit", "-q", "-am", "weaken")
    d = gd.judge_worktree(T, "origin/master", TYPES)
    check("git: 行を足す枝は human（C）・head を記録", not d.excused and any("C 弱める" in x for x in d.human) and d.record["head"], (d.human, d.record))
finally:
    shutil.rmtree(T, ignore_errors=True)

# 11/11 安全の点検 P2
dup = {**css, "entries": css["entries"] + [{"class": "a", "files": ["w.css"]}]}
check("css: head に同じ class の重複（検査は後勝ち）→ human", not run(CS, css, dup).excused, "")
check("css: base に同じ class の重複 → human（縮める変更でも）", not run(CS, dup, css).excused, "")
check("css: 同じエントリ内の files の重複は検査の Set と同じく1つ（足していない扱い）", run(CS, css, {**css, "entries": [{"class": "a", "files": ["x.css", "x.css", "y.css"]}, css["entries"][1]]}).excused == {CS}, "")
nb = {"$comment": "c", "entries": [{"file": "a.js", "code": "x"}]}
check("trim: ASCII の空白だけ削る（前後の space・tab・CR・LF は同じ行）", run(NU, nb, {**nb, "entries": [{"file": "a.js", "code": " \tx\r\n"}]}).excused == {NU}, "")
check("trim: NBSP・VT・FF は削らない（JS の trim は削るが、ここは別の行＝増えた行で人）", not run(NU, nb, {**nb, "entries": [{"file": "a.js", "code": "x\u00a0"}]}).excused
      and not run(NU, nb, {**nb, "entries": [{"file": "a.js", "code": "x\x0b"}]}).excused and not run(NU, nb, {**nb, "entries": [{"file": "a.js", "code": "x\x0c"}]}).excused, "")
ndb = {"rules": {"r": {"a.js": {"names": ["n"], "reason": "x"}}}}
check("骨格: no-undef は rules だけを行として除く。entries キーの追加は骨格の変更で人", not run(ND, ndb, {**ndb, "entries": [1]}).excused, "")
check("骨格: entries 型は entries だけを除く。rules キーの追加は骨格の変更で人", not run(NU, nb, {**nb, "rules": {"x": 1}}).excused, "")
check("骨格: 型ごとの除き方（行のキーの書き換えだけの変更は通る）", run(NU, nb, {**nb, "$comment": "d", "entries": []}).excused == {NU}, "")

print(f"\n{sum(ok)}/{len(ok)} OK")
sys.exit(0 if all(ok) else 1)
