"""BOA-271 env-check: 「レース全体で同じ値の材料」（天候・水面／グレード・ラウンド・節）が、艇ごとに意味のある向きを持つか

- モデル: 版 2026-10-02 の model_win・top2・top3（展示あり）。pred_contrib は shap_check.py が書いた work/contrib_*.npy（test.pkl の行順）
- 母集団: test（2025-10-03〜2026-10-02 の完全レース）から、穴の月 2025-12・2026-01 を除いたもの（calc2 の excl_hole_months と同じ）
- テーマの値: 艇ごとに、テーマ内の特徴量の SHAP を符号つきで足し、レース内で中心化（6艇の平均を引く）した値（log-odds）
  - 天候・水面（weatherWater）= weather_code・wind_x・wind_y・wind_speed・wave_height
  - グレード・ラウンド・節（raceFormat）= grade_code・round_code・series_day・is_final_day_num
- 艇ごとの合計 = 全特徴量の中心化 SHAP の和（＝その艇の生スコア − 6艇の平均）
- 帯: 風速 0〜1／2〜3／4〜5／6m以上／欠損、波高 0〜2／3〜5／6cm以上／欠損、グレード ippan/G3/G2/G1/SG/不明、
  ラウンド yosen/junyu/yusho/other/不明
- 95%区間: 日単位のブートストラップ 200回（同じ日のレースをまとめて復元抽出、seed 0）の 2.5/97.5 パーセンタイル
- 大きさ: ratio_abs_mean = |テーマの値の平均| ÷ |艇ごとの合計| の平均、ratio_mean_abs = |テーマの値| の平均 ÷ |艇ごとの合計| の平均
- 安定性: seed を変えた再学習の版は Storage に無い（版 2026-10-02 は seed 0 のモデルだけを置き、seed 1〜4 は学習中に
  寄与度プロファイルの SD を取るためだけに作って保存していない）ので、日単位のブートストラップの区間だけ

出力: env-check.json・env-check.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "code-at-train"))
from calc1_race import THEMES7  # noqa: E402

VERSION = "2026-10-02"
HOLES = ["2025-12", "2026-01"]
N_BOOT = 200
THEMES = {t["key"]: t for t in THEMES7 if t["key"] in ("weatherWater", "raceFormat")}
MODELS = {"win": "1着", "top2": "2着以内", "top3": "3着以内"}


def wind_band(ws):
    return np.select([~np.isfinite(ws), ws <= 1, ws <= 3, ws <= 5], ["欠損", "0〜1m", "2〜3m", "4〜5m"], "6m以上")


def wave_band(w):
    return np.select([~np.isfinite(w), w <= 2, w <= 5], ["欠損", "0〜2cm", "3〜5cm"], "6cm以上")


def main():
    W = HERE / "work"
    test = pd.read_pickle(W / "test.pkl")
    n = len(test) // 6
    first = test[test["boat_number"] == 1].reset_index(drop=True)
    month = first["race_date"].dt.strftime("%Y-%m").to_numpy()
    keep = ~np.isin(month, HOLES)
    days, day_code = np.unique(first["race_date"].to_numpy(), return_inverse=True)
    rng = np.random.default_rng(0)
    Wb = rng.multinomial(len(days), np.full(len(days), 1 / len(days)), size=N_BOOT).astype("float64")
    bands = {
        "wind_speed": wind_band(first["wind_speed"].to_numpy().astype(float)),
        "wave_height": wave_band(first["wave_height"].to_numpy().astype(float)),
        "grade": first["grade"].astype(object).where(first["grade"].notna(), "不明").to_numpy(),
        "round": first["round"].astype(object).where(first["round"].notna(), "不明").to_numpy(),
    }
    band_order = {"wind_speed": ["0〜1m", "2〜3m", "4〜5m", "6m以上", "欠損"],
                  "wave_height": ["0〜2cm", "3〜5cm", "6cm以上", "欠損"],
                  "grade": ["ippan", "G3", "G2", "G1", "SG", "不明"],
                  "round": ["yosen", "junyu", "yusho", "other", "不明"]}
    theme_for_band = {"wind_speed": "weatherWater", "wave_height": "weatherWater", "grade": "raceFormat",
                      "round": "raceFormat"}
    out = {"model_version": VERSION, "population": {"test_period": [str(first["race_date"].min().date()),
                                                                    str(first["race_date"].max().date())],
                                                    "excluded_months": HOLES, "n_races": int(keep.sum()),
                                                    "n_days": int(len(np.unique(day_code[keep])))},
           "n_boot": N_BOOT, "definition": __doc__, "themes": {k: [g["key"] for g in t["groups"]] for k, t in THEMES.items()},
           "seed_variants": None,
           "seed_note": "seed を変えた再学習の版は Storage に無い（analogy/2026-10-02/ は model_win・top2・top3・train_meta だけ）。"
                        "日単位のブートストラップの区間だけを出した",
           "models": {}}
    for mk in MODELS:
        m = lgb.Booster(model_file=str(HERE / "models" / VERSION / f"model_{mk}.txt"))
        names = m.feature_name()
        idx = {f: i for i, f in enumerate(names)}
        c = np.load(W / f"contrib_{mk}.npy")[:, :-1].astype("float64").reshape(n, 6, len(names))
        c = c - c.mean(axis=1, keepdims=True)
        total = c.sum(axis=2)  # (n, 6)
        tv = {k: c[:, :, [idx[f] for g in t["groups"] for f in g["features"]]].sum(axis=2) for k, t in THEMES.items()}
        res = {}
        for bk, b in bands.items():
            tk = theme_for_band[bk]
            v = tv[tk]
            rows = []
            for lab in band_order[bk]:
                mask = keep & (b == lab)
                nr = int(mask.sum())
                if nr == 0:
                    rows.append({"band": lab, "n_races": 0})
                    continue
                s = np.zeros((len(days), 6))
                np.add.at(s, day_code[mask], v[mask])
                cnt = np.bincount(day_code[mask], minlength=len(days)).astype(float)
                mean = s.sum(0) / cnt.sum()
                with np.errstate(invalid="ignore", divide="ignore"):
                    bm = (Wb @ s) / (Wb @ cnt)[:, None]
                bm = bm[np.isfinite(bm).all(1)]
                lo, hi = np.percentile(bm, 2.5, axis=0), np.percentile(bm, 97.5, axis=0)
                abs_total = np.abs(total[mask]).mean(0)
                rows.append({
                    "band": lab, "n_races": nr, "n_days": int(len(np.unique(day_code[mask]))),
                    "mean": [float(x) for x in mean], "ci95": [[float(a), float(b_)] for a, b_ in zip(lo, hi)],
                    "ci_excludes_0": [bool(a > 0 or b_ < 0) for a, b_ in zip(lo, hi)],
                    "mean_abs_theme": [float(x) for x in np.abs(v[mask]).mean(0)],
                    "mean_abs_total": [float(x) for x in abs_total],
                    "ratio_abs_mean": [float(abs(a) / t) for a, t in zip(mean, abs_total)],
                    "ratio_mean_abs": [float(a / t) for a, t in zip(np.abs(v[mask]).mean(0), abs_total)],
                })
            res[bk] = {"theme": tk, "rows": rows}
        # 全体（帯に分けない）での大きさ
        allm = keep
        overall = {tk: {"mean": [float(x) for x in tv[tk][allm].mean(0)],
                        "mean_abs_theme": [float(x) for x in np.abs(tv[tk][allm]).mean(0)],
                        "mean_abs_total": [float(x) for x in np.abs(total[allm]).mean(0)],
                        "ratio_mean_abs": [float(a / t) for a, t in zip(np.abs(tv[tk][allm]).mean(0),
                                                                        np.abs(total[allm]).mean(0))]}
                   for tk in THEMES}
        out["models"][mk] = {"label": MODELS[mk], "by_band": res, "overall": overall}
    # 例のレース（calc1.json の themes7）
    c1 = json.loads((W / "calc1.json").read_text())
    rr = json.loads((W / "race_result.json").read_text())
    cond = rr["conditions"][0]
    q = test[test["race_id"] == 202609272012].sort_values("boat_number")
    ex = {"race_id": c1["race_id"], "conditions": {
        "weather": cond["weather"], "wind": f"{cond['wind_direction']} {cond['wind_speed']}m", "wave_cm": cond["wave_height"],
        "grade": rr["races"][0]["race_grade"], "stage": cond["race_stage"], "series_day": cond["series_day"],
        "is_final_day": cond["is_final_day"],
        "features_used": {"weather_code": float(q["weather_code"].iloc[0]), "wind_x": float(q["wind_x"].iloc[0]),
                          "wind_y": float(q["wind_y"].iloc[0]), "wind_speed": float(q["wind_speed"].iloc[0]),
                          "wave_height": float(q["wave_height"].iloc[0]), "grade_code": float(q["grade_code"].iloc[0]),
                          "round_code": float(q["round_code"].iloc[0]), "series_day": float(q["series_day"].iloc[0]),
                          "is_final_day_num": float(q["is_final_day_num"].iloc[0])},
        "bands": {"wind_speed": "0〜1m", "wave_height": "0〜2cm", "grade": "G1", "round": "yusho"}},
        "models": {}}
    for mk in MODELS:
        boats = c1["models"][mk]["themes7"]["boats"]
        ex["models"][mk] = [{"boat": b["boat_number"], "weatherWater": b["themes_logodds"]["weatherWater"],
                             "raceFormat": b["themes_logodds"]["raceFormat"], "total": b["total_logodds"],
                             "groups": {g: b["groups_logodds"][g] for g in ("weather", "wind", "wave", "grade", "round",
                                                                             "seriesDay")}} for b in boats]
    out["example_race"] = ex
    out["racecard_note"] = ("出走表時点のモデル（master の win_racecard、themes.py の LIVE_FEATURES）は天候・風・波（weather_code・wind_x・"
                            "wind_y・wind_speed・wave_height）と展示タイム3列を使わない。グレード・ラウンド・節（grade_code・round_code・"
                            "series_day・is_final_day_num）は使う。なお表示中の版 2026-10-02 には出走表時点のモデル自体が無い"
                            "（Storage に model_win_racecard が無い）。この確認はすべて展示ありの model_win・top2・top3 で行った")
    (HERE / "env-check.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    write_md(out)
    print("wrote env-check.json / env-check.md")


def write_md(o):
    L = []
    a = L.append
    p = o["population"]
    a("# BOA-271 env-check: 天候・水面／グレード・ラウンド・節の艇ごとの向き\n")
    a(f"- モデル: 版 {o['model_version']} の model_win・top2・top3（展示あり）。pred_contrib を艇ごとにテーマで符号つきに足し、"
      "レース内で中心化した値（log-odds、正＝その艇の見込みを6艇の平均より押し上げる）")
    a(f"- 母集団: test {p['test_period'][0]}〜{p['test_period'][1]} の完全レースから {', '.join(p['excluded_months'])} を除いた "
      f"{p['n_races']:,}R・{p['n_days']}日")
    a(f"- 95%区間: 日単位のブートストラップ {o['n_boot']}回。安定性: {o['seed_note']}")
    a(f"- 出走表時点のモデルとの関係: {o['racecard_note']}")
    a("- 出典（全表共通）: 指標=中心化したテーマの SHAP の平均／母集団=上の母集団／版=2026-10-02／キー `models.<win|top2|top3>.by_band.<帯の種類>.rows[]`\n")
    for mk, md in o["models"].items():
        a(f"## {md['label']}モデル（{mk}）\n")
        for bk, bd in md["by_band"].items():
            a(f"### {bd['theme']} × {bk}\n")
            a("値: 平均 [95%区間]（*＝区間が0をまたがない）。下段の行は ratio_mean_abs（|テーマ| の平均 ÷ |艇の合計| の平均）\n")
            a("| 帯 | n R | " + " | ".join(f"{b}号艇" for b in range(1, 7)) + " |")
            a("|---|---|" + "---|" * 6)
            for r in bd["rows"]:
                if not r["n_races"]:
                    a(f"| {r['band']} | 0 |" + " — |" * 6)
                    continue
                cells = " | ".join(f"{m_:+.3f} [{lo:+.3f}, {hi:+.3f}]{'*' if ex else ''}"
                                   for m_, (lo, hi), ex in zip(r["mean"], r["ci95"], r["ci_excludes_0"]))
                a(f"| {r['band']} | {r['n_races']} | {cells} |")
                a(f"| 　大きさ | | " + " | ".join(f"{x:.1%}" for x in r["ratio_mean_abs"]) + " |")
            a("")
        a("全体での大きさ（|テーマ| の平均 ÷ |艇の合計| の平均）: " + "／".join(
            f"{tk} " + " ".join(f"{b + 1}:{x:.1%}" for b, x in enumerate(v["ratio_mean_abs"])) for tk, v in md["overall"].items()))
        a("")
    ex = o["example_race"]
    c = ex["conditions"]
    a("## 例のレース（若松12R）\n")
    a(f"- 条件: {c['weather']}・{c['wind']}・波{c['wave_cm']}cm・{c['grade']}・{c['stage']}・{c['series_day']}日目（最終日 {c['is_final_day']}）。"
      f"帯: 風速 {c['bands']['wind_speed']}、波高 {c['bands']['wave_height']}、{c['bands']['grade']}、{c['bands']['round']}")
    for mk, rows in ex["models"].items():
        a(f"\n**{o['models'][mk]['label']}**\n")
        a("| 艇 | 天候・水面 | グレード・ラウンド・節 | 艇の合計 | weather | wind | wave | grade | round | seriesDay |")
        a("|---|---|---|---|---|---|---|---|---|---|")
        for r in rows:
            g = r["groups"]
            a(f"| {r['boat']} | {r['weatherWater']:+.3f} | {r['raceFormat']:+.3f} | {r['total']:+.3f} | "
              + " | ".join(f"{g[k]:+.3f}" for k in ("weather", "wind", "wave", "grade", "round", "seriesDay")) + " |")
    a("\n出典: calc1.json（版 2026-10-02、test の行の特徴量）／キー `example_race`")
    (HERE / "env-check.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
