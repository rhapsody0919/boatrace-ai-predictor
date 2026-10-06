"""BOA-271 寄与度用モデルの学習・品質ゲート・寄与度プロファイル（AIの見立て、spec FR-E）

艇単位の LightGBM（二値）を、展示後の3本（1着・2着以内・3着以内）と、直前情報8列を使わない出走表時点の
3本（win_racecard・top2_racecard・top3_racecard）学習し、SHAP（pred_contrib）をテーマに集計して
寄与度プロファイルを作る（profiles.py。段 stage=exhibition・racecard）。Phase M（phase-m-result.md）の F5 と
同じ設定を本番化した。

時系列の分け方（版ごとに同じ規則）:
  test  = データの最終日から遡る12か月。品質ゲートの評価と、寄与度の集計（spec「直近12か月」）に使う
  train = それより前（2019-04〜）。末尾3か月は温度合わせにだけ使い、学習には入れない
  寄与度は表示に使うモデルが学習していない期間で数える（Phase M の F5 と同じく、すべて標本外）

木の数は固定（Phase M の F4・F5 の best_iteration から決めた値。early stopping で版ごとに揺らさない）。
シェアの SD は、seed を変えた再学習と、日単位のブートストラップの両方の揺れを合わせる（profiles.py）。

出走表時点の3本は展示前の AIの見立て（profiles の stage=racecard）に使う（事前登録5 追記B・C）。
展示後の段の特徴量の一致検査（treeshap-parity.js）のため、win・win_racecard の JSON ダンプ・メタ・固定データを
perrace.py が書く（2本のまま）。

品質ゲート（MD-7）: 6本のそれぞれで
  (1) 基準（1着は会場×1号艇の級別の過去の1着艇分布、2・3着以内は会場×1号艇の級別×艇番の過去の率）に、
      レース単位のペア差の日クラスタ・ブートストラップ95%CI で有意に勝つ
  (2) 固定した参照版（reference.json。storage.js download-reference が out/reference/ に置く）を同じ test で
      評価し直し、対数損失が許容幅（1着 0.005・2/3着以内は艇あたり 0.002）以上悪化しない
直前の版と比べると、許容幅の中の小さな悪化が週ごとに積み重なっても止まらないので、比較の相手は
固定する（データサイエンス体制のレビュー、2026-10-02）。参照版を更新するのは人の判断で reference.json を
書き換えたときだけ。満たさなければ何も書かずに exit 1。参照版に出走表時点のモデルが無い間は、その比較だけを
「比較なし」と記録して飛ばす（それ以外のモデルが参照版に無いのは異常として止める）。

再現のため、メトリクスに学習したコードのコミット（GITHUB_SHA）と、書き出したデータの件数・最大値・
内容のハッシュ（export_manifest.json）を残す。

使い方: python train.py [--train-only | --profiles-only]   （features.py の後）
  --train-only    学習・品質ゲート・seed の再学習まで（モデルと train_meta を書く。profiles は作らない）
  --profiles-only out/ の train_meta とモデル（seed ごと）から profiles だけ作る（学習しない）
  引数なしは両方
出力: data/ml/analogy/out/model_{win,top2,top3,win_racecard,top2_racecard,top3_racecard}.txt と
      その seed 1〜 の model_{名前}_seed{seed}.txt・train_meta.json・model_win.json・model_win_racecard.json
      ・per_race_meta.json・parity_fixture.json・perrace_record.json（--train-only）、
      profiles.json・profiles_record.json（--profiles-only）
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

import features as F
import metrics as M
import perrace as P
from profiles import nonfinite_to_null, slice_profiles
from themes import CATEGORICAL, FEATURES, RACECARD_FEATURES, THEMES, themes_for_db

OUT = F.D / "out"
REFERENCE_DIR = OUT / "reference"

TEST_MONTHS = 12
TEMPERATURE_MONTHS = 3
# 手元の動作確認では ANALOGY_SEEDS=2 等で減らせる（本番は5回。spec FR-1「安定性」と同じ回数）
SEEDS = list(range(int(os.environ.get("ANALOGY_SEEDS", "5"))))
# 参照版からの悪化の許容幅。1着はレースあたりの6クラス対数損失、2・3着以内は艇あたりの二値対数損失
GATE_MAX_DEGRADATION = {"win": 0.005, "top2": 0.002, "top3": 0.002, "win_racecard": 0.005,
                        "top2_racecard": 0.002, "top3_racecard": 0.002}
TARGET_LABEL = {"win": "1着", "top2": "2着以内", "top3": "3着以内", "win_racecard": "1着（出走表時点）",
                "top2_racecard": "2着以内（出走表時点）", "top3_racecard": "3着以内（出走表時点）"}
# 参照版に無くても止めないモデル（この版で足したもの。参照版を更新するまでは比較を飛ばす）
OPTIONAL_REFERENCE = {"win_racecard", "top2_racecard", "top3_racecard"}
# 参照版の学習の終わりから、今回の学習の終わりまでがこの日数を過ぎたら、更新を促す（参照版は見ていない
# データが増えるほど評価が自然に悪くなり、「参照版より悪化しない」が実質緩むため）
REFERENCE_MAX_AGE_DAYS = 183
# 日単位のブートストラップの回数（シェアの SD）
N_BOOT = int(os.environ.get("ANALOGY_N_BOOT", "100"))
PARAMS = dict(objective="binary", learning_rate=0.08, num_leaves=31, min_data_in_leaf=500,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              verbosity=-1, num_threads=int(os.environ.get("ANALOGY_THREADS", "0")) or None)
# name, ラベル列, finish_target, 木の数（Phase M の best_iteration: 1着 F4 194/F5 313、
# 2着以内 290/223、3着以内 367/294 の間で丸めた）
TARGETS = [("win", "y_win", 1, 250), ("top2", "y_top2", 2, 250), ("top3", "y_top3", 3, 330)]
# 出走表時点のモデル（直前情報8列を使わない。事前登録5 追記B）。name, ラベル列, finish_target, 木の数（展示後と同じ）
RACECARD = [("win_racecard", "y_win", 1, 250), ("top2_racecard", "y_top2", 2, 250),
            ("top3_racecard", "y_top3", 3, 330)]
GATE_ORDER = ["win", "top2", "top3", "win_racecard", "top2_racecard", "top3_racecard"]
# 学習に使う train のレースの割合。Phase M はマシン負荷のため0.35で検証した（spec MD-1 の妥協点）
TRAIN_FRAC = float(os.environ.get("ANALOGY_TRAIN_FRAC", "1.0"))


def _is_win(name: str) -> bool:
    return name in ("win", "win_racecard")


def _model_logloss(name: str, m: dict) -> float:
    return m["logloss_model"] if _is_win(name) else m["logloss_per_boat_model"]


def _vs_baseline_ci(name: str, m: dict) -> list[float]:
    key = ("paired_logloss_model_minus_baseline" if _is_win(name)
           else "paired_race_logloss_model_minus_baseline")
    return m[key]["ci95"]


def quality_gate(metrics: dict, reference: dict | None) -> dict:
    """metrics: {win, top2, top3[, *_racecard]} の評価。reference: 参照版を同じ test で評価し直した対数損失
    {version, win, top2, top3[, *_racecard]}（無ければ None＝初回）。参照版に出走表時点のモデルが無い
    （値が None）ときは、その比較だけを「比較なし」として飛ばし、警告に入れる。"""
    names = [n for n in GATE_ORDER if n in metrics]
    reasons = []
    for name in names:
        ci_hi = _vs_baseline_ci(name, metrics[name])[1]
        if not ci_hi < 0:
            reasons.append(f"{TARGET_LABEL[name]}: 基準に有意に勝っていない（対数損失の差の95%CI上限 {ci_hi:+.5f}）")
    ref_result = "none"
    warnings = []
    if reference is not None and reference.get("age_days", 0) > REFERENCE_MAX_AGE_DAYS:
        warnings.append(f"参照版 {reference['version']} は学習の終わりから {reference['age_days']} 日経っている。"
                        f"{REFERENCE_MAX_AGE_DAYS} 日を過ぎたので reference.json の更新を検討する")
    if reference is not None:
        ref_result = {"version": reference["version"], "age_days": reference.get("age_days"),
                      "deltas": {}}
        for name in names:
            if reference.get(name) is None and name in OPTIONAL_REFERENCE:
                ref_result["deltas"][name] = None
                warnings.append(f"{TARGET_LABEL[name]}: 参照版 {reference['version']} にモデルが無いので比較なし。"
                                "このモデルを含む版を参照版にするときは reference.json を更新する")
                continue
            if reference.get(name) is None:
                raise RuntimeError(f"参照版 {reference['version']} に {name} の評価がありません（比較を黙って省かない）")
            delta = _model_logloss(name, metrics[name]) - reference[name]
            ref_result["deltas"][name] = delta
            if delta >= GATE_MAX_DEGRADATION[name]:
                reasons.append(f"{TARGET_LABEL[name]}: 参照版 {reference['version']} より対数損失が "
                               f"{delta:+.5f} 悪化（許容 {GATE_MAX_DEGRADATION[name]}）")
    return {"passed": not reasons, "reasons": reasons, "reference": ref_result, "warnings": warnings}


def split(df: pd.DataFrame):
    end = df["race_date"].max()
    test_from = end - pd.DateOffset(months=TEST_MONTHS) + pd.Timedelta(days=1)
    train = df[df["race_date"] < test_from]
    test = df[df["race_date"] >= test_from]
    temp_from = test_from - pd.DateOffset(months=TEMPERATURE_MONTHS)
    fit, temp = train[train["race_date"] < temp_from], train[train["race_date"] >= temp_from]
    if TRAIN_FRAC < 1:
        ids = fit["race_id"].unique()
        keep = np.random.default_rng(0).choice(ids, int(len(ids) * TRAIN_FRAC), replace=False)
        fit = fit[fit["race_id"].isin(keep)]
    return train, fit, temp, test


def fit_model(fit: pd.DataFrame, label: str, rounds: int, seed: int,
              features: list[str] = FEATURES) -> lgb.Booster:
    params = {k: v for k, v in {**PARAMS, "seed": seed}.items() if v is not None}
    cats = [c for c in CATEGORICAL if c in features]
    data = lgb.Dataset(fit[features].astype("float32"), fit[label], categorical_feature=cats,
                       free_raw_data=True)
    return lgb.train(params, data, rounds)


def raw(m: lgb.Booster, df: pd.DataFrame) -> np.ndarray:
    return m.predict(df[m.feature_name()].astype("float32"), raw_score=True)


def evaluate_win_races(m, train, temp, test) -> tuple[dict, np.ndarray]:
    """1着の評価と、レース単位の対数損失（展示の効果の記録で2本のモデルのペア差に使う）。"""
    t = M.fit_temperature(raw(m, temp).reshape(-1, 6), M.winner_index(temp))
    y = M.winner_index(test)
    p = M.softmax_rows(raw(m, test).reshape(-1, 6), t)
    pb = M.baseline_winner(train, test)
    ll, llb = M.per_race_logloss(p, y), M.per_race_logloss(pb, y)
    days = test.loc[test["boat_number"] == 1, "race_date"].to_numpy()
    return ({"temperature": t, "logloss_model": float(ll.mean()), "logloss_baseline": float(llb.mean()),
             "top1_acc_model": float((p.argmax(1) == y).mean()),
             "paired_logloss_model_minus_baseline": M.paired_ci(ll - llb, days)}, ll)


def evaluate_win(m, train, temp, test) -> dict:
    return evaluate_win_races(m, train, temp, test)[0]


def evaluate_topk(m, train, test, label) -> dict:
    return evaluate_topk_races(m, train, test, label)[0]


def evaluate_topk_races(m, train, test, label) -> tuple[dict, np.ndarray]:
    """2・3着以内の評価と、レース単位の対数損失（6艇の2値の対数損失の和。展示の効果のペア差に使う）。"""
    y = test[label].to_numpy()
    p = 1 / (1 + np.exp(-raw(m, test)))
    pb = M.baseline_topk(train, test, label)
    ll = M.binary_ll(p, y).reshape(-1, 6).sum(1)
    llb = M.binary_ll(pb, y).reshape(-1, 6).sum(1)
    days = test.loc[test["boat_number"] == 1, "race_date"].to_numpy()
    return ({"logloss_per_boat_model": float(ll.mean() / 6),
             "logloss_per_boat_baseline": float(llb.mean() / 6),
             "paired_race_logloss_model_minus_baseline": M.paired_ci(ll - llb, days)}, ll)


def reference_age_days(ref_fit_end, current_fit_end) -> int:
    """参照版がどれだけ古いか: 参照版の学習期間の終わりから、今回の学習期間の終わりまでの日数。
    以前は今回の test の最終日までで測っていたので、test（12か月）と温度合わせ（3か月）の分、同じ週に学習した
    版でも約456日になり、REFERENCE_MAX_AGE_DAYS を必ず超えて毎週警告が出ていた（版 2026-10-06 の学習で判明）"""
    return int((pd.Timestamp(current_fit_end) - pd.Timestamp(ref_fit_end)).days)


def reference_logloss(train: pd.DataFrame, temp: pd.DataFrame, test: pd.DataFrame) -> dict | None:
    """参照版のモデルを、今回と同じ test で評価し直す。参照版が決まっていなければ None（初回）。
    決まっているのにモデルが無いのは異常（比較を黙って省かない）なので失敗させる。"""
    ref_file = Path(__file__).with_name("reference.json")
    version = json.loads(ref_file.read_text()).get("model_version") if ref_file.exists() else None
    if not version:
        return None
    out = {"version": version}
    meta_path = REFERENCE_DIR / "train_meta.json"
    if meta_path.exists():
        ref_fit_end = json.loads(meta_path.read_text())["metrics"]["periods"]["fit"][1]
        # 今回の学習期間の終わり＝温度合わせの期間の前日（split の規則）
        out["age_days"] = reference_age_days(ref_fit_end, temp["race_date"].min() - pd.Timedelta(days=1))
    for name, label, _, _ in TARGETS + RACECARD:
        path = REFERENCE_DIR / f"model_{name}.txt"
        if not path.exists() and name in OPTIONAL_REFERENCE:
            out[name] = None
            continue
        if not path.exists():
            raise RuntimeError(f"参照版 {version} のモデル {path.name} がありません（storage.js download-reference）")
        m = lgb.Booster(model_file=str(path))
        missing = [f for f in m.feature_name() if f not in test.columns]
        if missing:
            raise RuntimeError(f"参照版のモデルが使う特徴量がデータにありません: {missing}")
        ev = evaluate_win(m, train, temp, test) if _is_win(name) else evaluate_topk(m, train, test, label)
        out[name] = _model_logloss(name, ev)
    return out


def code_and_data_provenance() -> dict:
    """版を後から再現するための記録: 学習したコードのコミットと、書き出したデータの要約。"""
    manifest = F.D / "export_manifest.json"
    summary = F.D / "dataset_summary.json"
    return {
        "code_sha": os.environ.get("GITHUB_SHA"),
        "export": json.loads(manifest.read_text()) if manifest.exists() else None,
        "dataset": ({k: v for k, v in json.loads(summary.read_text()).items()
                     if k != "races_ok_by_month"} if summary.exists() else None),
    }


def profile_keys(test: pd.DataFrame) -> pd.DataFrame:
    k = test[["race_id", "race_date", "venue_code", "boat_number", "grade", "round"]].copy()
    k["venue_code"] = k["venue_code"].astype(int)
    k["boat_number"] = k["boat_number"].astype(int)
    for c in ("grade", "round"):
        k[c] = k[c].astype(object).where(k[c].notna(), np.nan)
    return k


RACECARD_NAMES = {n for n, _, _, _ in RACECARD}
# 事前登録5 追記C の記録2（段ごとの profiles の分布）。profiles の段で書く
PROFILES_RECORD = "profiles_record.json"


def with_round_v1(df: pd.DataFrame) -> pd.DataFrame:
    """ラウンドの区分を判定 v2 の前の定義に戻した入力（参照版の評価し直しの記録用）。"""
    return df.assign(round_code=df["round_code_v1"])


def round_change_record(fit: pd.DataFrame, temp: pd.DataFrame, test: pd.DataFrame) -> dict:
    """事前登録5 追記C の記録6: 判定 v2 でラウンドが変わったレース数（期間・長期/本体別、旧→新）。"""
    out = {}
    for name, d in (("fit", fit), ("temperature", temp), ("test", test)):
        first = d[d["boat_number"] == 1]
        for part, sel in (("kb", first["race_date"] <= F.KB_END), ("main", first["race_date"] > F.KB_END)):
            f = first[sel]
            old = f["round_code_v1"].map(dict(enumerate(F.ROUNDS))).fillna("none")
            new = f["round_code"].map(dict(enumerate(F.ROUNDS))).fillna("none")
            ch = old != new
            out[f"{name}|{part}"] = {
                "n_races": int(len(f)), "n_changed": int(ch.sum()),
                "by_change": {f"{a}->{b}": int(c) for (a, b), c in
                              pd.DataFrame({"a": old[ch], "b": new[ch]}).value_counts().items()}}
    return out


def _features_for(name: str) -> list[str]:
    return RACECARD_FEATURES if name in RACECARD_NAMES else FEATURES


def write_perrace(version, fit, temp, test, models: dict, race_ll: dict) -> dict:
    """展示後の段の一致検査用の書き出しと、事前登録5 の記録（perrace.py）。記録の全体は perrace_record.json
    （Storage にも置く）に書き、analogy_models.metrics には展示の効果の要約だけを入れる（metrics は画面の
    読み込みでも取られるため小さく保つ）。JSON ダンプ・固定データは win・win_racecard の2本（追記C）。
    記録2（段ごとの profiles の分布）は profiles の段で profiles_record.json に書く。"""
    m_win, m_rc = models["win"], models["win_racecard"]
    dumps = {"win": P.model_dump(m_win, OUT / "model_win.json"),
             "win_racecard": P.model_dump(m_rc, OUT / "model_win_racecard.json")}
    maps = json.loads((F.D / "categorical_maps.json").read_text())
    meta = P.per_race_meta(version, (m_win, dumps["win"]), (m_rc, dumps["win_racecard"]), maps)
    (OUT / "per_race_meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    cond_raw, exh_raw = P.read_raw(F.D, "conditions"), P.read_raw(F.D, "exhibition")
    ids = P.select_parity_races(test, cond_raw)
    fixture = P.parity_fixture(version, test, ids, cond_raw, exh_raw,
                               {"win": m_win, "win_racecard": m_rc})
    (OUT / "parity_fixture.json").write_text(json.dumps(fixture, ensure_ascii=False))
    # 展示の効果（記録1、追記B の記録1）: 出走表時点 − 展示後 のレース単位の対数損失
    effect = {post: P.exhibition_effect(race_ll[post], race_ll[f"{post}_racecard"], test)
              for post in ("win", "top2", "top3")}
    rec = {
        "model_version": version,
        "exhibition_effect": effect,
        # 記録5・追記B の記録3: ファイルに書くのは2本だけなので、racecard の3本はメモリ上のダンプで数える
        "missing_types": {n: P.missing_types(dumps[n] if n in dumps else models[n].dump_model())
                          for n in ("win", "win_racecard", "top2_racecard", "top3_racecard")},
        "fit_nan_rates": P.nan_rates(fit, FEATURES),
        "parity_fixture_races": len(ids),
        "definitions": P.definition_record(cond_raw, pd.read_csv(F.D / "race_series.csv"), maps),
        "round_v2_changes": round_change_record(fit, temp, test),
    }
    (OUT / "perrace_record.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    print(f"  perrace: {json.dumps(rec['exhibition_effect'], ensure_ascii=False)[:400]}", flush=True)
    return {"exhibition_effect": effect, "parity_fixture_races": len(ids),
            "record_file": "perrace_record.json", "profiles_record_file": PROFILES_RECORD}


def seed_model_file(name: str, seed: int) -> str:
    return f"model_{name}.txt" if seed == SEEDS[0] else f"model_{name}_seed{seed}.txt"


def load_data(end: str | None = None):
    """end: この日までのデータで分ける（profiles だけ後日やり直すとき、学習した回と同じ test にするため）"""
    df = F.complete_races(pd.read_pickle(F.D / "boats.pkl"))
    if end is not None:
        df = df[df["race_date"] <= pd.Timestamp(end)]
    return split(df)


def train_phase() -> dict:
    """学習・品質ゲート・seed を変えた再学習。モデル（seed ごと）・train_meta・一致検査の固定データを out/ に書く。
    profiles はここでは作らない（profiles_phase）。モデルを先に Storage に置けば、profiles の計算と書き込みだけを
    やり直せる（train-analogy.yml の profiles_only_version）"""
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    train, fit, temp, test = load_data()
    jst = timezone(timedelta(hours=9))
    version = os.environ.get("ANALOGY_MODEL_VERSION") or datetime.now(jst).strftime("%Y-%m-%d")
    n = lambda d: int(d["race_id"].nunique())  # noqa: E731
    print(f"version {version}  fit {n(fit):,}R  temperature {n(temp):,}R  test {n(test):,}R "
          f"({test['race_date'].min().date()}〜{test['race_date'].max().date()})", flush=True)

    metrics, models, race_ll = {}, {}, {}
    # 先に seed0 の6本を学習・評価して品質ゲートを通す（通らなければ seed の再学習をせずに止める）
    for name, label, _, rounds in TARGETS + RACECARD:
        m = fit_model(fit, label, rounds, SEEDS[0], _features_for(name))
        if _is_win(name):
            metrics[name], race_ll[name] = evaluate_win_races(m, train, temp, test)
        else:
            metrics[name], race_ll[name] = evaluate_topk_races(m, train, test, label)
        m.save_model(str(OUT / seed_model_file(name, SEEDS[0])))
        models[name] = m
        print(f"  {name}: {json.dumps(metrics[name], ensure_ascii=False)[:300]}", flush=True)
    gate = quality_gate(metrics, reference_logloss(train, temp, test))
    # 事前登録5 追記C の記録4: 参照版を、学習したときと同じ（v2 の前の）ラウンドの定義で評価し直した値も併記する
    # （v2 の入力を渡すと参照版が不利になり、判定2が甘くなる側に偏るため。判定には使わない）
    ref_v1 = reference_logloss(*(with_round_v1(d) for d in (train, temp, test)))
    gate["reference_round_v1"] = ref_v1 and {k: v for k, v in ref_v1.items() if k != "age_days"}
    metrics["gate"] = gate
    print(f"  gate: {json.dumps(gate, ensure_ascii=False)}", flush=True)
    if not gate["passed"]:
        (OUT / "gate_failed.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=1))
        sys.exit("品質ゲートで止めた: " + " / ".join(gate["reasons"]))

    # share_sd の seed の揺れに使う再学習（seed 0 以外）。ファイルに書き、profiles の段で読む
    seed_files = []
    for name, label, _, rounds in TARGETS + RACECARD:
        for seed in SEEDS[1:]:
            fit_model(fit, label, rounds, seed, _features_for(name)).save_model(
                str(OUT / seed_model_file(name, seed)))
            seed_files.append(seed_model_file(name, seed))
            print(f"    {name} seed {seed} ({time.time() - t0:.0f}s)", flush=True)

    perrace_metrics = write_perrace(version, fit, temp, test, models, race_ll)
    meta = {
        "model_version": version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "features": FEATURES,
        "themes": themes_for_db(),
        "targets": [{"name": n_, "finish_target": ft, "rounds": r} for n_, _, ft, r in TARGETS],
        "racecard": [{"name": n_, "finish_target": ft, "rounds": r, "features": RACECARD_FEATURES,
                      "seed": SEEDS[0]} for n_, _, ft, r in RACECARD],
        "seed_model_files": seed_files,
        "metrics": {**metrics, "perrace": perrace_metrics, "seeds": SEEDS, "n_boot": N_BOOT, "train_frac": TRAIN_FRAC,
                    "provenance": code_and_data_provenance(),
                    "periods": {"fit": [str(fit["race_date"].min().date()), str(fit["race_date"].max().date())],
                                "temperature": [str(temp["race_date"].min().date()),
                                                str(temp["race_date"].max().date())],
                                "test": [str(test["race_date"].min().date()), str(test["race_date"].max().date())]},
                    "n_races": {"fit": n(fit), "temperature": n(temp), "test": n(test)}},
    }
    # allow_nan=False: NaN を素のまま書くと PostgREST が拒むので、学習の出力の時点で止める（db.py も同じ）
    (OUT / "train_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1, allow_nan=False))
    print(f"train done ({time.time() - t0:.0f}s)")
    return meta


def profiles_phase() -> list[dict]:
    """out/ の train_meta.json と seed ごとのモデルから profiles を作る（学習はしない）。
    seed・ブートストラップの回数は train_meta の値を使う（学習した回と同じ集計にするため）"""
    t0 = time.time()
    meta = json.loads((OUT / "train_meta.json").read_text())
    seeds, n_boot = meta["metrics"]["seeds"], meta["metrics"]["n_boot"]
    period = meta["metrics"]["periods"]["test"]
    _, _, _, test = load_data(end=period[1])
    got = [str(test["race_date"].min().date()), str(test["race_date"].max().date())]
    if got != period:
        raise RuntimeError(f"test の期間が学習した回と違う（学習 {period}、今回 {got}）。データの書き出しを確かめる")
    # 後日やり直すと、最終日（学習した時点では途中だった日）のレースが増えていることがある。止めずに記録する
    n_test = {"trained": meta["metrics"]["n_races"]["test"], "profiles": int(test["race_id"].nunique())}
    if n_test["trained"] != n_test["profiles"]:
        print(f"  注意: test のレース数が学習した回と違う（{n_test}）。最終日 {period[1]} のレースが後から増えた分",
              flush=True)
    keys = profile_keys(test)
    profiles, report = [], {"undefined_cells": 0}
    for stage, specs in (("exhibition", TARGETS), ("racecard", RACECARD)):
        for name, _, finish_target, _ in specs:
            feats = _features_for(name)
            contribs = []
            for seed in seeds:
                file = f"model_{name}.txt" if seed == seeds[0] else f"model_{name}_seed{seed}.txt"
                m = lgb.Booster(model_file=str(OUT / file))
                if m.feature_name() != feats:
                    raise RuntimeError(f"{file} の特徴量が今のコードと違う")
                contribs.append(m.predict(test[feats].astype("float32"), pred_contrib=True)
                                .astype("float32"))
            profiles += slice_profiles(keys, contribs, feats, THEMES, finish_target, n_boot=n_boot,
                                       stage=stage, values=test, report=report)
            print(f"    profiles {name} ({time.time() - t0:.0f}s)", flush=True)
    profiles, nulled = nonfinite_to_null(profiles)
    print(f"  1レースだけで割合が決まらず書かなかったセル: {report['undefined_cells']:,}"
          f"  有限でない値を null にした場所: {json.dumps(nulled, ensure_ascii=False)}", flush=True)
    rec = {"model_version": meta["model_version"], "test_n_races": n_test,
           "undefined_cells": report["undefined_cells"],
           "nonfinite_to_null": nulled, "profiles_by_stage": P.stage_profile_record(profiles)}
    (OUT / PROFILES_RECORD).write_text(json.dumps(rec, ensure_ascii=False, indent=1, allow_nan=False))
    (OUT / "profiles.json").write_text(json.dumps(profiles, ensure_ascii=False, allow_nan=False))
    print(f"profiles done: {len(profiles):,} セル ({time.time() - t0:.0f}s)")
    return profiles


def main():
    args = sys.argv[1:]
    if args not in ([], ["--train-only"], ["--profiles-only"]):
        sys.exit("使い方: python train.py [--train-only | --profiles-only]")
    if args != ["--profiles-only"]:
        train_phase()
    if args != ["--train-only"]:
        profiles_phase()


if __name__ == "__main__":
    main()
