#!/usr/bin/env python3
"""verify-* の守りを2つに分ける判定（drafts/verify-redesign-20261109.md v2、オーナー 11/9『代案の形で進めてよい』、docs/decisions/ryujin-boundary.md）。
maker-dispatch の guarded（scripts/maintenance/verify-*）に当たった差分のうち、次だけを「人へ回さない」パスとして返す。標準ライブラリだけ。

① 新しい verify-*.js の追加（status A）と、verify-registry.json への行の追加だけの変更。機械の確かめ:
   新しい verify が通る・常に緑でない（製品のファイルごとに変異を1つは落とす、HR34）・registry の JSON が読めて既存の行が変わっていない・新しい verify が src/ api/ の本文を fs で読まない（CSS の値・locales は許す。
   本文の静的な確かめで目安。fs の書き・child_process・ネットワークの語も落とす）
② 今ある verify-*.js の変更・削除（M・D）。製品のファイル（その verify が import・読む src/ api/ scripts/ の物。verify 自身は除く）に @babel/parser で振る舞いを変える変異
   （比べる演算子の反転・&&↔||・戻り値を null に・数値の定数を変える・文の削除）を作り、「旧の verify（origin/master の版）で落ちた変異 ⊆ 新の verify で落ちた変異」なら通す。
   変異が作れない・製品のファイルが見つからない・基準（変異なし）で旧か新が落ちる・node_modules が無いときは通さない（止める側）

verify の実行は macOS の sandbox-exec（ネットワーク拒否・fs の書きは「worktree のコピー」と TMPDIR の一時の場所だけ・読みと子プロセスの起動は許す）。
node --permission は使わない（vite の import・module.register・child_process が落ち、龍神の renderJsx 経由の試験や spawnSync の旧 verify が動かないため、11/9 ops 審査 P0-1）。
sandbox-exec が無い環境では判定を出さず止める側。静的な確かめ（①）は今も多重の防御として残す。
使い方: evaluate(repo, changes, master_text, cfg) -> Verdict。changes は {パス: A|M|D}（git diff --name-status --no-renames origin/master）。"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, FrozenSet, Iterable, List, Mapping, Optional, Sequence, Tuple

Json = Dict[str, object]
VERIFY_RE = re.compile(r"scripts/maintenance/verify-[^/]+\.js")
REGISTRY = "scripts/maintenance/verify-registry.json"
DEFAULTS: Json = {
    "max_mutants_per_verify": 40,  # 目安（根拠なし）。ここまで等間隔に間引く
    "run_timeout_sec": 120,  # 目安（根拠なし）。verify 1回の上限。超えたら落ちた扱い
    "sandbox": True,  # sandbox-exec（ネットワーク拒否・fs 書きは worktree のコピーと TMPDIR だけ）。False は試験用（守りが無い）
    "node_modules": "",  # 作業場所に node_modules が無いときの場所（lane の npm ci 後）。どちらも無ければ止める側
}

# 振る舞いを変える変異だけ（名前の付け替え・コメント・型の注記は作らない）
MUTATOR_JS = r"""
const path = require("path"), fs = require("fs");
const nm = process.argv[1], file = process.argv[2];
const { createRequire } = require("module");
const parser = createRequire(path.join(nm, "x.js"))("@babel/parser");
const src = fs.readFileSync(file, "utf8");
const ts = /\.tsx?$/.test(file);
let ast;
try {
  ast = parser.parse(src, { sourceType: "unambiguous", errorRecovery: false, plugins: ts ? ["typescript", "jsx"] : ["jsx"] });
} catch (e) { console.log(JSON.stringify({ error: String(e.message).slice(0, 200), mutants: [] })); process.exit(0); }
const CMP = { "===": "!==", "!==": "===", "==": "!=", "!=": "==", "<": ">=", ">=": "<", ">": "<=", "<=": ">", "&&": "||", "||": "&&" };
const STR_SKIP = new Set(["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "JSXAttribute", "ExpressionStatement", "TemplateElement"]);
const out = [];
function add(kind, n, start, end, repl) { out.push({ kind, line: n.loc.start.line, start, end, repl }); }
function walk(n, parent, key) {
  if (!n || typeof n.type !== "string") return;
  if (n.type === "ImportDeclaration" || n.type === "ExportAllDeclaration" || n.type.startsWith("TS")) return;
  if ((n.type === "BinaryExpression" || n.type === "LogicalExpression") && CMP[n.operator]) {
    add("op", n, n.left.end, n.right.start, ` ${CMP[n.operator]} `);
  } else if (n.type === "ReturnStatement" && n.argument && n.argument.type !== "NullLiteral") {
    add("return", n, n.argument.start, n.argument.end, "null");
  } else if (n.type === "NumericLiteral") {
    const isKey = parent && (parent.type === "ObjectProperty" || parent.type === "ObjectMethod" || parent.type === "ClassProperty") && key === "key" && !parent.computed;
    if (!isKey) add("num", n, n.start, n.end, String(n.value === 0 ? 1 : n.value + 1));
  } else if (n.type === "StringLiteral" && parent && n.value.length > 0 && !STR_SKIP.has(parent.type)
             && !(parent.type === "ObjectProperty" && key === "key" && !parent.computed)
             && !(parent.type === "CallExpression" && parent.callee.type === "Identifier" && parent.callee.name === "require")) {
    // 文字列リテラル（表示・比較・出力の値）を別の語に。import の指定・属性・ディレクティブ・require は除く
    add("str", n, n.start, n.end, JSON.stringify(n.value + "~"));
  } else if (n.type === "JSXText" && n.value.trim().length > 0) {
    add("jsxtext", n, n.start, n.end, src.slice(n.start, n.end).replace(/\S+/, (w) => w + "~"));
  } else if (n.type === "ExpressionStatement" && parent && (parent.type === "BlockStatement" || parent.type === "Program")
             && n.expression.type !== "StringLiteral" && n.expression.type !== "DirectiveLiteral") {
    add("stmt", n, n.start, n.end, ";");
  }
  for (const k of Object.keys(n)) {
    if (k === "loc" || k === "leadingComments" || k === "trailingComments" || k === "innerComments") continue;
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, n, k)); else if (v && typeof v.type === "string") walk(v, n, k);
  }
}
walk(ast.program, null, "");
console.log(JSON.stringify({ error: null, mutants: out }));
"""

WRITE_RE = re.compile(r"\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|"
                      r"rename|renameSync|copyFile|copyFileSync|cp|cpSync|createWriteStream|truncate|truncateSync|symlink|symlinkSync)\s*\(")
NET_RE = re.compile(r"""(?:["'`](?:node:)?(?:child_process|net|http|https|http2|dgram|dns|tls|worker_threads|cluster|vm)["'`])|\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\bexecSync\b|\bspawnSync\b""")
FS_IMPORT_RE = re.compile(r"""["'`](?:node:)?fs(?:/promises)?["'`]""")
READ_RE = re.compile(r"\b(?:readFile|readFileSync|readdir|readdirSync|createReadStream|openSync|open|opendir|opendirSync|globSync|glob)\b")
LITERAL_RE = re.compile(r"""(["'`])((?:\\.|(?!\1)[^\\\n])*)\1""")
SRC_LIT_RE = re.compile(r"(?:^|[/\\])(?:src|api)(?:[/\\]|$)")
ALLOWED_WINDOW_RE = re.compile(r"\.css\b|locales")
CODE_LIT_RE = re.compile(r"\.(?:m?js|cjs|jsx|tsx?)$")
IMPORT_SPEC_RE = re.compile(r"""\b(?:from|import)\s*\(?\s*(["'`])[^"'`\n]*\1""")
COMMENT_RE = re.compile(r"/\*.*?\*/|(?<![:\"'`])//[^\n]*", re.S)


@dataclass
class Verdict:
    excused: FrozenSet[str]  # 人へ回さなくてよいパス
    human: List[str]  # 人へ回す理由（excused に入れなかったパスごと）
    record: Json = field(default_factory=dict)  # 台帳の finished 行へ残す


def is_verify_path(p: str) -> bool:
    """拾う前（票の変えてよいファイル）に守りの当たりを外してよいパスの形。判定そのものは evaluate"""
    return bool(VERIFY_RE.fullmatch(p)) or p == REGISTRY


# ① ---------------------------------------------------------------------------

def static_problems(text: str) -> List[str]:
    """新しい verify の本文の静的な確かめ（目安。難読化には負ける）。出た文が問題の理由"""
    body = COMMENT_RE.sub("", text)
    out: List[str] = []
    if NET_RE.search(body):
        out.append("child_process・ネットワーク等の語がある（新しい verify では不可）")
    if WRITE_RE.search(body):
        out.append("fs の書き・消す関数の呼び出しがある（新しい verify では不可）")
    if FS_IMPORT_RE.search(body) and READ_RE.search(body):
        code = [m.group(2) for m in LITERAL_RE.finditer(IMPORT_SPEC_RE.sub("", body)) if CODE_LIT_RE.search(m.group(2))]
        if code:  # HR34 審査 P0: scripts/ も製品にしたので、import の指定でない .js 等のパスを fs と並べたら本文の読みとみなす
            out.append(f"コードのファイルの本文を fs で読んでいる疑い（{code[0][:60]}。import して振る舞いを試す）")
        for m in LITERAL_RE.finditer(body):
            if SRC_LIT_RE.search(m.group(2)) or m.group(2) in ("src", "api"):
                window = body[m.start(): m.end() + 240].split(";")[0]
                if not ALLOWED_WINDOW_RE.search(window):
                    out.append(f"src/・api/ の本文を fs で読んでいる疑い（{m.group(2)[:60]}。許すのは CSS の値・locales）")
                    break
    return out


def static_added_problems(old: str, new: str) -> List[str]:
    """今ある verify の変更（M）の新しい本文の静的な確かめ（P1-4）。旧にも同じ語があるだけなら（旧が spawnSync を使う等）理由にせず、
    新で語が増えた・新しく現れたときだけ理由に出す（ネットワーク・fs の書き・src の本文の読み）"""
    ob, nb = COMMENT_RE.sub("", old), COMMENT_RE.sub("", new)
    out: List[str] = []
    if len(NET_RE.findall(nb)) > len(NET_RE.findall(ob)):
        out.append("child_process・ネットワーク等の語が増えた（変更でも不可）")
    if len(WRITE_RE.findall(nb)) > len(WRITE_RE.findall(ob)):
        out.append("fs の書き・消す関数の呼び出しが増えた（変更でも不可）")
    new_src = [x for x in static_problems(new) if "fs で読んでいる" in x]
    if new_src and not [x for x in static_problems(old) if "fs で読んでいる" in x]:
        out += new_src
    return out


def _registry_rows(text: Optional[str]) -> Tuple[Optional[Dict[str, Json]], Optional[Json], str]:
    if text is None:
        return None, None, "registry が無い"
    try:
        d = json.loads(text)
        rows = d["entries"]
        by = {str(r["script"]): r for r in rows}
        if len(by) != len(rows):
            return None, None, "registry に同じ script の行が2つある"
        return by, {k: v for k, v in d.items() if k != "entries"}, ""
    except (ValueError, KeyError, TypeError) as e:
        return None, None, f"registry の JSON が読めない・形が違う（{type(e).__name__}）"


def registry_diff(old_text: Optional[str], new_text: Optional[str]) -> Tuple[List[str], List[str], List[str]]:
    """(足した script, 消した script, 理由=許さない変更)。既存の行の中身の変更・registry の他の欄の変更は理由に出す"""
    old, old_top, e1 = _registry_rows(old_text)
    new, new_top, e2 = _registry_rows(new_text)
    if old is None or new is None or old_top is None or new_top is None:
        return [], [], [e1 or e2]
    why: List[str] = []
    if old_top != new_top:
        why.append("registry の entries 以外の欄が変わっている")
    changed = sorted(k for k in old if k in new and old[k] != new[k])
    if changed:
        why.append("既存の行が変わっている: " + "・".join(changed[:5]))
    return sorted(set(new) - set(old)), sorted(set(old) - set(new)), why


# ② ---------------------------------------------------------------------------

def default_run(argv: Sequence[str], cwd: Path, env: Mapping[str, str], timeout: int) -> int:
    try:
        return subprocess.run(list(argv), cwd=cwd, env=dict(env), capture_output=True, text=True, timeout=timeout).returncode
    except subprocess.TimeoutExpired:
        return 124


Run = Callable[[Sequence[str], Path, Mapping[str, str], int], int]


def _rel(p: Path, root: Path) -> str:
    return p.resolve().relative_to(root.resolve()).as_posix()


SANDBOX_EXEC = "/usr/bin/sandbox-exec"


def sandbox_profile(writable: Iterable[Path]) -> str:
    """Seatbelt のプロファイル。ネットワーク拒否・fs の書きは writable の下と /dev/null 等だけ。読み・プロセスの起動は許す（default allow）。
    パスは実パス（macOS の /var は /private/var）で渡すこと"""
    subs = "\n".join(f'  (subpath "{str(Path(w).resolve())}")' for w in writable)
    return ("(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n"
            f"(allow file-write*\n{subs}\n  (literal \"/dev/null\") (literal \"/dev/dtracehelper\") (literal \"/dev/tty\") (regex #\"^/dev/fd/\"))\n")


def native_arch_prefix() -> List[str]:
    """Rosetta の python（x86_64）から node を起動すると universal の node が x64 で動き、vite の rollup の native（darwin-arm64 だけ入っている）を読めず落ちる
    （11/9 実測: Cannot find module @rollup/rollup-darwin-x64）。arm64 の機械では arch -arm64 で本来の arch に戻す"""
    import platform
    if platform.machine() != "x86_64" or not os.path.exists("/usr/bin/arch"):
        return []
    r = subprocess.run(["/usr/sbin/sysctl", "-n", "hw.optional.arm64"], capture_output=True, text=True)
    return ["/usr/bin/arch", "-arm64"] if r.stdout.strip() == "1" else []


def sandbox_available() -> bool:
    return os.path.isfile(SANDBOX_EXEC) and os.access(SANDBOX_EXEC, os.X_OK)


def _git(cwd: Path, *args: str, stdin: Optional[bytes] = None) -> bytes:
    r = subprocess.run(["git", *args], cwd=cwd, input=stdin, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])} が失敗（{r.stderr.decode('utf-8', 'replace').strip()[:150]}）")
    return r.stdout


