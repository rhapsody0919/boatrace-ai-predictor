#!/usr/bin/env python3
"""hq の scripts/mut_lock.py（Mac の変異のロック。同時に回す変異の本数と負荷を道具で絞る）の代わり。この写しだけのファイル。
verify_guard.py（hq の写し。本文は1字も変えない）が `import mut_lock as ml` して `ml.held(名)`・`ml.Busy` を使うので、同じ名前で置く。
- GitHub Actions の上（使い捨ての VM）: 何も取らない
- 手元: ~/hq/scripts/mut_lock.py が在ればそれでロックを取る（hq の決まりと同じ本数・負荷の線）。無ければ何も取らない
判定には関わらない（取れなければ verify_guard が「変異のロックを取れない」で赤にする＝止める側）。標準ライブラリだけ。"""
import contextlib
import importlib.util
import os
from pathlib import Path
from typing import Iterator, Optional

HQ_LOCK = Path.home() / "hq" / "scripts" / "mut_lock.py"


class Busy(Exception):
    """ロックが全部使われている・負荷が線の上・待つ上限を越えた（hq の mut_lock.Busy を包む）"""


def _hq():  # type: ignore[no-untyped-def]
    if os.environ.get("GITHUB_ACTIONS") == "true" or not HQ_LOCK.is_file():
        return None
    spec = importlib.util.spec_from_file_location("hq_mut_lock", HQ_LOCK)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@contextlib.contextmanager
def held(who: str) -> Iterator[Optional[Path]]:
    hq = _hq()
    if hq is None:
        yield None
        return
    try:
        cm = hq.held(who)
        got = cm.__enter__()
    except hq.Busy as e:
        raise Busy(str(e)) from e
    try:
        yield got
    finally:
        cm.__exit__(None, None, None)
