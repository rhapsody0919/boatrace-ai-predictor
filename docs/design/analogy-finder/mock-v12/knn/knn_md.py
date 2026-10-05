"""knn.json → knn.md（出典つきの表）

再実行の順序（このディレクトリで。DB・Storage は読み取りのみ）:
  前提: ../model-prep/data（fetch_data.mjs の出力）と ../model-prep/models/2026-10-02、../model-prep/code-at-train
  ./run.sh knn_build.py                         # 特徴量・行列・重み・探索（約3〜4分）
  ./run.sh export_ids.py
  node --env-file=<repo>/.env.local fetch_outcomes.mjs   # 近傍の結果（SELECT のみ）
  ./run.sh knn_report.py && ./run.sh knn_md.py
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
NS = ["20", "50", "100", "200", "400", "800"]


def main():
    k = json.loads((HERE / "knn.json").read_text())
    m, pool, q = k["method"], k["pool"], k["query"]
    L = []
    a = L.append
    a("# BOA-271 k-NN（knn_p）で選んだ例のレースの近傍\n")
    a("全数字の正本は `knn.json`。出典は 指標／比較／母集団／期間／モデルの版／JSON キー。\n")
    a("## 0. 方式と母集団\n")
    a(f"- 例のレース: `{q['race_id']}`（若松 12R G1 優勝戦）。結果 {q['result']['trifecta']}、{q['result']['technique']}、"
      f"3連単 {q['result']['payout_3tan']}円（{q['result']['popularity_3tan']}番人気）")
    a(f"- 距離: MD-6 の knn_p と同じ作り方（knn_build.py の docstring）。重み={m['weights_model']}。"
      f"L={m['L']:.4f}、λ=L×{m['lambda_mult']}={m['lambda']:.4f}（MD-6 で決まり手に選ばれた倍率 L/4）")
    a(f"- 距離から外したもの: {', '.join(m['excluded_from_distance'])}（boat_number は MD-6 でも次元にしない。当該レースの ST は"
      "もともと特徴量に無い）。天候・風・波は依頼どおり距離に残した（本番の出走表時点モデルではこの3つも直前情報として外している点に注意）")
    a(f"- 距離に入っているグループ: {', '.join(m['groups_in_distance'])}")
    a(f"- 欠損の扱い: {m['missing_handling']}")
    a(f"- 母集団: {pool['period'][0]}〜{pool['period'][1]} の完全レース **{pool['n']:,}R**（kb {pool['by_source']['kb_le_2025-12-02']:,}／"
      f"本体 {pool['by_source']['main_ge_2025-12-03']:,}）。120 の母集団 408,723R（kb 362,763／本体 45,960）より "
      f"{pool['compare_120_pool']['diff']:+,}R（kb {pool['compare_120_pool']['diff_kb']:+,}、本体 {pool['compare_120_pool']['diff_main']:+,}）。"
      "完全レースの判定が features.py（6艇・1着1艇・1〜3着に返還艇なし・欠場除外）と 120 の SQL で違う分")
    a("- 出典: `method`・`pool`・`search_info`\n")

    a("## 1. 距離の分布\n")
    dd = k["distance_distribution"]["racecard"]
    a("| 順位 | 距離（ペナルティ込み） |")
    a("|---|---|")
    for r_, v in dd["dist_at_rank_penalized"].items():
        a(f"| {r_} | {v:.4f} |")
    a(f"\n- 無作為なペアの距離の中央値: {dd['random_pair_median']:.4f}（ペナルティ込み {dd['random_pair_median_penalized']:.4f}）。"
      f"今日のレースと全母集団の距離の中央値: {dd['query_to_pool_median']:.4f}（ペナルティ込み {dd['query_to_pool_median_penalized']:.4f}）")
    a("- 無作為なペア = 母集団から無作為 500R × 5,000R（MD-6 の d_ref と同じ作り方、seed 0）")
    a("- 出典: 指標=重み付きユークリッド距離／母集団=上の母集団／版=2026-10-02 の重み／キー `distance_distribution.racecard`\n")

    a("## 2. 近い順 800件\n")
    a("列: 順位／race_id／会場 R／グレード・ラウンド（ステージ）／距離／上位%（順位÷母集団）／距離²の内訳の上位3つ（割合）／"
      "結果（1-2-3、決まり手、3連単払戻）／6艇の着（1〜6号艇）。項目グループごとの距離²と割合、各グループの実際の値（今日とその"
      "レース）、ST・ST順位・進入は `neighbors[]` の `d2_by_group`・`d2_share_by_group`・`values`・`result.boats`。"
      "今日の値は `query.values`。`venuePenalty` は会場が違うときの λ\n")
    a("| # | race_id | 会場 R | グレード・ラウンド（ステージ） | 距離 | 上位% | 距離²の内訳 上位3 | 結果 | 着 |")
    a("|---|---|---|---|---|---|---|---|---|")
    for x in k["neighbors"]:
        top3 = sorted(x["d2_share_by_group"].items(), key=lambda t: -t[1])[:3]
        r = x["result"]
        a(f"| {x['rank']} | {x['race_id']} | {x['venue_name']} {x['race_number']}R | {x['grade']}・{x['round']}（{r['stage']}） | "
          f"{x['distance']:.3f} | {x['top_pct']:.4f}% | " + "、".join(f"{g} {s:.0%}" for g, s in top3)
          + f" | {r['trifecta']} {r['technique']} {r['payout_3tan']}円 | " + " ".join(str(b["finish"]) for b in r["boats"]) + " |")
    a("\n出典: 指標=距離・距離²の内訳／母集団=上の母集団／期間=2019-04-01〜2026-09-26／版=2026-10-02 の重み／キー `neighbors[]`。"
      "結果は DB（kb_archive_races・kb_archive_boats、race_results・race_start_timings・race_entries・exhibition_data）。"
      "長期の着は finish_raw をそのまま（数字は先頭の0を外した。K0/K1=欠場、F/L、S0〜S2=失格 等）。本体は F/L は ST の表、欠は出走表・展示の"
      "欠場、着順に無いものは「失」（転覆・失格等の区別は DB に無い）\n")

    a("### 距離²の内訳の平均（近傍 N件の距離²の合計に占める割合）\n")
    gs = k["d2_share_by_group_mean"]
    keys = sorted(gs["800"], key=lambda g: -gs["800"][g])
    a("| グループ | " + " | ".join(f"N={n}" for n in NS) + " |")
    a("|---|" + "---|" * len(NS))
    for g in keys:
        a(f"| {g} | " + " | ".join(f"{gs[n][g]:.1%}" for n in NS) + " |")
    a("\nキー `d2_share_by_group_mean`\n")

    a("## 3. 集まり全体の似ている点（項目ごとに今日と同じ帯に入る割合）\n")
    a("| 項目 | グループ | 帯の決め方 | 今日 | 全母集団 | " + " | ".join(f"N={n}" for n in NS) + " | 倍率 N=200 |")
    a("|---|---|---|---|---|" + "---|" * len(NS) + "---|")
    for s in k["similarity"]:
        today = json.dumps(s["today"], ensure_ascii=False)
        lift = s["lift"]["200"]
        a(f"| {s['label']}{'' if s['in_distance'] else '（距離外）'} | {s['group']} | {s['rule']} | {today} | {s['pool_rate']:.1%} | "
          + " | ".join(f"{s['knn_rate'][n]:.1%}" for n in NS) + f" | {'—' if lift is None else f'{lift:.2f}'} |")
    a("\n倍率 = 近傍 N=200 の割合 ÷ 全母集団の割合。件数は `similarity[].knn_count`・`pool_n`。"
      "出典: 指標=今日と同じ帯に入るレースの割合／比較=全母集団／母集団=上の母集団／版=2026-10-02 の重み／キー `similarity[]`\n")

    a("## 4. 近傍 N件の結果の集計\n")
    agg = k["outcome_agg"]
    a("### 1着の艇番\n")
    a("| N | " + " | ".join(f"{b}号艇" for b in range(1, 7)) + " | 会場一致 | kb/本体 |")
    a("|---|" + "---|" * 6 + "---|---|")
    for n in NS:
        g = agg[n]
        a(f"| {n} | " + " | ".join(f"{g['winner_boat'][str(b)]}（{g['winner_boat'][str(b)] / g['n']:.1%}）" for b in range(1, 7))
          + f" | {g['venue_match']} | {g['kb_vs_main']['kb']}/{g['kb_vs_main']['main']} |")
    pr = k["pool_reference"]["winner_boat_rate"]
    a("| 全母集団 | " + " | ".join(f"{pr[str(b)]:.1%}" for b in range(1, 7)) + " | — | — |")
    a("\n### 決まり手\n")
    techs = list(agg["800"]["technique"])
    a("| N | " + " | ".join(techs) + " |")
    a("|---|" + "---|" * len(techs))
    for n in NS:
        a(f"| {n} | " + " | ".join(str(agg[n]["technique"].get(t, 0)) for t in techs) + " |")
    a("\n### 艇×着順（件数）\n")
    a("| N | 艇 | 1着 | 2着以内 | 3着以内 |")
    a("|---|---|---|---|---|")
    for n in NS:
        for b in range(1, 7):
            v = agg[n]["boat_finish"][str(b)]
            a(f"| {n} | {b} | {v['win']} | {v['top2']} | {v['top3']} |")
    a("\n### 3連単の組み合わせ（全部）\n")
    for n in NS:
        tri = agg[n]["trifecta"]
        a(f"- N={n}（{len(tri)}通り）: " + "、".join(f"{c} {v}" for c, v in tri.items()))
    a("\n出典: 指標=件数／母集団=近傍 N件／版=2026-10-02 の重み／キー `outcome_agg.<N>`。1着・2着・3着は特徴量の着順（完全レース）、"
      "決まり手は DB\n")

    a("## 5. 参考: 展示を含めた距離との重なり\n")
    ov = k["overlap_with_exh"]
    wx = k["distance_distribution"]["with_exh"]
    a("| N | 重なり（件） |")
    a("|---|---|")
    for n, v in ov.items():
        a(f"| {n} | {v}（{v / int(n):.0%}） |")
    a(f"\n展示を含めた版: 展示タイム3列を足し、重み・L・λ を同じ手順で作り直した（L={wx['L']:.4f}、λ={wx['lambda']:.4f}）。"
      "キー `overlap_with_exh`・`distance_distribution.with_exh`\n")
    a("## 6. 注意\n")
    a("- 1位の 2026-09-25 若松 3R（予選）は同じ節の2日前のレース。同じ節のレースは選手・モーターが重なるので近くなりやすい。"
      "同じ節を除くかどうかは決めていない（今は除いていない）")
    a("- 「最終日か」の全母集団の一致率が 1.6% と低いのは、学習時のデータ（Storage の長期キャッシュ v1）で長期の is_final_day が全部 false（長期 0.0%、本体 18.0%）"
      "のため（BOA-696 の修正前。master の features.py は check_final_day でこれを止める）。長期期間の最終日の値は信用できない")
    a("- 重みの標本は MD-6 と同じ期間（2025-01-01〜2025-12-02 の無作為 5,000R、seed 7）。本番モデルの区分では fit（〜2025-07-02）の"
      "後半と、温度合わせ（2025-07-03〜10-02）・test（2025-10-03〜）にまたがる。重みは距離の尺度にだけ使う")
    (HERE / "knn.md").write_text("\n".join(L) + "\n")
    print("wrote knn.md")


if __name__ == "__main__":
    main()