def seed_git_index(src: Path, dst: Path, rels: Sequence[str]) -> None:
    """コピー dst に git の索引を持たせる（HR34）。git ls-files・git diff を使う旧の verify（例 verify-pr-lane.js）がコピーの中で動くように。
    git clone --shared と同じ形: 空の .git（hooks の雛形なし）＋ src の objects への alternates（読むだけ。新しい object は dst の中に書く）
    ＋索引はコピーしたファイルの一覧（src の索引と同じ一覧）。src の .git には何も書かない。
    HEAD は置かない（unborn）。変異を当てる・戻すたびに Runner.sync で索引を写しに合わせ、「git diff が汚れたら落ちる」で全変異を落とす verify を作れなくする（HR34 審査 P0）"""
    objects = _git(src, "rev-parse", "--path-format=absolute", "--git-path", "objects").decode("utf-8").strip()
    _git(dst, "init", "-q", "--template=")
    alt = dst / ".git" / "objects" / "info"
    alt.mkdir(parents=True, exist_ok=True)
    (alt / "alternates").write_text(objects + "\n", encoding="utf-8")
    if rels:
        _git(dst, "update-index", "--add", "-z", "--stdin", stdin="\0".join(rels).encode("utf-8") + b"\0")


def copy_worktree(src: Path, dst: Path) -> None:
    """作業場所 src のコピーを dst に作る（.git・node_modules は除く。git の作業場所は追跡しているファイルだけ、そうでなければ全部）。
    git の作業場所なら、コピーにも同じ一覧の索引を持たせる（seed_git_index、HR34）。
    変異・verify の書きはこのコピーの中だけに閉じる（本物の作業場所＝push する物を触らない）"""
    dst.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(["git", "ls-files", "-z"], cwd=src, capture_output=True) if (src / ".git").exists() else None
    if r is not None and r.returncode == 0:
        copied: List[str] = []
        for rel in filter(None, r.stdout.decode("utf-8").split("\0")):
            f = src / rel
            if f.is_file() or f.is_symlink():
                (dst / rel).parent.mkdir(parents=True, exist_ok=True)
                if f.is_symlink():
                    os.symlink(os.readlink(f), dst / rel)
                else:
                    shutil.copy2(f, dst / rel)
                copied.append(rel)
        seed_git_index(src, dst, copied)
        return
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".git", "node_modules"), symlinks=True, dirs_exist_ok=True)


