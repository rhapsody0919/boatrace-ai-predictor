#!/usr/bin/env python3
"""守りのファイルへの変更を「向き」で分ける判定器（HR44 第1段、drafts/hr44-guard-by-direction-20261111.md）。標準ライブラリだけ。判定は純関数（副作用なし）。
第1段で機械に通すのは A（縮める・名前を合わせる）だけ。B（verify）は scripts/verify_guard.py の既存判定に任せ、ここでは重ねない。
C（弱める）と D（e2e の期待を変える）は作らず、今までどおり人（owner_exceptions）。判定できない・読めない・解釈できない物は全部人（止める側）。

A の型: 龍神 origin/master の許可リスト 6 本。1本ずつ検査の本体（verify-*.js）を読み、「許可リストの行を消せば検査は締まる
（消した行の指摘は『許可に無い』で落ちる。増えた行だけが緩める）」ことを確かめた物だけを PARSERS に置く（11/11）。
  actionlint-allowlist.json            {entries:[{file,rule,line,reason}]}      行 = (file, rule, line の trim)
  css-class-collisions-allowlist.json  {entries:[{class,files[]}]}              行 = (file, class) ごと
  e2e-no-unroute-allowlist.json        {entries:[{file,code,reason}]}           行 = (file, code の trim)
  verify-e2e-recorded-network-allowlist.json 同上
  kyotei-wording-allowlist.json        {entries:[{file,line}]}                  行 = (file, line の trim)
  verify-no-undef-allowlist.json       {rules:{規則:{file:{names|count,reason}}}} 行 = names は名前ごと、count は 1..N の単位
比べ方: 行を（パス, 残りの中身）の多重集合にし、「head の行 ⊆ base の行」なら A。増えた行が1つでもあれば C（人）。
  多重集合にするのは、同じ内容の行が2箇所あれば2エントリ要る検査（e2e-no-unroute 等）で、複製が緩めになるため。reason・$comment の書き換えは向きに関係しない。
  それ以外の欄（骨格）が変わっていれば人。
付け替え（rename）: git の rename（類似度 90% 以上）の旧→新が 1対1 のときだけ、head の行のパスを新→旧に戻して比べる。
  行の中身（trim 後）が完全に同じ行だけが付け替えとみなされ、中身が違えば戻した後も base に無いので増えた行＝人。1対1でない rename は使わない。"""
from __future__ import annotations

import fnmatch
import json
import subprocess
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, FrozenSet, Iterable, List, Mapping, Optional, Sequence, Tuple

Json = Dict[str, object]
Row = Tuple[str, Tuple[str, ...]]  # (パス, 残りの中身)。パスだけが rename で付け替わる


class Unreadable(ValueError):
    """許可リストの形が表と違う・読めない（人へ回す理由の文を持つ）"""


@dataclass
class Direction:
    excused: FrozenSet[str]  # 向きが A で人へ回さなくてよいパス
    human: List[str]  # 人へ回す理由（C、または判定できない物）
    record: Json = field(default_factory=dict)  # 台帳へ残す（向き・通した理由）


# ---------- 許可リストの形ごとの行の取り出し ----------

def _str(v: object, what: str) -> str:
    if not isinstance(v, str):
        raise Unreadable(f"{what} が文字列でない")
    return v


WS = " \t\r\n"


def _trim(s: str) -> str:
    """ASCII の空白（space・tab・CR・LF）だけ削る。検査側（JS の String.trim）は Unicode の空白（NBSP・VT・FF 等）も削るので、Python の strip() とは集合が違う。
    ここで削らない文字は行の中身として残り、head と base で違えば増えた行＝人（止める側に倒れる）"""
    return s.strip(WS)


def _entries(doc: Json, keys: Sequence[str]) -> List[Json]:
    ents = doc.get("entries")
    if not isinstance(ents, list):
        raise Unreadable("entries が配列でない")
    allowed = set(keys) | {"reason"}
    for e in ents:
        if not isinstance(e, dict) or set(e) - allowed:
            raise Unreadable(f"entries の要素の欄が表と違う（{sorted(set(e) - allowed)[:3] if isinstance(e, dict) else '辞書でない'}）")
    return ents  # type: ignore[return-value]


def rows_actionlint(doc: Json) -> Counter:
    return Counter((_str(e.get("file"), "file"), (_str(e.get("rule"), "rule"), _trim(_str(e.get("line"), "line")))) for e in _entries(doc, ("file", "rule", "line")))


