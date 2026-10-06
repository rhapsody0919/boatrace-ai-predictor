"""model-prep 4: work/ の結果をまとめて model-prep.json（全部）と model-prep.md（出典つきの表）を書く。

再実行の順序（README 代わり。このディレクトリで）:
  node fetch_data.mjs models && node fetch_data.mjs kb && node fetch_data.mjs main   # Storage・DB の読み取りのみ
  node db_snapshot.mjs && node race_result.mjs                                        # DB の読み取りのみ
  ./run.sh build_test.py && ./run.sh shap_check.py && ./run.sh hole_scan.py
  ./run.sh calc1_race.py && ./run.sh calc2_index.py && ./run.sh assemble.py
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
W = HERE / "work"
VERSION = "2026-10-02"


def load(p):
    return json.loads(Path(p).read_text())


def f3(v):
    return "—" if v is None else f"{v:.3f}"


def main():
    build = load(W / "build_info.json")
    repro = load(W / "repro_check.json")
    c1 = load(W / "calc1.json")
    c2 = load(W / "calc2.json")
    race = load(W / "race_result.json")
    mbm = load(W / "missing_by_month.json")
    hole = load(W / "hole_scan.json")
    fetch = load(HERE / "data" / "fetch_manifest.json")
    model_row = load(HERE / "db_analogy_models_active.json")[0]
    test_period = model_row["metrics"]["periods"]["test"]
    prov = {
        "model_version": VERSION, "is_active": model_row["is_active"], "trained_at": model_row["trained_at"],
        "train_run": "train-analogy.yml run 36968972725（2026-10-02T05:26Z, headSha dc6d02084）",
        "features_code": "code-at-train/features.py = git show dc6d02084:scripts/ml/analogy/features.py "
                         "（master の features.py はこの版の後に定義が変わったので使わない）",
        "storage_files": fetch.get("storage_files"),
        "racecard_model": "無し（この版の Storage に model_win_racecard.txt.gz が無い）",
        "kb_source": "Storage analogy/source/v1/（2026-10-02T05:30Z 書き込み＝学習の run が書いたもの。以後変更なし）",
        "main_source": "DB を 2026-10-03 に SELECT（学習時から補完・訂正で変わりうる）",
        "test_period_db": test_period, "n_test_races_db": model_row["metrics"]["n_races"]["test"],
        "rebuild": build, "fetch_manifest": fetch,
        "column_order": "booster.feature_name()（3モデルとも同じ44列。repro_check.targets.*.feature_names）",
    }
    out = {"provenance": prov, "repro_check": repro, "calc1": {**c1, "actual_result": race},
           "calc2": {k: v for k, v in c2.items() if k != "cube"}, "cube": c2["cube"],
           "missing_by_month": mbm, "hole_scan": hole}
    (HERE / "model-prep.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))

    L = []
    a = L.append
    a("# BOA-271 model-prep（寄与度の本番モデル 2026-10-02 による数字）\n")
    a("全数字の正本は `model-prep.json`。各表の「出典」行は 指標／比較／母集団／期間／モデルの版／JSON キー。"
      "log-odds は LightGBM の pred_contrib（二値モデルの生スコアの単位）。\n")
    a("## 0. 版とデータ\n")
    a(f"- 表示中の版: `{VERSION}`（analogy_models.is_active=true、trained_at {model_row['trained_at']}）。"
      f"test 期間 {test_period[0]}〜{test_period[1]}、DB の test レース数 {prov['n_test_races_db']:,}")
    a(f"- 学習: {prov['train_run']}。特徴量は学習時のコード（{prov['features_code']}）")
    a(f"- Storage `analogy/{VERSION}/` にあるファイル: {', '.join(prov['storage_files'] or [])}。"
      "**model_win_racecard は無い**（この版は出走表時点専用モデルを足す前のコードで学習）")
    a(f"- 作り直した test: {build['test_races']:,} レース・{build['test_rows']:,} 艇（{build['test_from']}〜{build['test_to']}）。"
      f"DB の版より {build['test_races'] - prov['n_test_races_db']:+,} レース。本体テーブルを今日読んだため"
      "（学習の run は 10-02 14:26 JST 開始で、その日の午後のレースの結果がまだ無かった等）")
    a("- 出典: provenance（model-prep.json `provenance`）\n")

    a("## 1. 再現の確認（最初に確認。満たさなければ止める条件）\n")
    a("全国・全グレード・全ラウンド・全艇のシェア（中心化しない平均 |SHAP| の割合）を、作った test で計算し直して本番 "
      "`analogy_contribution_profiles` と比べた。許容 0.002。\n")
    a("| 着順 | テーマ | 再計算 | 本番 DB | 差 |")
    a("|---|---|---|---|---|")
    for name, t in repro["targets"].items():
        for k in t["shares_rebuilt"]:
            a(f"| {name} | {k} | {t['shares_rebuilt'][k]:.5f} | {t['shares_db'][k]:.5f} | {t['diff'][k]:+.5f} |")
    a("")
    a(f"- 結果: **{'再現した' if repro['all_reproduced'] else '再現しない'}**。テーマの差の最大 "
      + "・".join(f"{n} {t['max_abs_diff']:.5f}" for n, t in repro["targets"].items())
      + "、グループ（breakdown）の差の最大 "
      + "・".join(f"{n} {t['breakdown_max_abs_diff']:.5f}" for n, t in repro["targets"].items()))
    a(f"- 出典: 指標=テーマのシェア（全国/艇0）／比較=本番 DB の同じセル／母集団=test の完全レース 作り直し "
      f"{build['test_races']:,}R・DB {prov['n_test_races_db']:,}R／期間={build['test_from']}〜{build['test_to']}／"
      f"版={VERSION}／キー=`repro_check.targets.{{win,top2,top3}}`\n")

    # ---------------- 計算1
    a("## 2. 計算1: このレースの寄与度（2026-09-27 若松 G1 優勝戦 12R）\n")
    rr = race["results"][0]
    order = [rr[f"rank{k}"] for k in range(1, 7)]
    a(f"- race_id `{race['race_id']}`（DB で確認: race_stage「{race['conditions'][0]['race_stage']}」、"
      f"race_grade {race['races'][0]['race_grade']}）。test に完全レースとして入っている（`calc1.race_ok`={c1['race_ok']}）")
    a(f"- 実際の結果: 着順 {'-'.join(str(x) for x in order)}、決まり手 **{rr['winning_technique']}**。"
      f"天候 {race['conditions'][0]['weather']}、風 {race['conditions'][0]['wind_direction']} "
      f"{race['conditions'][0]['wind_speed']}m、波 {race['conditions'][0]['wave_height']}cm。出典: `calc1.actual_result`")
    a("- 選手: " + "、".join(f"{e['boat_number']}号艇 {e['player_name'].replace('　', '')}" for e in race["entries"])
      + "。ST: " + "、".join(f"{s['boat_number']}:{s['start_timing']}" for s in race["start_timings"]))
    a("- 定義: pred_contrib を特徴量ごとにレース内で中心化（6艇の平均を引く）→ テーマ・グループに符号つきで合計"
      "（perrace.py の centered_theme_shares・src/utils/analogyRaceContribution.js と同じ）。"
      "6艇全体のシェア = 中心化した |SHAP| の和の割合。艇ごとのテーマのシェア = その艇のテーマの符号つきの値の |値| の割合"
      "（特徴量単位の |値| で足した版は `boat_theme_share_featureabs`）")
    a(f"- 出典（この節共通）: 母集団=このレースの6艇／期間={race['race_id'][:10]}／版={VERSION}／"
      "キー=`calc1.models.{win,top2,top3}.{themes6,themes7}`\n")
    for name, m in c1["models"].items():
        lab = {"win": "1着", "top2": "2着以内", "top3": "3着以内"}[name]
        a(f"### {lab}モデル（{name}）\n")
        a(f"予測確率（参考、{m['prob_def']}）: " + "、".join(f"{b}号艇 {p:.3f}" for b, p in zip(c1['boats'], m['prob']))
          + f"。期待値 {m['expected_value_logodds']:.3f}。キー `calc1.models.{name}.prob`\n")
        for tk in ("themes6", "themes7"):
            agg = m[tk]
            keys = list(agg["theme_shares"])
            a(f"**{tk}** 6艇全体のシェア: " + "、".join(f"{k} {agg['theme_shares'][k]:.3f}" for k in keys)
              + f"（|値|の総和 {agg['total_abs_sum_logodds']:.3f}）。キー `calc1.models.{name}.{tk}.theme_shares`\n")
            a("| 艇 | 合計 | " + " | ".join(keys) + " |")
            a("|---|---|" + "---|" * len(keys))
            for b in agg["boats"]:
                a(f"| {b['boat_number']} | {b['total_logodds']:+.3f} | "
                  + " | ".join(f"{b['themes_logodds'][k]:+.3f}（{b['boat_theme_share'][k]:.0%}）" for k in keys) + " |")
            a(f"\n値=中心化した符号つき log-odds（括弧は艇ごとのテーマのシェア）。キー `calc1.models.{name}.{tk}.boats[]`\n")
        gkeys = list(m["themes6"]["boats"][0]["groups_logodds"])
        a("グループ（符号つき log-odds）:\n")
        a("| 艇 | " + " | ".join(gkeys) + " |")
        a("|---|" + "---|" * len(gkeys))
        for b in m["themes6"]["boats"]:
            a(f"| {b['boat_number']} | " + " | ".join(f"{b['groups_logodds'][k]:+.3f}" for k in gkeys) + " |")
        a(f"\nキー `calc1.models.{name}.themes6.boats[].groups_logodds`\n")
    a("### 特徴量の実際の値と6艇中の順位\n")
    a("| グループ | 特徴量 | 1 | 2 | 3 | 4 | 5 | 6 | 順位（1〜6号艇） | 向き |")
    a("|---|---|---|---|---|---|---|---|---|---|")
    for g, fs in c1["feature_values"].items():
        for f, v in fs.items():
            vals = " | ".join("—" if x is None else (f"{x:.3f}" if abs(x - round(x)) > 1e-6 else f"{x:.0f}")
                              for x in v["values"])
            rk = ",".join("—" if x is None else str(x) for x in v["rank_in_race"])
            a(f"| {g} | {f} | {vals} | {rk} | {v['rank_direction']} |")
    a("\n向き: desc=大きいほど1位、asc=小さいほど1位、none=良し悪しの向きなし（昇順の番号）。"
      "値はモデルに渡した float32（例 nat_win=全国勝率、exh_time=展示タイム、motor_2=モーター2連率、st_mean30=過去30走の平均ST）。"
      "キー `calc1.feature_values`\n")
    a(f"- 展示前（出走表時点）の値: **出せない**。{c1['racecard']['reason']}\n")

    # ---------------- 計算2
    a("## 3. 計算2: 条件ごとの「テーマが見込みを動かした量（全国=100）」\n")
    a("定義: 艇ごとにテーマの SHAP を符号つきで足す → レース内で中心化 → 6艇の |値| の和（テーマの L1、log-odds）→ "
      "スライス内のレースの平均 ÷ 全国（同じ変種の全レース）の平均 ×100。合計・順位は作らない。"
      "誤差は日単位のブートストラップ 200回（各回でスライスと全国の両方を計算し直す）の SD と 2.5/97.5%。"
      "`environment(6テーマ)` は環境の9列を1テーマとして足してから中心化した値（7テーマの2つの和とは一致しない）。\n")
    a("### 3.1 データの穴の判定\n")
    a(f"- 基準: {c2['hole_rule']}")
    a(f"- 判定された穴の月: **{', '.join(c2['hole_months'])}**")
    a("- 依頼の前提（ST・展示が欠損）は、この版の特徴量では当てはまらない。完全レースの展示タイム・ST の欠損は全月 0.2% 以下"
      "（K/B 補完で埋まっている）。穴は風（wind_x/y）・最終日（is_final_day_num）に出る。参考として 2025-12〜2026-03 を"
      "まるごと除く版（`excl_2025-12_to_2026-03`）も出した\n")
    a("| 月 | 完全レース | exh_time | st_result | st_mean30 | wind_x | is_final_day | grade_code |")
    a("|---|---|---|---|---|---|---|---|")
    for k, v in mbm.items():
        a(f"| {k} | {v['n_races']} | {v['exh_time_missing']:.2%} | {v['st_result_missing']:.2%} | "
          f"{v['st_mean30_missing']:.2%} | {v['wind_x_missing']:.1%} | {v['is_final_day_num_missing']:.1%} | "
          f"{v['grade_code_missing']:.1%} |")
    a("\n出典: 指標=艇単位の欠損率／母集団=test の完全レース／期間=test／版の特徴量／キー `missing_by_month`"
      "（全特徴量の月別は `hole_scan.nan_rate_by_month_complete_races`、完全レースの割合は `hole_scan.complete_rate`）\n")
    keys = c2["theme_keys"]
    for var, v in c2["variants"].items():
        a(f"### 3.2 指数（{var}: 期間 {v['period'][0]}〜{v['period'][1]}、除いた月 {v['excluded_months'] or 'なし'}）\n")
        for name in ("win", "top2", "top3"):
            a(f"**{name}**（値: 指数 ±SD [95%区間]）\n")
            a("| スライス | n レース | n 日 | " + " | ".join(keys) + " | 1号艇1着率（実際） | 予測1位の平均確率 |")
            a("|---|---|---|" + "---|" * len(keys) + "---|---|")
            for s, r in v["slices"].items():
                if not r.get("models"):
                    a(f"| {s} | {r['n_races']} | {r['n_days']} |" + " — |" * len(keys) + " — | — |")
                    continue
                mm = r["models"][name]
                cells = " | ".join(f"{mm[k]['index']:.0f} ±{mm[k]['sd']:.1f} [{mm[k]['ci95'][0]:.0f}–{mm[k]['ci95'][1]:.0f}]"
                                   for k in keys)
                a(f"| {s} | {r['n_races']} | {r['n_days']} | {cells} | {r['actual_boat1_win_rate']:.3f} | "
                  f"{r['pred_top1_mean_prob_win']:.3f} |")
            nat = v["slices"]["national"]["models"][name]
            a(f"\n全国の平均 L1（log-odds、=100 の基準）: " + "、".join(f"{k} {nat[k]['mean_l1_logodds']:.3f}" for k in keys))
            a(f"\n出典: 指標=テーマの L1 の指数（全国=100）／比較=全国（同じ変種）／母集団=test の完全レース／期間={v['period'][0]}〜"
              f"{v['period'][1]}（除外 {v['excluded_months'] or 'なし'}）／版={VERSION}／キー "
              f"`calc2.variants.{var}.slices.<スライス>.models.{name}.<テーマ>`。"
              "1号艇1着率・予測1位の平均確率（1着モデル softmax(温度×生スコア) の6艇最大）は "
              f"`calc2.variants.{var}.slices.<スライス>.actual_boat1_win_rate / pred_top1_mean_prob_win`\n")
    w = c2["variants"]["all_months"]["slices"]["venue_20_G1_yusho"]
    a(f"注意: 若松×G1×優勝戦は test 期間に {w['n_races']} レース（2026-02-20 12R と 2026-09-27 12R）・{w['n_days']} 日しかない。"
      "日単位のブートストラップは日が少ないと SD が過小（1日なら全国側の揺れしか入らない）。この行の SD・区間は使えない。"
      "n 日が 10 未満のスライスは同様\n")
    cube = c2["cube"]
    nval = sum(1 for c in cube["cells"].values() if "win" in c)
    a(f"## 4. cube（会場×グレード×ラウンドの全組み合わせ、{cube['variant']}）\n")
    a(f"- {len(cube['cells'])} セル中、n_races ≥ {cube['min_n']} の {nval} セルに値。形式: {cube['value_format']}。"
      f"全国の基準: {cube['national_basis']}。キー `cube.cells[\"venue|grade|round\"]`（例 `cube.cells[\"20|G1|yusho\"]`）")
    a(f"- 例: `0|all|all` → {json.dumps(cube['cells']['0|all|all'].get('win'), ensure_ascii=False)}（win）、"
      f"`20|all|all` n={cube['cells']['20|all|all']['n']}、`20|G1|yusho` n={cube['cells']['20|G1|yusho']['n']}\n")

    a("## 5. 出せなかった項目\n")
    a(f"- 展示前（出走表時点）の1着の寄与度: {c1['racecard']['reason']}")
    a("- 穴の月の判定を ST・展示の欠損で行うこと: この版の特徴量では ST・展示に穴が無い。代わりに風・最終日で判定した（3.1）")
    a("- 若松×G1×優勝戦の誤差: n=2 で、日単位ブートストラップの SD は意味を持たない（値は出したが使えない）")
    (HERE / "model-prep.md").write_text("\n".join(L) + "\n")
    print("wrote model-prep.json / model-prep.md")


if __name__ == "__main__":
    main()