class Runner:
    """作業場所 src のコピー（self.repo。一時の場所の中）で verify を回す。node_modules は symlink を張る。終わりに全部消す。
    verify は sandbox-exec の中（ネットワーク拒否・書きはコピーと TMPDIR だけ）で動く"""

    def __init__(self, src: Path, nm: Path, cfg: Json, run: Run):
        if cfg.get("sandbox") and not sandbox_available():
            raise RuntimeError(f"{SANDBOX_EXEC} が無い（macOS 以外か、削除された）。サンドボックス無しでは verify を回さない")
        self.nm, self.cfg, self.run = nm.resolve(), cfg, run
        self.scratch = Path(tempfile.mkdtemp(prefix="verify-guard-")).resolve()
        try:
            self.repo = self.scratch / "work"
            copy_worktree(src.resolve(), self.repo)
            self.git = (self.repo / ".git").is_dir()
            self.tmp = self.scratch / "tmp"
            self.tmp.mkdir()
            self.profile = self.scratch / "sandbox.sb"
            self.profile.write_text(sandbox_profile([self.scratch]), encoding="utf-8")  # 書きは scratch の下（コピーと TMPDIR）だけ
            link = self.repo / "node_modules"
            if not link.exists() and not link.is_symlink():
                os.symlink(self.nm, link)
        except BaseException:
            shutil.rmtree(self.scratch, ignore_errors=True)
            raise

    def __enter__(self) -> "Runner":
        return self

    def __exit__(self, *a: object) -> None:
        shutil.rmtree(self.scratch, ignore_errors=True)

    def write(self, rel: str, data: bytes) -> None:
        """写しの製品のファイルを書き（変異を当てる・戻す）、写しに .git があれば索引もその中身に合わせる（git diff は常に空のまま）"""
        (self.repo / rel).write_bytes(data)
        if self.git:
            _git(self.repo, "update-index", "--add", "--", rel)

    def passes(self, script: Path) -> bool:
        """script（コピーの中）を回して 0 で終われば True。timeout・起動できないは落ちた扱い"""
        argv = [*native_arch_prefix(), "node", str(script)]
        if self.cfg.get("sandbox"):
            argv = [SANDBOX_EXEC, "-f", str(self.profile), *argv]
        env = {"PATH": os.environ.get("PATH", ""), "CI": "1", "TMPDIR": str(self.tmp), "HOME": str(self.tmp), "NO_COLOR": "1",
               "GIT_CEILING_DIRECTORIES": str(self.scratch.parent)}  # 写しの上（一時の場所の外）の .git を拾わない
        return self.run(argv, self.repo, env, int(self.cfg["run_timeout_sec"])) == 0  # type: ignore[call-overload]


