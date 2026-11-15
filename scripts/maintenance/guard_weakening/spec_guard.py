#!/usr/bin/env python3
"""e2e の spec を base 版と head 版で比べ、守りを弱める変更を見つける判定（BOA-1477 の1つ目）。標準ライブラリだけ。判定は純関数。

差分に出た spec を合わせて見る（分割・付け替えで別の spec へ移った試験名・expect は減りに数えない）:
  赤 ① 試験名（test・it・describe の title）が消える（多重集合で base − head が空でない。名前の付け替えも消えた扱い）
  赤 ② expect の数が減る（expect( ・expect.soft( ・expect.poll( の呼び出しの数）
  赤 ③ skip・fixme・only が増える（test.skip( ・test.describe.only( 等の種類ごとの数）
  赤 ④ spec の削除（中の試験名が他の spec へ移っていない物）・読めない（文字列やコメントが閉じない）
  警告 ⑤ 削除行が多い（削除 >= DELETE_WARN_MIN かつ 削除 > 追加 × DELETE_WARN_RATIO。目安・根拠なし。赤にしない）
JS の構文木は作らない。コメントだけ消し（文字列・テンプレート・正規表現の中は残す）、呼び出しの形を正規表現で数える。
数え方は base と head に同じく当たるので、書き方の揺れは差に出にくい。読み切れない物は止める側（赤）。"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple

SPEC_RE = re.compile(r"e2e/.+\.spec\.[cm]?[jt]sx?")
E2E_CODE_RE = re.compile(r"e2e/.+\.[cm]?[jt]sx?")  # spec でない e2e の補助（fixtures・helpers）。expect・skip の数だけ合わせて見る
DELETE_WARN_MIN = 20  # 目安（根拠なし）
DELETE_WARN_RATIO = 2.0  # 目安（根拠なし）


class Unreadable(ValueError):
    """spec の字句を読み切れない"""


@dataclass(frozen=True)
class Facts:
    titles: Counter  # (種類, title) の多重集合。種類は test か describe
    expects: int
    markers: Counter  # skip・fixme・only の数


@dataclass
class SpecVerdict:
    errors: List[str] = field(default_factory=list)  # 赤の理由（1行ずつ）
    warnings: List[str] = field(default_factory=list)


def is_spec(path: str) -> bool:
    return bool(SPEC_RE.fullmatch(path))


# 正規表現の literal が始まり得る直前の字（これ以外の後の / は割り算）
_REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_PREV_WORDS = ("return", "typeof", "case", "do", "else", "in", "of", "void", "yield", "await")


def _blank(t: str) -> str:
    """文字列・正規表現の literal の中身を空白に（両端の字と改行は残す）"""
    return t[0] + re.sub(r"[^\n]", " ", t[1:-1]) + t[-1] if len(t) >= 2 else t


def strip_comments(src: str, blank: bool = False) -> str:
    """// と /* */ のコメントを空白に置き換える（改行は残す）。文字列・テンプレート・正規表現の中は触らない
    （blank=True なら中身も空白にする。文字列の中の 'expect(' 等で数を水増しさせない）。閉じない物は Unreadable"""
    out: List[str] = []
    i, n = 0, len(src)
    last = ""  # 直前の空白でない字（コメントの前の字）
    while i < n:
        ch = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if ch == "/" and nxt == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append(" " * (j - i))
            i = j
            continue
        if ch == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            if j < 0:
                raise Unreadable("/* のコメントが閉じない")
            out.append(re.sub(r"[^\n]", " ", src[i:j + 2]))
            i = j + 2
            continue
        if ch in "'\"`":
            j = _end_of_string(src, i)
            out.append(_blank(src[i:j]) if blank else src[i:j])
            last = ch
            i = j
            continue
        if ch == "/" and _regex_starts(last, src[max(0, i - 16):i]):
            j = _end_of_regex(src, i)
            out.append(_blank(src[i:j]) if blank else src[i:j])
            last = "/"
            i = j
            continue
        out.append(ch)
        if not ch.isspace():
            last = ch
        i += 1
    return "".join(out)


def _end_of_string(src: str, i: int) -> int:
    q, j, n = src[i], i + 1, len(src)
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == q:
            return j + 1
        if c == "\n" and q != "`":
            raise Unreadable(f"文字列 {q} が行の中で閉じない")
        j += 1
    raise Unreadable(f"文字列 {q} が閉じない")


def _regex_starts(last: str, before: str) -> bool:
    if last == "" or last in _REGEX_PREV:
        return True
    m = re.search(r"([A-Za-z_$][\w$]*)\s*$", before)
    return bool(m) and m.group(1) in _REGEX_PREV_WORDS


def _end_of_regex(src: str, i: int) -> int:
    j, n, in_class = i + 1, len(src), False
    while j < n:
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if c == "\n":
            raise Unreadable("正規表現が行の中で閉じない")
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            j += 1
            while j < n and (src[j].isalpha()):
                j += 1
            return j
        j += 1
    raise Unreadable("正規表現が閉じない")


_CALLEE = r"(?<![\w$.])(test|it|describe)((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\("
CALL_RE = re.compile(_CALLEE)
TITLE_RE = re.compile(r"\s*(['\"`])((?:\\.|(?!\1)[^\\])*)\1", re.S)
EXPECT_RE = re.compile(r"(?<![\w$.])expect(?:\s*\.\s*(?:soft|poll))?\s*\(")
NOT_TITLE = frozenset({"step", "use", "extend", "beforeEach", "afterEach", "beforeAll", "afterAll", "configure", "info", "setTimeout", "slow", "fail", "each"})
MARKERS = ("skip", "fixme", "only", "fail")
# 呼び出しの形の skip 等。test.skip・describe.only・testInfo.skip・test.info().skip・test.fail のどれも（受け手を問わない）
MARK_RE = re.compile(r"\.\s*(skip|fixme|only|fail)\s*\(")
# expect(...) の後に付く比べ（.toBe( ・.not.toBe( ・.resolves.toBe( 等）。比べの無い expect(x) は数えない
MATCHER_RE = re.compile(r"\s*(?:\.\s*(?:not|resolves|rejects)\s*)*\.\s*to[A-Z]\w*\s*\(")


def _close_paren(code: str, open_at: int) -> int:
    """code[open_at] が ( のとき対の ) の次の位置。閉じなければ -1（文字列・コメントは空白にしてある前提）"""
    depth = 0
    for k in range(open_at, len(code)):
        c = code[k]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                return k + 1
    return -1


def count_expects(blanked: str) -> int:
    n = 0
    for m in EXPECT_RE.finditer(blanked):
        end = _close_paren(blanked, m.end() - 1)
        if end > 0 and MATCHER_RE.match(blanked, end):
            n += 1
    return n


def is_e2e_code(path: str) -> bool:
    return bool(E2E_CODE_RE.fullmatch(path))


def facts(src: str) -> Facts:
    """1本の spec の数え上げ。試験名はコメントを除いた本文、expect・skip 等は文字列の中身も空白にした本文で数える"""
    code = strip_comments(src)
    blanked = strip_comments(src, blank=True)
    titles: Counter = Counter()
    markers: Counter = Counter()
    for m in CALL_RE.finditer(code):
        head, chain = m.group(1), [x.strip() for x in m.group(2).split(".") if x.strip()]
        if any(x in NOT_TITLE for x in chain):
            continue
        t = TITLE_RE.match(code, m.end())
        if not t:
            continue  # test.skip(cond, "理由") の形（中で使う skip）。名前ではない。skip の数には入れた
        if _no_body(chain, code, t.end()):
            continue
        kind = "describe" if head == "describe" or "describe" in chain else "test"
        titles[(kind, t.group(2))] += 1
    for m in MARK_RE.finditer(blanked):
        markers[m.group(1)] += 1
    return Facts(titles, count_expects(blanked), markers)


def _no_body(chain: Sequence[str], code: str, after_title: int) -> bool:
    """skip・fixme の呼び出しで、文字列の後に本体（関数）が続かない物（中で使う skip の形）は試験名に数えない"""
    if not any(x in ("skip", "fixme") for x in chain):
        return False
    rest = code[after_title:after_title + 200]
    return not re.match(r"\s*,\s*(?:async\b|\(|function\b|\{|[A-Za-z_$][\w$]*\s*=>)", rest)


def judge(changes: Mapping[str, str], base_text: Callable[[str], Optional[str]], head_text: Callable[[str], Optional[str]],
          numstat: Mapping[str, Tuple[int, int]]) -> SpecVerdict:
    """changes: {パス: A|M|D}（--no-renames の差）。numstat: {パス: (追加, 削除)}。
    差分に出た spec 全部（足した・変えた・消した）を1つに合わせて比べる。試験名・expect が別の spec へ移っただけ（分割・付け替え）は減りに数えない。
    spec の新規の追加だけの差分は何も減らないので緑。赤の理由には、減った物がどの spec から来たかを付ける"""
    v = SpecVerdict()
    specs = sorted(x for x in changes if is_e2e_code(x))  # spec と補助。試験名は spec だけ（補助に test( は無い前提）
    if not specs:
        return v
    base: Dict[str, Facts] = {}
    head: Dict[str, Facts] = {}
    for p in specs:
        st = changes[p]
        try:
            if st in ("M", "D"):
                t = base_text(p)
                if t is None:
                    raise Unreadable("base の版が読めない")
                base[p] = facts(t)
            if st in ("M", "A"):
                t = head_text(p)
                if t is None:
                    raise Unreadable("head の版が読めない")
                head[p] = facts(t)
        except Unreadable as e:
            v.errors.append(f"SPEC {p}: 読めない（{e}）")
    if v.errors:
        return v
    b_titles = sum((f.titles for f in base.values()), Counter())
    h_titles = sum((f.titles for f in head.values()), Counter())
    gone = b_titles - h_titles
    for p in sorted(base):
        mine = Counter({k: n for k, n in gone.items() if k in base[p].titles})
        if mine:
            how = "spec を消した" if changes[p] == "D" else "試験名が消えた"
            sample = "・".join(f"{k}「{t[:50]}」" for (k, t) in sorted(mine)[:3])
            v.errors.append(f"SPEC {p}: {how}（{sum(mine.values())} 件: {sample}）")
            gone -= mine
    # 新しく足した spec で試験名が base と重ならない物（fresh）は、skip を数えないので expect の合計にも入れない
    # （今ある spec の expect を消し、skip した新しい spec で数を埋める抜け道を塞ぐ、ops 審査 11/12 P0-3）
    fresh = {p for p in head if changes[p] == "A" and head[p].titles and not (head[p].titles & b_titles)}  # 試験名の無い補助は外す（補助の skip は今ある試験に効きうる）
    b_exp, h_exp = sum(f.expects for f in base.values()), sum(f.expects for p, f in head.items() if p not in fresh)
    if h_exp < b_exp:
        per = "・".join(f"{p} {base[p].expects if p in base else 0}→{head[p].expects if p in head else 0}" for p in specs
                        if (base[p].expects if p in base else 0) != (head[p].expects if p in head else 0))
        v.errors.append(f"SPEC expect が減った（変えた spec の合計 {b_exp} → {h_exp}: {per[:300]}）")
    # 新しく足した spec で、試験名が base のどれとも重ならない物（中身が全部新しい試験）の skip・fixme・fail は、今ある試験を弱めないので数えない
    # （HR34 #2508: 新しい e2e-release の spec の test.skip(鍵が無い手元)）。試験を移して skip を付けた物は名前が重なるので数える。only は全体を絞るので常に数える
    for mk in MARKERS:
        b_n = sum(f.markers[mk] for f in base.values())
        h_n = sum(f.markers[mk] for p, f in head.items() if mk == "only" or p not in fresh)
        if mk != "only" and any(head[p].markers[mk] for p in fresh):
            v.warnings.append(f"SPEC {'・'.join(p for p in sorted(fresh) if head[p].markers[mk])[:200]}: 新しい spec に {mk} がある（今ある試験は弱めないので赤にしない）")
        if h_n > b_n:
            where = "・".join(p for p in specs if (head[p].markers[mk] if p in head else 0) > (base[p].markers[mk] if p in base else 0))
            v.errors.append(f"SPEC {where[:200]}: {mk} が増えた（変えた spec の合計 {b_n} → {h_n}）")
    for p in specs:
        add, dele = numstat.get(p, (0, 0))
        if changes[p] == "M" and dele >= DELETE_WARN_MIN and dele > add * DELETE_WARN_RATIO:
            v.warnings.append(f"SPEC {p}: 削除行が多い（追加 {add}・削除 {dele}。目安で警告だけ）")
    return v
