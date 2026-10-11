"""BOA-271 学習結果の書き込み（PostgREST、service key）

train.py の出力（out/train_meta.json・profiles.json）を analogy_models・analogy_contribution_profiles
に書き、activate_analogy_model で表示に使う版を1トランザクションで入れ替える（マイグレーション 118）。

- 同じ版が is_active なら書かずに失敗する（表示中の版を消さない）。is_active でない同じ版
  （前回の途中で止まった実行の残り）は消してから書き直す
- 寄与度の行が0件、または書いた件数とテーブルの件数が合わなければ失敗する（切り替えない）
- 切り替えの後、寄与度の行は今回の版と、切り替える直前に表示していた版（ロールバック先）だけ残す。
  途中で失敗して表示されなかった版の行は消す。analogy_models の行は消さない
- 書き込みの途中で失敗したら、今回の版の行を消してから失敗させる（表示は前の版のまま）
- 切り替える前に、全体（全会場・全グレード・全ラウンド・全艇）のシェアが前の版からどれだけ動いたかを
  out/drift.json に書く。どれかのテーマが DRIFT_THRESHOLD 以上動いたら、ワークフローが Slack に知らせる
  （止めはしない。データやコードの変化で寄与度の見え方が大きく変わったことに気づくため）

使い方: python db.py write
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import features as F

# 学習の出力先（train.OUT と同じ）。日次の特徴量ジョブも使うので、train（lightgbm）を読み込まない
OUT = F.D / "out"

BATCH = 1000
DRIFT_THRESHOLD = 0.03


def _overall(rows: list[dict]) -> dict[tuple[str, int], dict]:
    # stage が無い行（132 の前に書いた版）は展示後
    return {(r.get("stage", "exhibition"), r["finish_target"]): r["shares"] for r in rows
            if (r["venue_code"], r["grade"], r["round"], r["boat_number"]) == (0, "all", "all", 0)}


def share_drift(prev_rows: list[dict], new_rows: list[dict], threshold: float = DRIFT_THRESHOLD,
                previous_version: str | None = None) -> dict:
    """前の版と今回の版で、段×着順ごとの全体のシェアがテーマ別にどれだけ動いたか。
    前の版に無いテーマ（後から足したテーマ）は0から動いたとみなす。前の版に無い段は比べない。"""
    prev, new = _overall(prev_rows), _overall(new_rows)
    changes = []
    for (stage, ft), shares in sorted(new.items()):
        if (stage, ft) not in prev:
            continue
        old = prev[(stage, ft)]
        deltas = {k: shares.get(k, 0.0) - old.get(k, 0.0) for k in set(shares) | set(old)}
        theme = max(deltas, key=lambda k: abs(deltas[k]))
        changes.append({"stage": stage, "finish_target": ft, "theme": theme,
                        "max_abs_change": abs(deltas[theme]), "deltas": deltas})
    return {"flagged": any(c["max_abs_change"] >= threshold for c in changes),
            "changes": changes, "previous": previous_version}


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
    # NaN・Inf は JSON に無いので、送る前に止める（PostgREST の「Empty or invalid json」は原因が分からない）
    try:
        data = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
    except ValueError as e:
        raise PostgrestError(f"{method} {path}: 送る値に NaN・Inf がある（{e}）") from e
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

    previous, _ = request("GET", "analogy_models?select=model_version&is_active=is.true")
    previous_active = previous[0]["model_version"] if previous else None
    prev_rows = []
    if previous_active:
        prev_rows, _ = request("GET", "analogy_contribution_profiles?select=stage,finish_target,venue_code,"
                               "grade,round,boat_number,shares"
                               f"&model_version=eq.{q(previous_active)}&venue_code=eq.0&grade=eq.all"
                               "&round=eq.all&boat_number=eq.0")
    drift = share_drift(prev_rows, profiles, previous_version=previous_active)
    (OUT / "drift.json").write_text(json.dumps(drift, ensure_ascii=False, indent=1))
    if drift["changes"]:
        print(f"  前の版 {previous_active} からのシェアの最大の変化: "
              + ", ".join(f"{c['stage']} finish_target={c['finish_target']} {c['theme']} "
                          f"{c['max_abs_change']:.3f}"
                          for c in drift["changes"]))
    try:
        _insert(version, meta, profiles)
    except Exception:
        # 表示されていない今回の版を残さない（次の版の prune でロールバック先を押し出さないため）
        request("DELETE", f"analogy_models?model_version=eq.{q(version)}")
        raise
    request("POST", "rpc/activate_analogy_model", {"p_model_version": version})
    active, _ = request("GET", "analogy_models?select=model_version&is_active=is.true")
    if [a["model_version"] for a in active] != [version]:
        raise PostgrestError(f"切り替えの確認に失敗: is_active = {active}")
    print(f"  表示に使う版を {version} に切り替えた")
    (OUT / "activated.json").write_text(json.dumps({"model_version": version}))
    prune(previous_active)


def _insert(version: str, meta: dict, profiles: list) -> None:
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


def profile_versions_to_delete(models: list[dict], previous_active: str | None) -> list[str]:
    """寄与度の行を消す版。残すのは表示中の版と、切り替える直前に表示していた版だけ。
    models は trained_at の新しい順。"""
    keep = {m["model_version"] for m in models if m["is_active"]} | {previous_active}
    return [m["model_version"] for m in models if m["model_version"] not in keep]


def prune(previous_active: str | None) -> None:
    models, _ = request("GET", "analogy_models?select=model_version,trained_at,is_active"
                        "&order=trained_at.desc")
    old = profile_versions_to_delete(models, previous_active)
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