PRODUCT_ROOTS = ("src/", "api/", "scripts/")  # scripts/ は HR34（scripts/ の判定の script を試す verify）。verify 自身・他の verify は製品に数えない
# 試しの道具（製品でなく、変異を落としても製品を見た証にならない）。龍神の origin/master の scripts/lib で verify が import する物（11/10 調べ）
TEST_HELPERS = frozenset({"scripts/lib/renderJsx.js", "scripts/lib/renderWithFreshPage.js", "scripts/lib/fakeSupabaseClient.js", "scripts/lib/isDirectRun.js",
                          "scripts/maintenance/dataLayerSource.js"})  # verify がデータ層の本文を読む読み先（1406・1409 で字の変異が等価の見逃しになった）


def product_files(repo: Path, script_rel: str, texts: Iterable[str]) -> List[str]:
    """verify が import・読む src/・api/・scripts/ の物（文字列の中の相対パス・src/…・api/…・scripts/… が指す .js/.mjs/.cjs/.jsx/.ts。
    直の参照だけで、推移は見ない）。scripts/maintenance/verify-*.js・旧の写し（*.__old__.js）・試しの道具（TEST_HELPERS・__fixtures__）は除く"""
    base = (repo / script_rel).parent
    found: List[str] = []
    for t in texts:
        for m in LITERAL_RE.finditer(t):
            s = m.group(2)
            if not re.search(r"\.(?:m?js|cjs|jsx|tsx?)$", s):
                continue
            cand = (base / s) if s.startswith(".") else (repo / s)
            try:
                rel = _rel(cand, repo)
            except ValueError:
                continue
            if VERIFY_RE.fullmatch(rel) or rel.endswith(".__old__.js") or rel == script_rel or rel in TEST_HELPERS or "/__fixtures__/" in rel:
                continue
            if rel.startswith(PRODUCT_ROOTS) and (repo / rel).is_file() and rel not in found:
                found.append(rel)
    return sorted(found)