def rows_css(doc: Json) -> Counter:
    out: Counter = Counter()
    seen: set = set()
    for e in _entries(doc, ("class", "files")):
        files = e.get("files")
        if not isinstance(files, list):
            raise Unreadable("files が配列でない")
        cls = _str(e.get("class"), "class")
        if cls in seen:  # 検査（verify-css-class-collisions.js）は new Map(class → Set(files)) で同じ class の重複を後勝ちにする。多重集合の比べ方と合わない
            raise Unreadable(f"同じ class のエントリが重複（検査は後勝ち）: {cls[:60]}")
        seen.add(cls)
        for f in set(_str(x, "files の要素") for x in files):  # 検査は Set(files) なので同じファイルの重複は1つ
            out[(f, (cls,))] += 1
    return out


def rows_code(doc: Json) -> Counter:
    return Counter((_str(e.get("file"), "file"), (_trim(_str(e.get("code"), "code")),)) for e in _entries(doc, ("file", "code")))


def rows_kyotei(doc: Json) -> Counter:
    return Counter((_str(e.get("file"), "file"), (_trim(_str(e.get("line"), "line")),)) for e in _entries(doc, ("file", "line")))


def rows_no_undef(doc: Json) -> Counter:
    rules = doc.get("rules")
    if not isinstance(rules, dict):
        raise Unreadable("rules が辞書でない")
    out: Counter = Counter()
    for rule, files in rules.items():
        if not isinstance(files, dict):
            raise Unreadable(f"rules.{rule} が辞書でない")
        for f, ent in files.items():
            if not isinstance(ent, dict) or set(ent) - {"names", "count", "reason"}:
                raise Unreadable(f"rules.{rule}.{f} の欄が表と違う")
            names, count = ent.get("names"), ent.get("count")
            if names is not None:
                if not isinstance(names, list):
                    raise Unreadable(f"rules.{rule}.{f}.names が配列でない")
                for n in names:
                    out[(f, (rule, "name", _str(n, "names の要素")))] += 1
            if count is not None:
                if not isinstance(count, int) or isinstance(count, bool) or count < 0:
                    raise Unreadable(f"rules.{rule}.{f}.count が0以上の整数でない")
                for i in range(count):
                    out[(f, (rule, "count", str(i)))] += 1  # 件数 N は単位 N 個。減るだけが部分集合
    return out


M = "scripts/maintenance/"
PARSERS: Dict[str, Callable[[Json], Counter]] = {
    M + "actionlint-allowlist.json": rows_actionlint,
    M + "css-class-collisions-allowlist.json": rows_css,
    M + "e2e-no-unroute-allowlist.json": rows_code,
    M + "verify-e2e-recorded-network-allowlist.json": rows_code,
    M + "kyotei-wording-allowlist.json": rows_kyotei,
    M + "verify-no-undef-allowlist.json": rows_no_undef,
}


ROW_KEY: Dict[str, str] = {M + "verify-no-undef-allowlist.json": "rules"}  # 行を読む最上位のキー。ほかは entries


def _skeleton(doc: Json, path: str) -> Json:
    """行・理由・$comment を除いた残り（その型が読むキーだけを除く。読まないキーが entries や rules の名前でも骨格に残る）。ここが変わる変更は向きを言えないので人"""
    row_key = ROW_KEY.get(path, "entries")
    return {k: v for k, v in doc.items() if k not in ("$comment", row_key)}


def _load(text: Optional[str], what: str) -> Json:
    if text is None:
        raise Unreadable(f"{what} が無い")
    try:
        doc = json.loads(text)
    except ValueError as e:
        raise Unreadable(f"{what} の JSON が読めない（{str(e)[:80]}）") from None
    if not isinstance(doc, dict):
        raise Unreadable(f"{what} が JSON の辞書でない")
    return doc


# ---------- 型 ----------

def _glob(pat: str, path: str) -> bool:
    a, b = pat.split("/"), path.split("/")
    return len(a) == len(b) and all(fnmatch.fnmatchcase(y, x) for x, y in zip(a, b))


def data_paths(types: Mapping[str, object], paths: Iterable[str]) -> FrozenSet[str]:
    """config の型（guard_direction.types）に当たり、かつ PARSERS に行の取り出し方がある完全パス。表に無い許可リストは含めない（＝従来どおり人）"""
    globs = [str(g) for v in types.values() for g in (v if isinstance(v, list) else [])]  # type: ignore[union-attr]
    return frozenset(p for p in paths if p in PARSERS and any(_glob(g, p) for g in globs))


# ---------- 判定（純関数） ----------

def one_to_one(renames: Sequence[Tuple[str, str]]) -> Dict[str, str]:
    """rename の旧→新のうち 1対1 の物だけ（旧か新が2回以上出る対は全部捨てる）。返す: {新: 旧}"""
    olds, news = Counter(o for o, _ in renames), Counter(n for _, n in renames)
    return {n: o for o, n in renames if olds[o] == 1 and news[n] == 1 and o != n}


