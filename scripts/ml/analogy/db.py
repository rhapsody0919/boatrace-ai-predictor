"""BOA-271 学習結果の書き込み（PostgREST、service key）

train.py の出力（out/train_meta.json・profiles.json）を analogy_models・analogy_contribution_profiles
に書き、activate_analogy_model で表示に使う版を1トランザクションで入れ替える（マイグレーション 118）。

- 同じ版が is_active なら書かずに失敗する（表示中の版を消さない）。is_active でない同じ版
  （前回の途中で止まった実行の残り）は消してから書き直す
- 寄与度の行が0件、または書いた件数とテーブルの件数が合わなければ失敗する（切り替えない）
- 切り替えの後、寄与度の行は直近2版（今回と前回）だけ残す。analogy_models の行は消さない

使い方: python db.py write
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from train import OUT

BATCH = 1000
KEEP_PROFILE_VERSIONS = 2


class PostgrestError(RuntimeError):
    pass


def _env() -> tuple[str, str]:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise PostgrestError("SUPABASE_URL・SUPABASE_SERVICE_KEY が未設定")
    return url.rstrip("/"), key


def request(method: str, path: str, body=None, prefer: str | None = None):
    url, key = _env()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
            return (json.loads(raw) if raw else None), res.headers
    except urllib.error.HTTPError as e:
        raise PostgrestError(f"{method} {path}: HTTP {e.code} {e.read().decode(errors='replace')[:500]}") from e


def q(v: str) -> str:
    return urllib.parse.quote(v, safe="")


def count_profiles(version: str) -> int:
    _, h = request("HEAD", f"analogy_contribution_profiles?model_version=eq.{q(version)}",
                   prefer="count=exact")
    return int(h["Content-Range"].split("/")[-1])


def write() -> None:
    meta = json.loads((OUT / "train_meta.json").read_text())
    profiles = json.loads((OUT / "profiles.json").read_text())
    version = meta["model_version"]
    if not profiles:
        raise PostgrestError("寄与度の行が0件（train.py の出力を確認）")

    existing, _ = request("GET", f"analogy_models?select=model_version,is_active&model_version=eq.{q(version)}")
    if existing:
        if existing[0]["is_active"]:
            raise PostgrestError(f"版 {version} は表示中のため書き直さない（ANALOGY_MODEL_VERSION で別の版名にする）")
        request("DELETE", f"analogy_models?model_version=eq.{q(version)}")
        print(f"  前回の途中で残った版 {version}（is_active でない）を消した")

    request("POST", "analogy_models", {
        "model_version": version, "trained_at": meta["trained_at"],
        "feature_columns": meta["features"], "themes": meta["themes"],
        "metrics": meta["metrics"], "is_active": False,
    }, prefer="return=minimal")
    rows = [{**p, "model_version": version} for p in profiles]
    for i in range(0, len(rows), BATCH):
        request("POST", "analogy_contribution_profiles", rows[i:i + BATCH], prefer="return=minimal")
    written = count_profiles(version)
    if written != len(rows):
        raise PostgrestError(f"寄与度の行数が合わない（書いた {len(rows):,} / テーブル {written:,}）")
    print(f"  analogy_contribution_profiles {written:,} 行")

    request("POST", "rpc/activate_analogy_model", {"p_model_version": version})
    active, _ = request("GET", "analogy_models?select=model_version&is_active=is.true")
    if [a["model_version"] for a in active] != [version]:
        raise PostgrestError(f"切り替えの確認に失敗: is_active = {active}")
    print(f"  表示に使う版を {version} に切り替えた")
    prune()


def prune() -> None:
    models, _ = request("GET", "analogy_models?select=model_version&order=trained_at.desc")
    old = [m["model_version"] for m in models[KEEP_PROFILE_VERSIONS:]]
    for v in old:
        request("DELETE", f"analogy_contribution_profiles?model_version=eq.{q(v)}")
    if old:
        print(f"  古い版の寄与度の行を消した: {', '.join(old)}")


def main():
    if sys.argv[1:] != ["write"]:
        sys.exit("使い方: python db.py write")
    try:
        write()
    except PostgrestError as e:
        sys.exit(f"書き込み失敗: {e}")


if __name__ == "__main__":
    main()