def make_mutants(repo: Path, nm: Path, rel: str) -> Tuple[List[Json], str]:
    """(変異の並び, 作れなかった理由)。変異は {file, kind, line, start, end, repl}。解析できない物は理由に"""
    try:
        r = subprocess.run(["node", "--permission", f"--allow-fs-read={repo.resolve()}", f"--allow-fs-read={nm.resolve()}", "-e", MUTATOR_JS,
                            str(nm.resolve()), str((repo / rel).resolve())], capture_output=True, text=True, timeout=60)
        d = json.loads(r.stdout)
    except (subprocess.TimeoutExpired, ValueError, OSError) as e:
        return [], f"{rel}: 変異の生成に失敗（{type(e).__name__}）"
    if d.get("error"):
        return [], f"{rel}: @babel/parser が解析できない（{d['error']}）"
    return [{**m, "file": rel} for m in d["mutants"]], ""


def pick(mutants: List[Json], limit: int) -> List[Json]:
    """上限まで等間隔に間引く（同じ入力で同じ選び）"""
    if len(mutants) <= limit:
        return mutants
    return [mutants[i * len(mutants) // limit] for i in range(limit)]


def mkey(m: Json) -> str:
    return f"{m['file']}:{m['line']}:{m['kind']}:{m['start']}:{m['repl']}"


def apply_mutant(src: bytes, m: Json) -> bytes:
    """@babel/parser の位置は UTF-16 の文字単位に近い（BMP 外の文字は未検証）。文字列に直してから切る"""
    s = src.decode("utf-8")
    return (s[: int(m["start"])] + str(m["repl"]) + s[int(m["end"]):]).encode("utf-8")  # type: ignore[call-overload]


def mutation_gate(runner: Runner, script_rel: str, old_text: str, new_exists: bool, cfg: Json) -> Tuple[bool, str, Json]:
    """1本の今ある verify の ②。(通ったか, 通らない理由, 台帳の記録)"""
    repo = runner.repo
    new_path = repo / script_rel
    new_text = new_path.read_text(encoding="utf-8") if new_exists else ""
    old_path = new_path.with_name(new_path.stem + ".__old__.js")
    rec: Json = {"script": script_rel, "deleted": not new_exists}
    prods = product_files(repo, script_rel, [old_text, new_text])
    rec["products"] = prods
    if not prods:
        return False, f"{script_rel}: 製品のファイル（src/・api/・scripts/ の import・読み先）が見つからず変異を作れない", rec
    mutants: List[Json] = []
    for p in prods:
        ms, why = make_mutants(repo, runner.nm, p)
        if why:
            rec["skipped_product"] = why
        mutants += ms
    chosen = pick(mutants, int(cfg["max_mutants_per_verify"]))  # type: ignore[call-overload]
    rec.update(mutants_total=len(mutants), mutants_used=len(chosen))
    if not chosen:
        return False, f"{script_rel}: 振る舞いを変える変異が作れない（{rec.get('skipped_product', '候補なし')}）", rec
    old_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.write_text(old_text, encoding="utf-8")
    try:
        if not runner.passes(old_path):
            return False, f"{script_rel}: 変異なしで旧の verify が通らない（作業場所で再現できず比べられない）", rec
        if new_exists and not runner.passes(new_path):
            return False, f"{script_rel}: 変異なしで新の verify が通らない", rec
        killed_old: List[str] = []
        missed: List[str] = []
        for m in chosen:
            rel = str(m["file"])
            orig = (repo / rel).read_bytes()
            try:
                runner.write(rel, apply_mutant(orig, m))
                if runner.passes(old_path):
                    continue  # 旧が落とさない変異は比べない
                killed_old.append(mkey(m))
                if not (new_exists and not runner.passes(new_path)):
                    missed.append(mkey(m))
            finally:
                runner.write(rel, orig)
    finally:
        old_path.unlink(missing_ok=True)
    rec.update(killed_old=len(killed_old), missed=missed)
    if not killed_old:  # 旧が1つも変異を落とさない＝比べる物が無い（旧が弱い・削除も同じ）。⊆ が空で自明に成り立つのを通さない（P0-2）
        return False, (f"{script_rel}: 旧の verify が変異 {len(chosen)} 件を1つも落とさず、新と比べられない（{'削除' if not new_exists else '変更'}は人が見る）"), rec
    if missed:
        return False, f"{script_rel}: 旧の verify が落とす変異 {len(missed)}/{len(killed_old)} を新の verify が落とさない（{missed[0]}）", rec
    return True, "", rec


def addition_gate(runner: Runner, script_rel: str, cfg: Json) -> Tuple[bool, str, Json]:
    """新しい verify の「常に緑」の拒否。製品のファイル（新の verify が import・読む src/・api/・scripts/）ごとに機械の変異を作り、
    変異の作れる製品のファイルのどれにも、新の verify が落とす変異が1つ以上あることを求める（HR34。前は全体で1つ落とせば通した）。
    1つでも何も落とさない製品のファイルがあれば通さない（import しただけで見ていない物・試しの道具だけ落とす verify を止める）。
    変異が作れない・製品のファイルが見つからないときも通さない（止める側）。変異は上限を製品のファイルの数で割って等間隔に選び、1つ落とせばそのファイルは次へ。
    返す: (通ったか, 通らない理由, 台帳の記録)。基準（変異なし）で通ることは呼ぶ前に確かめてある"""
    repo = runner.repo
    path = repo / script_rel
    rec: Json = {"script": script_rel}
    prods = product_files(repo, script_rel, [path.read_text(encoding="utf-8")])
    rec["products"] = prods
    if not prods:
        return False, f"{script_rel}: 製品のファイル（src/・api/・scripts/ の import・読み先）が見つからず、何も落とさない verify か確かめられない", rec
    by_prod: Dict[str, List[Json]] = {}
    for p in prods:
        ms, why = make_mutants(repo, runner.nm, p)
        if why:
            rec["skipped_product"] = why
        if ms:
            by_prod[p] = ms
    limit = int(cfg["max_mutants_per_verify"])  # type: ignore[call-overload]
    if len(by_prod) > limit:
        return False, f"{script_rel}: 変異の作れる製品のファイル {len(by_prod)} が上限 {limit} を越え、ファイルごとに確かめられない", rec
    quota = limit // max(1, len(by_prod))
    chosen = {p: pick(ms, quota) for p, ms in by_prod.items()}
    per: Dict[str, int] = {}
    rec.update(mutants_total=sum(len(m) for m in by_prod.values()), mutants_used=sum(len(m) for m in chosen.values()), killed_new=0, killed_by_product=per)
    if not chosen:
        return False, f"{script_rel}: 振る舞いを変える変異が作れず、何も落とさない verify か確かめられない（{rec.get('skipped_product', '候補なし')}）", rec
    for p, ms in chosen.items():
        per[p] = 0
        for m in ms:
            rel = str(m["file"])
            orig = (repo / rel).read_bytes()
            try:
                runner.write(rel, apply_mutant(orig, m))
                killed = not runner.passes(path)
            finally:
                runner.write(rel, orig)
            if killed:
                per[p] = 1  # このファイルは1つ落とせば足りる。次のファイルへ
                break
    rec["killed_new"] = sum(per.values())
    blind = [p for p, k in per.items() if not k]
    if blind:
        return False, (f"{script_rel}: 製品のファイル {len(blind)}/{len(per)} で機械の変異を1つも落とさない（{'・'.join(blind[:3])}。"
                       "常に緑・見ていない製品のファイルがある verify は通さない）"), rec
    return True, "", rec


# 全体 ---------------------------------------------------------------------------

def resolve_nm(repo: Path, cfg: Json) -> Optional[Path]:
    for c in (repo / "node_modules", Path(os.path.expanduser(str(cfg.get("node_modules") or "")))):
        if str(c) and (c / "@babel" / "parser").is_dir():
            return c.resolve()
    return None


def evaluate(repo: Path, changes: Mapping[str, str], master_text: Callable[[str], Optional[str]], cfg: Optional[Json] = None,
             run: Run = default_run) -> Verdict:
    """verify-*.js と registry に当たる差分を判定する。excused に入らなかったパスは human に理由が付く（呼び出し側は今までどおり人へ回す）。
    これ以外のパス（package.json・scripts/lib/・e2e/ 等）には何もしない"""
    c: Json = {**DEFAULTS, **(cfg or {})}
    repo = Path(repo).resolve()  # sandbox のプロファイルは実パスで見る（macOS の /var は /private/var）
    verifies = {p: s for p, s in changes.items() if VERIFY_RE.fullmatch(p)}
    reg = changes.get(REGISTRY)
    if not verifies and reg is None:
        return Verdict(frozenset(), [], {})
    excused: set = set()
    human: List[str] = []
    record: Json = {"added": [], "addition": [], "mutation": []}
    nm = resolve_nm(repo, c)
    if nm is None:
        why = "node_modules（@babel/parser）が作業場所にも config の node_modules にも無く、verify を回せない"
        return Verdict(frozenset(), [f"{p}: {why}" for p in [*verifies, *([REGISTRY] if reg else [])]], {"error": why})
    try:
        rn_ctx = Runner(repo, nm, c, run)
    except (RuntimeError, OSError, subprocess.SubprocessError) as e:
        return Verdict(frozenset(), [f"{p}: verify を回す場所を作れない（{type(e).__name__}: {str(e)[:150]}）" for p in [*verifies, *([REGISTRY] if reg else [])]], {"error": str(e)[:200]})
    with rn_ctx as rn:
        for p, st in sorted(verifies.items()):
            if st == "A":
                if master_text(p) is not None:
                    human.append(f"{p}: 追加のはずが origin/master に既にある")
                    continue
                probs = static_problems((repo / p).read_text(encoding="utf-8"))
                if probs:
                    human += [f"{p}: {x}" for x in probs]
                    record.setdefault("static", []).extend(f"{p}: {x}" for x in probs)  # HR44: 書き方の誤りは作り手へ返せる（弱める変更ではない）
                elif not rn.passes(rn.repo / p):
                    human.append(f"{p}: 新しい verify が通らない")
                else:
                    ok, why, rec = addition_gate(rn, p, c)
                    record["addition"].append(rec)  # type: ignore[union-attr]
                    if ok:
                        excused.add(p)
                        record["added"].append(p)  # type: ignore[union-attr]
                    else:
                        human.append(why)
            elif st in ("M", "D"):
                old = master_text(p)
                if old is None:
                    human.append(f"{p}: origin/master に無い（今ある verify の変更として見られない）")
                    continue
                if st == "M":
                    probs = static_added_problems(old, (rn.repo / p).read_text(encoding="utf-8"))
                    if probs:  # 変更の新しい本文にも ① と同じ語の確かめ（P1-4）。旧から増えた語・新しく出た src の読みだけ止める
                        human += [f"{p}: {x}" for x in probs]
                        record.setdefault("static", []).extend(f"{p}: {x}" for x in probs)
                        continue
                ok, why, rec = mutation_gate(rn, p, old, st == "M", c)
                record["mutation"].append(rec)  # type: ignore[union-attr]
                if ok:
                    excused.add(p)
                else:
                    human.append(why)
            else:
                human.append(f"{p}: 変更の種類 {st} は見ない")
        if reg is not None:
            if reg != "M":
                human.append(f"{REGISTRY}: 追加・削除ではなく変更だけ見る（status {reg}）")
            else:
                added, removed, why = registry_diff(master_text(REGISTRY), (repo / REGISTRY).read_text(encoding="utf-8"))
                bad_removed = [r for r in removed if f"scripts/maintenance/{r}" not in excused or verifies.get(f"scripts/maintenance/{r}") != "D"]
                if why:
                    human += [f"{REGISTRY}: {x}" for x in why]
                elif bad_removed:
                    human.append(f"{REGISTRY}: 行の削除は変異検査を通した verify の削除だけ許す（{'・'.join(bad_removed[:5])}）")
                elif not added and not removed:
                    human.append(f"{REGISTRY}: 行の追加も削除も無い変更（中身は許さない）")
                else:
                    excused.add(REGISTRY)
                    record["registry"] = {"added": added, "removed": removed}
    return Verdict(frozenset(excused), human, record)


# git の読み（呼び出し側の便）-----------------------------------------------------

def name_status(repo: Path, base: str) -> Dict[str, str]:
    """base（例 origin/master）と HEAD の分かれ目（merge-base）から HEAD への差（commit 済みの作業場所を見る）。
    素の base..HEAD だと、古い master の上の枝の作り直しで master 側が後から足した・変えた verify を枝が戻した物に数える（11/10 BOA-1422）"""
    r = subprocess.run(["git", "diff", "--name-status", "--no-renames", f"{base}...HEAD"], cwd=repo, capture_output=True, text=True, check=True)
    out: Dict[str, str] = {}
    for line in r.stdout.splitlines():
        st, _, p = line.partition("\t")
        if st[:1] in "AMD" and p:
            out[p] = st[:1]
    return out


def git_show(repo: Path, ref: str) -> Callable[[str], Optional[str]]:
    def f(path: str) -> Optional[str]:
        r = subprocess.run(["git", "show", f"{ref}:{path}"], cwd=repo, capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None
    return f
