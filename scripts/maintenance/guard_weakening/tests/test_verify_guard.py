#!/usr/bin/env python3
"""scripts/verify_guard.py（verify-* の守りの①新規追加＋registry の行の追加・②今ある verify の変異検査）の試験。小さな fixture の js で本物の node を回す（ネットワーク無し）。
@babel/parser は龍神の node_modules（~/boatrace-ai-predictor）を使う。無ければ変異の試験は飛ばす（飛ばした数を出す）。
`python3 tests/test_verify_guard.py`"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

W = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("verify_guard", W / "verify_guard.py")
vg = importlib.util.module_from_spec(spec)
sys.modules["verify_guard"] = vg
spec.loader.exec_module(vg)

NM = W.parents[2] / "node_modules"  # 龍神の写し: リポジトリの根の node_modules（hq の版は ~/boatrace-ai-predictor/node_modules）
HAVE_NM = (NM / "@babel" / "parser").is_dir()
ok, skipped = [], 0


def check(name, cond, got=""):
    ok.append(bool(cond))
    print(f"   {'OK' if cond else 'NG'} {name}" + ("" if cond else f" → {str(got)[:600]}"))


CALC = ("export function clamp(x) {\n  if (x > 10) {\n    return 10;\n  }\n  return x;\n}\n"
        "export function isBig(x) {\n  return x >= 5 && x !== 7;\n}\n")
STRONG = ('import { clamp, isBig } from "../../src/calc.js";\n'
          'const t = (c, m) => { if (!c) { console.error("NG " + m); process.exit(1); } };\n'
          't(clamp(20) === 10, "clamp hi"); t(clamp(3) === 3, "clamp lo"); t(isBig(5) === true, "big5"); t(isBig(4) === false, "big4"); t(isBig(7) === false, "big7");\n')
WEAK = ('import { clamp } from "../../src/calc.js";\n'
        'if (clamp(20) !== 10) { process.exit(1); }\n')
OLD_STRONG = STRONG.replace('t(isBig(7) === false, "big7");', "")  # 旧は isBig(7) を見ない
NEW_ONLY_IMPORT = ('import { clamp } from "../../src/calc.js";\n'
                   'if (clamp(20) !== 10 || clamp(3) !== 3) { process.exit(1); }\n')
REG = {"$comment": ["x"], "entries": [{"script": "verify-calc.js", "tier": "ci", "guards": "calc"}, {"script": "verify-b.js", "tier": "ci", "guards": "b"}]}


def mk(files):
    d = Path(tempfile.mkdtemp(prefix="vg-test-"))
    (d / "package.json").write_text('{"type":"module"}')
    for p, t in files.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True)
        (d / p).write_text(t)
    return d


def reg(rows, top=None):
    return json.dumps({**(top or {"$comment": ["x"]}), "entries": rows})


CFG = {"node_modules": str(NM), "max_mutants_per_verify": 40, "run_timeout_sec": 60}
V = "scripts/maintenance/verify-calc.js"
N = "scripts/maintenance/verify-new.js"
R = "scripts/maintenance/verify-registry.json"
MASTER = {V: OLD_STRONG, R: reg(REG["entries"])}
master = MASTER.get

print("静的な確かめ")
check("src を import するだけ・fs 無し: 問題なし", vg.static_problems(NEW_ONLY_IMPORT) == [])
check("fs で src/ の .js を読む: 落とす", vg.static_problems('import fs from "node:fs";\nconst t = fs.readFileSync(new URL("../../src/calc.js", import.meta.url), "utf8");'))
check("fs で src/ の css を読む: 許す", vg.static_problems('import fs from "node:fs";\nconst t = fs.readFileSync("src/styles/tokens.css", "utf8");') == [])
check("fs で src/ の locales を読む: 許す", vg.static_problems('import fs from "fs";\nconst t = fs.readFileSync("src/locales/ja.json", "utf8");') == [])
check("path.join の 'src' で .jsx を読む: 落とす", vg.static_problems("const fs = require('fs'); fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');"))
check("コメントの中の src/ は数えない", vg.static_problems('import fs from "node:fs";\n// readFileSync("src/a.js")\nfs.readFileSync("data/a.json");') == [])
check("child_process: 落とす", vg.static_problems('import { execSync } from "node:child_process";'))
check("fs の書き: 落とす", vg.static_problems('import fs from "node:fs";\nfs.writeFileSync("/tmp/x", "1");'))
check("fetch: 落とす", vg.static_problems('await fetch("https://example.com");'))
check("試しの道具に dataLayerSource.js（verify の読み先）", "scripts/maintenance/dataLayerSource.js" in vg.TEST_HELPERS)
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg(REG["entries"] + [{"script": "verify-n.js", "tier": "ci", "guards": "n"}]))
check("registry: 行の追加だけ", a == ["verify-n.js"] and not r_ and not why, (a, r_, why))
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg([{**REG["entries"][0], "tier": "manual"}, REG["entries"][1]]))
check("registry: 既存の行の動きの欄（tier）の変更は理由に出る", why, why)
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg([{**REG["entries"][0], "guards": "書き換えた説明", "note": "n"}, REG["entries"][1]]))
check("registry: 説明の欄（guards・note）だけの書き換えは理由にしない（HR34 #2511）", not a and not r_ and not why, (a, r_, why))
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg([{**REG["entries"][0], "guards": " "}, REG["entries"][1]]))
check("registry: guards を空にするのは理由に出る", why and "空" in why[0], why)
a, r_, why = vg.registry_diff(reg(REG["entries"]), "{壊れた")
check("registry: 読めない JSON は理由に出る", why, why)
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg(REG["entries"], {"$comment": ["y"], "x": 1}))
check("registry: entries 以外の欄の変更は理由に出る", why, why)
a, r_, why = vg.registry_diff(reg(REG["entries"]), reg(REG["entries"], {"$comment": ["y"]}))
check("registry: $comment だけの書き換えは理由にしない", not why, why)
check("案内の文の末尾の .js はコードの読みに数えない（HR34 #2511 ui-wording）",
      vg.static_problems('import fs from "node:fs";\nconst H = { a: "禁止語を言い換える。正本は verify-ui-wording.js" };\nfs.readFileSync("data/a.json");') == [])
check("is_verify_path: .js と registry だけ（.json の台は守りのまま）", vg.is_verify_path(V) and vg.is_verify_path(R) and not vg.is_verify_path("scripts/maintenance/verify-x-allowlist.json")
      and not vg.is_verify_path("scripts/lib/a.js"))
check("関係の無い差分は何も言わない", vg.evaluate(Path("/nonexistent"), {"src/a.js": "M", "package.json": "M"}, master, CFG) == vg.Verdict(frozenset(), [], {}))

if not HAVE_NM:
    skipped = 1
    print("   SKIP @babel/parser が無い（~/boatrace-ai-predictor/node_modules）。node を回す試験を飛ばした")
else:
    print("① 新しい verify の追加＋registry の行の追加")
    added_row = {"script": "verify-new.js", "tier": "ci", "guards": "new"}
    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT, R: reg(REG["entries"] + [added_row])})
    v = vg.evaluate(d, {N: "A", R: "M"}, master, CFG)
    check("新 verify（通る・src を fs で読まない）＋registry の行の追加: 通る", v.excused == {N, R} and not v.human, (v.excused, v.human))
    check("node_modules の symlink は消えている", not (d / "node_modules").exists())
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT, R: reg([{**REG["entries"][0], "tier": "manual"}, REG["entries"][1], added_row])})
    v = vg.evaluate(d, {N: "A", R: "M"}, master, CFG)
    check("registry の既存の行の tier を変えた: registry は止まる（新 verify は通る）", R not in v.excused and N in v.excused and any("既存の行" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    print("HR34 #2511: 注釈・案内の文だけの変更、registry の説明だけの変更")
    commented = "// 正本は AGENTS.md（注釈を書き換えた）\n" + OLD_STRONG.replace('console.error("NG " + m)', 'console.error("NG（案内を書き換えた） " + m)')
    d = mk({"src/calc.js": CALC, V: commented, R: reg([{**REG["entries"][0], "guards": "説明を書き換えた"}, REG["entries"][1]])})
    v = vg.evaluate(d, {V: "M", R: "M"}, master, CFG)
    check("注釈と console の案内の文だけ: 変異なしで通る・registry の説明だけも通る", v.excused == {V, R} and not v.human and v.record.get("same_ast") == [V], (v.excused, v.human, v.record.get("same_ast")))
    shutil.rmtree(d)
    weaker = OLD_STRONG.replace('"clamp hi"', '"clamp hi（案内）"').replace("clamp(20) === 10", "clamp(20) === 10 || true")
    d = mk({"src/calc.js": CALC, V: weaker})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    check("案内の文に混ぜて式も変えた: 等価にしない（変異で比べて人）", V not in v.excused and not v.record.get("same_ast"), (v.excused, v.human))
    shutil.rmtree(d)
    const_msg = OLD_STRONG.replace('"clamp hi"', '"clamp hi（定数の文）"')
    d = mk({"src/calc.js": CALC, V: const_msg})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    check("console の外の文字列の変更: 等価にしない（変異で比べる）", not v.record.get("same_ast"), v.record)
    shutil.rmtree(d)

    print("same_ast の抜け道（ops 審査 11/12 P0-1・P2-10）")
    A0 = 'const src = "x";\nconsole.log(check(src.includes("禁止語")));\n'
    check("console の引数の中の呼び出しの文字列: 等価にしない", not vg.same_ast(NM, A0, A0.replace("禁止語", "別の語")))
    B0 = 'console.log([1].map((x) => { if (x === "a") process.exit(1); }));\n'
    check("console の引数の中の関数の文字列: 等価にしない", not vg.same_ast(NM, B0, B0.replace('"a"', '"b"')))
    C0 = 'const console = { log: (m) => { if (m === "ok") process.exit(1); } };\nconsole.log("ok");\n'
    check("console を自前で定義した本文: 等価にしない", not vg.same_ast(NM, C0, C0.replace('log("ok")', 'log("ng")')))
    D0 = 'const m = 1;\nconsole.error("NG " + m, `件 ${m}`);\nprocess.stderr.write("x\\n");\n'
    check("直の文字列・名前との + ・名前だけのテンプレート: 等価", vg.same_ast(NM, D0, D0.replace("NG ", "NG（案内） ").replace("件 ", "件数 ").replace('"x', '"y')))
    check("テンプレートの式を変える: 等価にしない", not vg.same_ast(NM, D0, D0.replace("${m}", "${m + 1}")))

    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT, R: reg([REG["entries"][0]])})
    v = vg.evaluate(d, {N: "A", R: "M"}, master, CFG)
    check("registry の既存の行を消した（verify の削除でない）: 止まる", R not in v.excused and any("行の削除" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    reader = ('import fs from "node:fs";\nimport { clamp } from "../../src/calc.js";\n'
              'if (!fs.readFileSync(new URL("../../src/calc.js", import.meta.url), "utf8").includes("clamp") || clamp(20) !== 10) process.exit(1);\n')
    d = mk({"src/calc.js": CALC, N: reader, R: reg(REG["entries"] + [added_row])})
    v = vg.evaluate(d, {N: "A", R: "M"}, master, CFG)
    check("src の本文を fs で読む新 verify: 止まる", N not in v.excused and any("fs で読んでいる" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: 'import { clamp } from "../../src/calc.js";\nif (clamp(20) !== 11) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    check("通らない新 verify: 止まる", N not in v.excused and any("通らない" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "A"}, master, CFG)
    check("追加と言いつつ origin/master に既にある: 止まる", V not in v.excused, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: 'import { clamp } from "../../src/calc.js";\nvoid clamp;\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("常に緑の新 verify（何も落とさない）: 止まる", N not in v.excused and any("常に緑" in h for h in v.human) and rec.get("killed_new") == 0, (v.excused, v.human, rec))
    check("常に緑でも製品のファイルは元に戻っている", (d / "src/calc.js").read_text() == CALC)
    shutil.rmtree(d)

    d = mk({N: "process.exit(0);\n"})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    check("製品のファイルを読まない新 verify: 止まる側", N not in v.excused and any("見つからず" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("落とす新 verify: 台帳の記録に killed_new=1", N in v.excused and rec.get("killed_new") == 1, (v.excused, rec))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT})
    v = vg.evaluate(d, {N: "A"}, master, {**CFG, "node_modules": "/nonexistent"})
    check("node_modules が無い: 止まる側", not v.excused and any("node_modules" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    print("② 今ある verify の変異検査")
    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("新が旧より強い（旧 ⊆ 新）: 通る", V in v.excused and not v.human, (v.excused, v.human, rec))
    check("台帳の記録: 変異の数・旧が落とした数", rec.get("mutants_used", 0) > 0 and rec.get("killed_old", 0) > 0 and rec.get("missed") == [], rec)
    check("製品のファイルは元に戻っている", (d / "src/calc.js").read_text() == CALC and not list((d / "scripts/maintenance").glob("*__old__*")))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "M"}, master, {**CFG, "max_mutants_per_verify": 3})
    rec = (v.record.get("mutation") or [{}])[0]
    check("変異の数は config の上限まで", rec.get("mutants_used") == 3 and rec.get("mutants_total", 0) > 3, rec)
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: WEAK})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("新が弱い（旧が落とす変異を新が落とさない）: 止まる", V not in v.excused and rec.get("missed") and any("落とさない" in h for h in v.human), (v.excused, v.human, rec))
    check("弱い新でも製品のファイルは元に戻っている", (d / "src/calc.js").read_text() == CALC)
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC})
    v = vg.evaluate(d, {V: "D"}, master, CFG)
    check("削除（新が何も落とさない）: 旧が落とす変異があるので止まる", V not in v.excused and v.human, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: STRONG, R: reg([REG["entries"][1]])})
    v = vg.evaluate(d, {V: "D", R: "M"}, master, CFG)
    check("削除＋registry の行の削除: 削除が止まれば registry も止まる", V not in v.excused and R not in v.excused, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/consts.js": 'export const NAME = undefined;\nexport const KIND = null;\n',
            V: 'import { NAME } from "../../src/consts.js";\nif (NAME !== "a") process.exit(1);\nconst changed = 1;\n'})
    v = vg.evaluate(d, {V: "M"}, {V: 'import { NAME } from "../../src/consts.js";\nif (NAME !== "a") process.exit(1);\n'}.get, CFG)
    check("変異が作れない製品のファイル: 止まる側", V not in v.excused and any("変異が作れない" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({V: 'const changed = 1;\nprocess.exit(0);\n'})
    v = vg.evaluate(d, {V: "M"}, {V: 'process.exit(0);\n'}.get, CFG)
    check("製品のファイルを読まない verify: 止まる側", V not in v.excused and any("見つからず" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "M"}, {V: 'import { clamp } from "../../src/calc.js";\nprocess.exit(1);\n'}.get, CFG)
    check("基準で旧が通らない: 比べられず止まる", V not in v.excused and any("旧の verify が通らない" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/broken.js": "export const = ;", V: 'import { x } from "../../src/broken.js";\nconst changed = 1;\n'})
    v = vg.evaluate(d, {V: "M"}, {V: 'import { x } from "../../src/broken.js";\n'}.get, CFG)
    check("解析できない製品のファイル: 止まる側", V not in v.excused, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: STRONG})
    seen = []
    v = vg.evaluate(d, {V: "M"}, master, CFG, run=lambda argv, cwd, env, t: (seen.append((list(argv), dict(env))) or 0))
    check("sandbox-exec で回す（--permission は使わない）・環境変数は最小（トークン等を渡さない）・TMPDIR は一時の場所",
          seen and seen[0][0][0] == "/usr/bin/sandbox-exec" and "--permission" not in seen[0][0] and set(seen[0][1]) <= {"PATH", "CI", "TMPDIR", "HOME", "NO_COLOR", "GIT_CEILING_DIRECTORIES"}
          and "verify-guard-" in seen[0][1]["TMPDIR"], seen[:1])
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, N: 'import { execSync } from "node:child_process";\nexecSync("echo hi");\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    check("child_process を使う新 verify: 止まる", N not in v.excused, (v.excused, v.human))
    shutil.rmtree(d)

    print("変異の種類")
    d = mk({"src/m.js": 'export function f(a) {\n  const k = 3;\n  log(a);\n  if (a === k) return a + 1;\n  return a && k;\n}\nexport const T = "label";\n'})
    ms, why = vg.make_mutants(d, NM, "src/m.js")
    kinds = {m["kind"] for m in ms}
    check("変異は op・return・num・stmt・str（名前の付け替えは無い）", kinds == {"op", "return", "num", "stmt", "str"} and not why, (kinds, why))
    shutil.rmtree(d)


# ---------- P0-1: sandbox-exec（実機。無い環境では SKIP） ----------
print("sandbox-exec の実測（ネットワーク拒否・一時の場所の外に書けない・child_process と module.register は動く）")
import socket
import subprocess
import threading

if not (vg.sandbox_available() and HAVE_NM):
    skipped += 1
    print("   SKIP sandbox-exec か node_modules（@babel/parser）が無い環境。実機の sandbox の試験を飛ばした")
else:
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    port = srv.getsockname()[1]
    def _accept():
        try:
            for _ in range(5):
                srv.accept()
        except OSError:
            pass
    threading.Thread(target=_accept, daemon=True).start()
    outside = Path(tempfile.mkdtemp(prefix="vg-outside-"))
    scfg = {**CFG, "sandbox": True}

    def sb_run(js, sandbox=True):
        with vg.Runner(mk({}), NM, {**scfg, "sandbox": sandbox}, vg.default_run) as rn:
            f = rn.repo / "probe.cjs"
            f.write_text(js)
            return rn.passes(f), rn
    net = f'const s = require("net").connect({port}, "127.0.0.1"); s.on("connect", () => {{ s.destroy(); process.exit(0); }}); s.on("error", () => process.exit(1));'
    check("対照: サンドボックス無しではローカルへ接続できる（試験の前提）", sb_run(net, sandbox=False)[0])
    check("サンドボックスの中ではネットワークが拒まれる", not sb_run(net)[0])
    check("一時の場所の外には書けない", not sb_run(f'require("fs").writeFileSync({json.dumps(str(outside / "x"))}, "1");')[0] and not (outside / "x").exists())
    check("作業場所のコピーの中には書ける", sb_run('require("fs").writeFileSync("inside.txt", "1");')[0])
    check("TMPDIR には書ける", sb_run('require("fs").writeFileSync(require("path").join(process.env.TMPDIR, "t.txt"), "1");')[0])
    check("child_process（spawnSync）が動く（旧 verify の形）", sb_run('const r = require("child_process").spawnSync("echo", ["hi"]); process.exit(r.status === 0 ? 0 : 1);')[0])
    ok_, rn_ = sb_run("process.exit(0)")
    check("作業場所のコピーへの書きは本物の作業場所に出ない（コピーは別の場所・終われば消える）", not rn_.repo.exists())
    srv.close()
    shutil.rmtree(outside, ignore_errors=True)

    # renderJsx（龍神の origin/master の scripts/lib/renderJsx.js）が vite・module.register・jsdom ごとサンドボックスの中で動く
    RJ = subprocess.run(["git", "-C", str(W.parents[2]), "show", "origin/master:scripts/lib/renderJsx.js"], capture_output=True, text=True)
    needs = all((NM / x).is_dir() for x in ("vite", "jsdom", "react", "react-dom"))
    if RJ.returncode != 0 or not needs:
        skipped += 1
        print("   SKIP 龍神の origin/master の renderJsx.js か vite・jsdom・react が無い。renderJsx の実測を飛ばした")
    else:
        HV = "scripts/maintenance/verify-hello.js"
        d = mk({"scripts/lib/renderJsx.js": RJ.stdout, "src/Hello.jsx": 'export default function Hello({ name }) { return <p>こんにちは {name}</p>; }\n',
                HV: ('import { renderJsx } from "../lib/renderJsx.js";\nimport { fileURLToPath } from "node:url";\n'
                     'const { container, unmount } = await renderJsx(fileURLToPath(new URL("../../src/Hello.jsx", import.meta.url)), { name: "A" });\n'
                     'if (!container.textContent.includes("こんにちは A")) { console.error("NG " + container.textContent); process.exit(1); }\nawait unmount();\n')})
        with vg.Runner(d, NM, scfg, vg.default_run) as rn:
            check("renderJsx（vite の import・module.register・jsdom）を使う verify がサンドボックスの中で通る", rn.passes(rn.repo / HV))
            (rn.repo / "src/Hello.jsx").write_text('export default function Hello({ name }) { return <p>さようなら {name}</p>; }\n')
            check("同じ verify は製品を変えると落ちる（見ている）", not rn.passes(rn.repo / HV))
        shutil.rmtree(d)

if HAVE_NM:
    d = mk({"src/calc.js": CALC, V: STRONG})
    orig_sb = vg.SANDBOX_EXEC
    vg.SANDBOX_EXEC = "/nonexistent/sandbox-exec"
    try:
        v = vg.evaluate(d, {V: "M"}, master, CFG)
    finally:
        vg.SANDBOX_EXEC = orig_sb
    check("sandbox-exec が無い環境: 判定を出さず止める側（サンドボックス無しで回さない）", not v.excused and any("sandbox-exec" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

# ---------- P0-2: 旧が何も落とさない（killed_old が空）は通さない ----------
if HAVE_NM:
    print("P0-2: 旧が1つも変異を落とさない・文字列と JSX の変異")
    NOKILL_OLD = 'import { clamp } from "../../src/calc.js";\nvoid clamp;\n'
    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "M"}, {V: NOKILL_OLD, R: MASTER[R]}.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("変更: 旧が1つも落とさない（killed_old=0）なら通さず理由の文つきで人へ", V not in v.excused and rec.get("killed_old") == 0 and any("1つも落とさず" in h for h in v.human), (v.excused, v.human, rec))
    shutil.rmtree(d)
    d = mk({"src/calc.js": CALC})
    v = vg.evaluate(d, {V: "D"}, {V: NOKILL_OLD, R: MASTER[R]}.get, CFG)
    check("削除: 旧が1つも落とさない（何も守っていない verify）でも自動では通さない", V not in v.excused and any("1つも落とさず" in h and "削除" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)
    d = mk({"src/s.js": 'export function label(k) {\n  return k ? "有効" : "無効";\n}\n', "src/V.jsx": "export default function V() { return <p>ようこそ</p>; }\n"})
    ms, why = vg.make_mutants(d, NM, "src/s.js")
    check("文字列リテラルを変える変異（str）が作れる", any(m["kind"] == "str" and m["repl"] == '"有効~"' for m in ms), (ms, why))
    ms, why = vg.make_mutants(d, NM, "src/V.jsx")
    check("JSX のテキストを変える変異（jsxtext）が作れる", any(m["kind"] == "jsxtext" and m["repl"] == "ようこそ~" for m in ms), (ms, why))
    kept = vg.pick([{"i": i} for i in range(100)], 40)
    check("選ぶ数の上限は今までどおり（max_mutants_per_verify まで間引く）", len(kept) == 40)
    shutil.rmtree(d)
    # 文字列の変異で新が弱いことを見つける（旧は文字列を見る・新は見ない）
    LBL = 'export function label(k) {\n  return k ? "有効" : "無効";\n}\n'
    OLD_L = 'import { label } from "../../src/s.js";\nif (label(true) !== "有効" || label(false) !== "無効") process.exit(1);\n'
    NEW_L = 'import { label } from "../../src/s.js";\nif (typeof label(true) !== "string") process.exit(1);\n'
    d = mk({"src/s.js": LBL, V: NEW_L})
    v = vg.evaluate(d, {V: "M"}, {V: OLD_L}.get, CFG)
    check("文字列の変異: 旧が落とし新が落とさないなら止まる", V not in v.excused and any("落とさない" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    print("P1-4: 変更（M）の新しい本文にも静的な確かめ")
    d = mk({"src/calc.js": CALC, V: STRONG + 'await fetch("https://example.com");\n'})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    check("変更で fetch を足した: 止まる（変異検査に進まない）", V not in v.excused and any("増えた" in h for h in v.human) and not v.record.get("mutation"), (v.excused, v.human))
    shutil.rmtree(d)
    d = mk({"src/calc.js": CALC, V: STRONG + 'import fs from "node:fs";\nfs.writeFileSync("/tmp/x", "1");\n'})
    v = vg.evaluate(d, {V: "M"}, master, CFG)
    check("変更で fs の書きを足した: 止まる", V not in v.excused and any("fs の書き" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)
    d = mk({"src/calc.js": CALC, V: STRONG})
    v = vg.evaluate(d, {V: "M"}, {V: OLD_STRONG + '\nimport { spawnSync } from "node:child_process";\nvoid spawnSync;\n'}.get, CFG)
    check("旧が child_process を使っていて新で増えていない（語を減らした）変更は静的では止めない", not any("増えた" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    print("P1-5: 置き換えは同じファイルの書き換え（M）だけ。D と A の組は人へ")
    d = mk({"src/calc.js": CALC, N: NEW_ONLY_IMPORT})
    v = vg.evaluate(d, {V: "D", N: "A"}, {V: OLD_STRONG}.get, CFG)
    check("旧の削除＋別名の新規追加（D＋A）: 削除は旧が落とす変異を新が（削除なので）落とさず人へ回る。追加側の判定とは独立", V not in v.excused and any(V in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

# ---------- HR34: コピーに git の索引・scripts/ の製品・製品のファイルごとの落とし ----------
if HAVE_NM:
    import subprocess as _sp
    print("HR34: git を使う旧の verify・scripts/ を試す verify・製品のファイルごとの落とし")

    def git_repo(files):
        d = mk(files)
        g = ["git", "-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false"]
        _sp.run(["git", "init", "-q", str(d)], check=True)
        _sp.run([*g, "-C", str(d), "add", "--", *files.keys(), "package.json"], check=True)
        _sp.run([*g, "-C", str(d), "commit", "-q", "-m", "x"], check=True)
        return d, g

    def git_state(d):
        gd = _sp.run(["git", "-C", str(d), "rev-parse", "--path-format=absolute", "--git-common-dir"], capture_output=True, text=True).stdout.strip()
        return sorted(str(x.relative_to(gd)) for x in Path(gd).rglob("*") if x.is_file() and "/logs/" not in str(x))

    LSF = ('import { execFileSync } from "node:child_process";\n'
           'const ls = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\\0");\n'
           'if (!ls.includes("src/calc.js")) { console.error("NG ls-files " + ls.length); process.exit(1); }\n')
    d, g = git_repo({"src/calc.js": CALC, V: LSF + STRONG})
    before = git_state(d)
    v = vg.evaluate(d, {V: "M"}, {V: LSF + OLD_STRONG}.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("git ls-files を使う旧の verify: コピーに索引があり比べられて通る", V in v.excused and not v.human and rec.get("killed_old", 0) > 0, (v.excused, v.human, rec))
    check("元の作業場所の .git には何も書かない", git_state(d) == before)
    wt = Path(tempfile.mkdtemp(prefix="vg-wt-")) / "w"
    _sp.run([*g, "-C", str(d), "worktree", "add", "-q", "--detach", str(wt)], check=True)
    v = vg.evaluate(wt, {V: "M"}, {V: LSF + OLD_STRONG}.get, CFG)
    check("git worktree（.git がファイル）の作業場所でも索引を持たせて通る", V in v.excused and not v.human, (v.excused, v.human))
    shutil.rmtree(wt.parent)
    shutil.rmtree(d)

    with vg.Runner(mk({"a.js": "1"}), NM, CFG, vg.default_run) as rn:
        check(".git の無い作業場所のコピーには .git を作らない（今までどおり）", not (rn.repo / ".git").exists())

    SL = "scripts/lib/calc.js"
    NEW_SL = 'import { clamp } from "../lib/calc.js";\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'
    d = mk({SL: CALC, N: NEW_SL})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("scripts/ を試す新しい verify: 製品が見つかり落とせば通る", N in v.excused and rec.get("products") == [SL], (v.excused, v.human, rec))
    shutil.rmtree(d)

    d = mk({SL: CALC, N: 'import { clamp } from "../lib/calc.js";\nvoid clamp;\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    check("scripts/ を import するだけで常に緑: 止まる", N not in v.excused and any("1つも落とさない" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, "src/other.js": "export function twice(x) {\n  return x * 2 + 0;\n}\n",
            N: 'import { clamp } from "../../src/calc.js";\nimport { twice } from "../../src/other.js";\nvoid twice;\nif (clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("製品のファイル2つのうち1つしか見ない: 止まる（前は1つ落とせば通った）", N not in v.excused and any("1/2" in h and "src/other.js" in h for h in v.human)
          and rec.get("killed_by_product") == {"src/calc.js": 1, "src/other.js": 0}, (v.excused, v.human, rec))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, "src/other.js": "export function twice(x) {\n  return x * 2;\n}\n",
            N: 'import { clamp } from "../../src/calc.js";\nimport { twice } from "../../src/other.js";\nif (twice(3) !== 6 || clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("製品のファイルごとに落とす: 通る（killed_new は落とせたファイルの数）", N in v.excused and rec.get("killed_new") == 2, (v.excused, v.human, rec))
    shutil.rmtree(d)

    d = mk({"scripts/lib/renderJsx.js": "export function renderJsx(x) {\n  return x === 1;\n}\n", "src/calc.js": CALC,
            N: 'import { renderJsx } from "../lib/renderJsx.js";\nimport { clamp } from "../../src/calc.js";\nif (!renderJsx(1) || clamp(20) !== 10 || clamp(3) !== 3) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    rec = (v.record.get("addition") or [{}])[0]
    check("試しの道具（renderJsx）は製品に数えない", rec.get("products") == ["src/calc.js"] and N in v.excused, (v.excused, v.human, rec))
    shutil.rmtree(d)

    print("HR34 審査の直し")
    DIRTY = ('import { spawnSync } from "node:child_process";\n'
             'if (spawnSync("git", ["diff", "--quiet"]).status === 1) process.exit(1);\n')
    d, g = git_repo({"src/calc.js": CALC, V: DIRTY})
    v = vg.evaluate(d, {V: "M"}, {V: 'import { spawnSync } from "node:child_process";\nvoid spawnSync;\n' + OLD_STRONG}.get, CFG)
    rec = (v.record.get("mutation") or [{}])[0]
    check("新の verify が「git diff が汚れたら落ちる」で全変異を落とす: 索引が中身に合い落とせず止まる",
          V not in v.excused and rec.get("killed_old", 0) > 0 and rec.get("missed"), (v.excused, v.human, rec))
    shutil.rmtree(d)

    d, g = git_repo({"src/calc.js": CALC, V: STRONG})
    with vg.Runner(d, NM, CFG, vg.default_run) as rn:
        rn.write("src/calc.js", CALC.replace("10", "11").encode())
        dirty = _sp.run(["git", "diff", "--quiet"], cwd=rn.repo).returncode
        head = _sp.run(["git", "rev-parse", "-q", "--verify", "HEAD"], cwd=rn.repo).returncode
        check("写しの索引は変異を当てても中身に合う（git diff が空）・HEAD は置かない", dirty == 0 and head != 0, (dirty, head))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, V: LSF + STRONG})
    _sp.run(["git", "init", "-q", str(d)], check=True)
    _sp.run(["git", "-C", str(d), "add", "--", "src/calc.js", V, "package.json"], check=True)
    v = vg.evaluate(d, {V: "M"}, {V: LSF + OLD_STRONG}.get, CFG)
    check("HEAD の無い repo（commit 前）でも索引は写した一覧で作られ通る", V in v.excused and not v.human, (v.excused, v.human))
    shutil.rmtree(d)

    d, g = git_repo({"src/calc.js": CALC, V: STRONG})
    orig_seed = vg.seed_git_index
    left = set(Path(tempfile.gettempdir()).glob("verify-guard-*"))
    vg.seed_git_index = lambda *a: (_ for _ in ()).throw(RuntimeError("試しの失敗"))
    try:
        v = vg.evaluate(d, {V: "M"}, master, CFG)
    finally:
        vg.seed_git_index = orig_seed
    check("写しの索引が作れない: 止める側（回す場所を作れない）で一時の場所も残さない",
          not v.excused and any("回す場所を作れない" in h for h in v.human) and set(Path(tempfile.gettempdir()).glob("verify-guard-*")) == left, (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({"src/calc.js": CALC, "src/other.js": "export function twice(x) {\n  return x * 2;\n}\n",
            N: 'import { clamp } from "../../src/calc.js";\nimport { twice } from "../../src/other.js";\nif (twice(3) !== 6 || clamp(20) !== 10) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, {**CFG, "max_mutants_per_verify": 1})
    check("製品のファイルの数が上限を越える: 止まる", N not in v.excused and any("上限" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    check("scripts/ のコードを fs で読む新 verify: 静的に落とす", vg.static_problems('import fs from "node:fs";\nconst t = fs.readFileSync(new URL("../lib/calc.js", import.meta.url), "utf8");'))
    check("scripts/ のコードを fs で読む: import の指定だけなら落とさない", vg.static_problems('import fs from "node:fs";\nimport { a } from "../lib/calc.js";\nconst j = await import("./x.mjs");\nfs.readFileSync("data/a.json");') == [])
    d = mk({SL: CALC, N: 'import fs from "node:fs";\nconst t = fs.readFileSync(new URL("../lib/calc.js", import.meta.url), "utf8");\nif (!t.includes("x > 10")) process.exit(1);\n'})
    v = vg.evaluate(d, {N: "A"}, master, CFG)
    check("scripts/ の本文を照合して全変異を落とす新 verify: 止まる", N not in v.excused and any("fs で読んでいる" in h for h in v.human), (v.excused, v.human))
    shutil.rmtree(d)

    d = mk({V: STRONG, "src/calc.js": CALC, N: 'import "./verify-calc.js";\n'})
    check("他の verify・自分自身は製品に数えない", vg.product_files(d, N, ['import "./verify-calc.js";\nconst me = "./verify-new.js";\n']) == [])
    shutil.rmtree(d)

print(f"\n{sum(ok)}/{len(ok)} OK" + (f"（飛ばし {skipped}）" if skipped else ""))
sys.exit(0 if all(ok) else 1)