def judge_path(path: str, status: str, base_text: Optional[str], head_text: Optional[str], inv: Mapping[str, str]) -> Tuple[bool, str, Json]:
    """1パスの向き。(A か, 理由, 記録)。inv は {新: 旧}"""
    parse = PARSERS.get(path)
    if parse is None:
        return False, f"{path}: 許可リストの形の表に無い（人）", {}
    if status != "M":
        return False, f"{path}: 許可リストそのものの追加・削除（{status}）は向きを言えない（人）", {}
    try:
        bd, hd = _load(base_text, "base の版"), _load(head_text, "head の版")
        b_rows, h_rows = parse(bd), parse(hd)
    except Unreadable as e:
        return False, f"{path}: 読めない・形が表と違う: {e}（人）", {}
    if _skeleton(bd, path) != _skeleton(hd, path):
        return False, f"{path}: 行・理由・$comment 以外の欄が変わっている（人）", {}
    back: Counter = Counter()
    relabeled = 0
    for (p, rest), n in h_rows.items():
        o = inv.get(p, p)
        relabeled += n if o != p else 0
        back[(o, rest)] += n
    extra = back - b_rows
    if extra:
        sample = "・".join(f"{p} {'|'.join(r)[:60]}" for (p, r) in sorted(extra)[:3])
        return False, f"C 弱める: {path} の行が増える（{sum(extra.values())} 行。付け替え（rename の1対1・中身が同じ）で説明できない: {sample}）", {"added": sum(extra.values())}
    removed = sum((b_rows - back).values())
    return True, "", {"direction": "A", "removed": removed, "relabeled": relabeled}


def judge(changes: Mapping[str, str], base_text: Callable[[str], Optional[str]], head_text: Callable[[str], Optional[str]],
          renames: Sequence[Tuple[str, str]], types: Mapping[str, object]) -> Direction:
    """changes: {パス: A|M|D}（base との差）。型に当たる許可リストだけを見る（ほかは触らない）。renames: git の rename の (旧, 新)"""
    inv = one_to_one(renames)
    excused: set = set()
    human: List[str] = []
    per: Json = {}
    for p in sorted(data_paths(types, changes)):
        ok, why, rec = judge_path(p, changes[p], base_text(p), head_text(p), inv)
        per[p] = {"pass": ok, **rec}
        if ok:
            excused.add(p)
        else:
            human.append(why)
    return Direction(frozenset(excused), human, {"paths": per, "rename_pairs": len(inv)} if per else {})


def valid_for_head(record: Mapping[str, object], head: str) -> bool:
    """判定は head の SHA に結び付く。記録の head が今の head と違えば使わない（判定し直すか人へ。マージ側が使う）"""
    return bool(record.get("head")) and record.get("head") == head


def static_only(human: Sequence[str], record: Mapping[str, object]) -> bool:
    """verify_guard の人行きが全部 static_problems（新しい verify の書き方の誤り）か。そうなら人でなく作り手の書き直しに返す。
    変異検査・通らない・node_modules が無い等が1つでも混じれば False（弱める疑いは人）"""
    st = record.get("static")
    return bool(human) and isinstance(st, list) and set(human) <= {str(x) for x in st}


# ---------- git の読み（呼び出し側の便。読むだけ） ----------

def git_renames(repo: Path, base: str, similarity: int = 90) -> List[Tuple[str, str]]:
    """base と HEAD の分かれ目から HEAD への rename（類似度 similarity% 以上）の (旧, 新)"""
    r = subprocess.run(["git", "-c", "core.quotepath=false", "diff", "--name-status", f"-M{similarity}%", "--diff-filter=R", f"{base}...HEAD"],
                       cwd=repo, capture_output=True, text=True, check=True)
    out: List[Tuple[str, str]] = []
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[0].startswith("R"):
            out.append((parts[1], parts[2]))
    return out


def judge_worktree(repo: Path, base: str, types: Mapping[str, object], similarity: int = 90) -> Direction:
    """repo の HEAD（commit 済み）を base（例 origin/master）と比べる。head の SHA を記録に書く（判定は head に結び付く）"""
    def show(ref: str) -> Callable[[str], Optional[str]]:
        def f(p: str) -> Optional[str]:
            r = subprocess.run(["git", "show", f"{ref}:{p}"], cwd=repo, capture_output=True, text=True)
            return r.stdout if r.returncode == 0 else None
        return f
    ns = subprocess.run(["git", "diff", "--name-status", "--no-renames", f"{base}...HEAD"], cwd=repo, capture_output=True, text=True, check=True)
    changes: Dict[str, str] = {}
    for ln in ns.stdout.splitlines():
        st, _, p = ln.partition("\t")
        if p:
            changes[p] = st[:1]
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    # base 側は分かれ目の版（merge-base）。素の base だと、後から master が変えた許可リストを枝の変更に数える
    mb = subprocess.run(["git", "merge-base", base, "HEAD"], cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
    d = judge(changes, show(mb), show("HEAD"), git_renames(repo, base, similarity), types)
    d.record["head"] = head
    return d
