#!/usr/bin/env python3
"""守りを弱める変更を CI で止める判定（BOA-1477、.github/workflows/guard-weakening.yml から呼ぶ）。標準ライブラリだけ。
HEAD（commit 済みの作業場所）を --base（PR の base の SHA）との分かれ目（merge-base）と比べ、次の3つを当てる。どれかが赤なら終了コード 1。
  1. e2e の spec の比較（spec_guard.py。この写しで新しく書いた物）
  2. 許可リストの向き（guard_direction.py。hq の scripts/guard_direction.py の写し）。行が減る・1対1 の付け替えだけなら通す。
     scripts/maintenance/*-allowlist.json のうち形の表（PARSERS）に無い物の変更は向きを言えないので赤
  3. verify の変異検査（verify_guard.py。hq の scripts/verify_guard.py の写し）。verify-*.js か verify-registry.json の変更があるときだけ。
     registry への行の追加は、同じ PR で新しく足した verify-*.js の行だけ通す
判定器が読めない・例外のときは赤（握りつぶさない）。理由は1行ずつ出す（GitHub Actions では ::error:: の注記も付ける）。
verify の実行の囲い（sandbox-exec）は macOS だけにある。GitHub Actions の上（GITHUB_ACTIONS=true）では囲いなしで回す:
  その job は使い捨ての VM・権限は contents: read・secrets を渡さない・checkout の資格を残さないので、囲いが守る物（手元の鍵・ネット）が無い。
  それ以外の Linux 等の手元では囲いが無いので verify の判定は赤（止める側）。
使い方: python3 scripts/maintenance/guard_weakening/run.py --base <SHA か ref> [--repo .]"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import guard_direction as gd  # noqa: E402
import spec_guard as sg  # noqa: E402
import verify_guard as vg  # noqa: E402

TYPES: Mapping[str, object] = {"allowlist": ["scripts/maintenance/*-allowlist.json"]}  # hq の config/maker-dispatch.json の guard_direction.types と同じ
RENAME_SIMILARITY = 90  # hq の guard_direction.rename_similarity と同じ
VERIFY_CFG: Dict[str, object] = {"max_mutants_per_verify": 40, "run_timeout_sec": 120}  # hq の config/maker-dispatch.json の verify_guard と同じ（node_modules は作業場所の物）


def git(repo: Path, *args: str) -> str:
    r = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=repo, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args[:3])} が失敗（{r.stderr.strip()[:200]}）")
    return r.stdout


def show(repo: Path, ref: str) -> Callable[[str], Optional[str]]:
    def f(p: str) -> Optional[str]:
        r = subprocess.run(["git", "show", f"{ref}:{p}"], cwd=repo, capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None
    return f


def numstat(repo: Path, mb: str) -> Dict[str, Tuple[int, int]]:
    out: Dict[str, Tuple[int, int]] = {}
    for ln in git(repo, "diff", "--numstat", "--no-renames", mb, "HEAD").splitlines():
        a, d, p = (ln.split("\t") + ["", "", ""])[:3]
        if p and a.isdigit() and d.isdigit():
            out[p] = (int(a), int(d))
    return out


def unknown_allowlists(changes: Mapping[str, str]) -> List[str]:
    """型（*-allowlist.json）に当たるのに形の表に無い許可リストの変更。guard_direction.data_paths は表に無い物を外す（hq では人へ回る）ので、CI では赤にする"""
    globs = [str(g) for v in TYPES.values() for g in (v if isinstance(v, list) else [])]
    return [f"ALLOW {p}: 許可リストの形の表（guard_direction.PARSERS）に無く、向きを言えない" for p in sorted(changes)
            if p not in gd.PARSERS and any(gd._glob(g, p) for g in globs)]


def registry_additions_problems(changes: Mapping[str, str], base_text: Callable[[str], Optional[str]], head_text: Callable[[str], Optional[str]]) -> List[str]:
    """registry に足した行は、同じ差分で新しく足した verify-*.js の物だけ許す（BOA-1477 の受け入れ）"""
    if vg.REGISTRY not in changes or changes[vg.REGISTRY] != "M":
        return []
    added, _, why = vg.registry_diff(base_text(vg.REGISTRY), head_text(vg.REGISTRY))
    if why:
        return []  # 形の理由は verify_guard.evaluate が出す
    return [f"VERIFY {vg.REGISTRY}: 新しく足した verify が無いのに行を足した: {r}" for r in added if changes.get(f"scripts/maintenance/{r}") != "A"]


def sandbox_mode() -> Tuple[bool, Optional[str]]:
    """(囲いを使うか, 回せない理由)"""
    if vg.sandbox_available():
        return True, None
    if os.environ.get("GITHUB_ACTIONS") == "true":
        return False, None
    return True, f"{vg.SANDBOX_EXEC} が無く、GitHub Actions の上でもないので verify を囲いなしでは回さない"


def evaluate(repo: Path, base: str) -> Tuple[List[str], List[str], Dict[str, object]]:
    """(赤の理由, 警告, 記録)"""
    repo = repo.resolve()
    mb = git(repo, "merge-base", base, "HEAD").strip()
    changes = vg.name_status(repo, mb)
    base_text, head_text = show(repo, mb), show(repo, "HEAD")
    errors: List[str] = []
    record: Dict[str, object] = {"merge_base": mb, "head": git(repo, "rev-parse", "HEAD").strip(), "changed": len(changes)}

    sv = sg.judge(changes, base_text, head_text, numstat(repo, mb))
    errors += sv.errors
    warnings = list(sv.warnings)

    d = gd.judge(changes, base_text, head_text, gd.git_renames(repo, mb, RENAME_SIMILARITY), TYPES)
    errors += [f"ALLOW {h}" for h in d.human] + unknown_allowlists(changes)
    record["allowlist"] = d.record

    if any(vg.is_verify_path(p) for p in changes) or vg.REGISTRY in changes:
        use_sb, why = sandbox_mode()
        if why:
            errors.append(f"VERIFY {why}")
        else:
            v = vg.evaluate(repo, changes, base_text, {**VERIFY_CFG, "sandbox": use_sb})
            errors += [f"VERIFY {h}" for h in v.human] + registry_additions_problems(changes, base_text, head_text)
            record["verify"] = {"excused": sorted(v.excused), **v.record}
    return errors, warnings, record


def main(argv: Sequence[str]) -> int:
    ap = argparse.ArgumentParser(description="守りを弱める変更の判定（BOA-1477）")
    ap.add_argument("--base", required=True, help="PR の base の SHA か ref")
    ap.add_argument("--repo", default=".")
    a = ap.parse_args(argv)
    gha = os.environ.get("GITHUB_ACTIONS") == "true"
    try:
        errors, warnings, record = evaluate(Path(a.repo), a.base)
    except Exception as e:  # 判定できないまま通さない
        errors, warnings, record = [f"判定器が例外で止まった（{type(e).__name__}: {str(e)[:300]}）"], [], {}
    for w in warnings:
        print(f"::warning::{w}" if gha else f"警告 {w}")
    for e in errors:
        print(f"::error::{e}" if gha else f"赤 {e}")
    print(json.dumps({"result": "red" if errors else "green", "errors": len(errors), "warnings": len(warnings), **record}, ensure_ascii=False, default=str))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
