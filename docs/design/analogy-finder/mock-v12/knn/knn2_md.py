"""knn2.json → knn2.md

再実行の順序（このディレクトリで。DB は SELECT のみ）:
  KNN_TAG=knn2 KNN_DROP=weather_code,wind_x,wind_y,wind_speed,wave_height,is_final_day_num ./run.sh knn_build.py
  KNN_TAG=knn2 ./run.sh export_ids.py
  KNN_TAG=knn2 node --env-file=<repo>/.env.local fetch_outcomes.mjs
  ./run.sh knn2_report.py && ./run.sh knn2_md.py      # knn2_report.py は 1版目の work/nbr_racecard.npz と knn.json も読む
"""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
NS = ["20", "50", "100", "200", "400", "800"]
MARK = {2: "○", 1: "△", 0: "×", None: "—"}


def main():
    k = json.loads((HERE / "knn2.json").read_text())
    m, pool, q = k["method"], k["pool"], k["query"]
    L = []
    a = L.append
    a("# BOA-271 k-NN 2版目（天候・風・波・最終日を距離から外した版）\n")
    a("全数字の正本は `knn2.json`（形式は knn.json と同じ。近傍ごとの出力は表示に使う値に絞り、小数は2桁まで。距離だけ3桁）。"
      "出典は 指標／比較／母集団／期間／モデルの版／JSON キー。\n")
    a("## 0. 方式（1版目からの変更）\n")
    a(f"- 距離から外した列: {', '.join(m['excluded_from_distance'])}")
    a("  - 天候・風・波（weather_code・wind_x・wind_y・wind_speed・wave_height）は本番の出走表時点モデルと同じく直前情報として外した")
    a("  - is_final_day_num は学習時のデータで長期が全部 false（長期 0.0%、本体 18.0%）で使えないので外した")
    a(f"- 重み・L・λ は外した後の列で引き直した: 重み={m['weights_model']}、L={m['L']:.4f}、λ=L×{m['lambda_mult']}={m['lambda']:.4f}"
      "（1版目は L=0.3634、λ=0.0908）。重みの値そのもの（特徴量×艇番の中心化 |SHAP|）は列を外しても変わらない。変わるのは距離に入る列と L・λ")
    a(f"- 距離に入るレース共通の列: 数値 {', '.join(m['race_num_features'])}／カテゴリ {', '.join(m['race_cat_features'])}")
    a(f"- 欠損の扱い: {m['missing_handling']}")
    a(f"- 母集団: {pool['period'][0]}〜{pool['period'][1]} の完全レース {pool['n']:,}R（1版目と同じ）")
    a("- 出典: `method`・`search_info`\n")

    a("## 1. 同じ節の印\n")
    s = q["series"]
    ss = [x for x in k["neighbors"] if x["same_series"]]
    a(f"- 判定方法: {m['same_series_rule']}")
    a(f"- 例のレースの節: 会場 {s['venue_code']}（若松）{s['start_date']}〜{s['end_date']}、{s['grade']}")
    a(f"- 近傍 800件のうち同じ節は **{len(ss)}件**。順位: " + "、".join(f"{x['rank']}位（{x['race_id']}）" for x in ss))
    a("- N ごとの件数: " + "、".join(f"N={n} {k['outcome_agg'][n]['same_series']}件" for n in NS))
    a("- 出典: 指標=同じ節の件数／母集団=近傍 800件／キー `neighbors[].same_series`・`outcome_agg.<N>.same_series`\n")

    a("## 2. knn.json（1版目）との比較\n")
    ov = k["compare_knn1"]["overlap"]
    a("| N | 重なり（件） |")
    a("|---|---|")
    for n in NS:
        a(f"| {n} | {ov[n]}（{ov[n] / int(n):.0%}） |")
    a("\n### 似ている点（同じ帯に入る割合）の差（2版目 − 1版目、ポイント）\n")
    a("| 項目 | " + " | ".join(f"N={n}" for n in NS) + " | 全母集団（2版目／1版目） |")
    a("|---|" + "---|" * len(NS) + "---|")
    for d in k["compare_knn1"]["similarity_diff"]:
        if d["diff"] is None:
            continue
        a(f"| {d['label']} | " + " | ".join(f"{d['knn2'][n]:.1%}（{d['diff'][n] * 100:+.1f}）" for n in NS)
          + f" | {d['pool_rate_knn2']:.1%}／{d['pool_rate_knn1']:.1%} |")
    a("\n値は 2版目の割合（括弧が1版目との差）。全母集団の割合は項目の定義が同じなので一致するはず（null の扱いを変えた項目は除く: "
      "2版目は今日か近傍が欠損なら「同じ」に数えない。最終日は長期を null にした）。キー `compare_knn1`\n")

    a("## 3. 距離の分布\n")
    dd = k["distance_distribution"]["racecard"]
    a("| 順位 | 距離（ペナルティ込み） |")
    a("|---|---|")
    for r_, v in dd["dist_at_rank_penalized"].items():
        a(f"| {r_} | {v:.4f} |")
    a(f"\n無作為なペアの距離の中央値 {dd['random_pair_median']:.4f}（ペナルティ込み {dd['random_pair_median_penalized']:.4f}）。"
      "キー `distance_distribution.racecard`\n")

    a("## 4. 似ている点（項目ごと）と、近傍ごとの ○△× の決め方\n")
    a("item_match: 2=○ 同じ帯（rule）、1=△ 近い（near_rule）、0=× 違う、null=今日か近傍のどちらかが欠損。表示用の文字列は item_disp。\n")
    a("| 項目 | 距離に入る | 同じ帯（○） | 近い（△） | 今日 | 全母集団 ○ | " + " | ".join(f"N={n} ○" for n in NS)
      + " | N=200 ○か△ | 全母集団 ○か△ |")
    a("|---|---|---|---|---|---|" + "---|" * len(NS) + "---|---|")
    for s_ in k["similarity"]:
        a(f"| {s_['label']} | {'○' if s_['in_distance'] else '—'} | {s_['rule']} | {s_['near_rule']} | {s_['today']} | "
          f"{s_['pool_rate']:.1%} | " + " | ".join(f"{s_['knn_rate'][n]:.1%}" for n in NS)
          + f" | {s_['knn_near_or_same_rate']['200']:.1%} | {s_['pool_near_or_same_rate']:.1%} |")
    a("\n出典: 指標=今日と同じ帯（○）／○か△ に入るレースの割合／比較=全母集団／母集団=上の母集団／版=2026-10-02 の重み／キー "
      "`similarity[]`（件数は knn_count、欠損で null の件数は knn_null_count）\n")

    a("## 5. 近い順 800件\n")
    keys = [s_["key"] for s_ in k["similarity"]]
    a("列: 順位／race_id／会場 R／グレード・ラウンド（ステージ）／距離／同じ節／距離²の内訳 上位3／結果／○△× の並び（下の項目順）\n")
    a("○△× の項目順: " + "、".join(keys) + "\n")
    a("| # | race_id | 会場 R | グレード・ラウンド（ステージ） | 距離 | 同節 | 距離²の内訳 上位3 | 結果 | ○△× |")
    a("|---|---|---|---|---|---|---|---|---|")
    for x in k["neighbors"]:
        top3 = sorted(x["d2_share_by_group"].items(), key=lambda t: -t[1])[:3]
        r = x["result"]
        marks = "".join(MARK[x["item_match"][kk]] for kk in keys)
        a(f"| {x['rank']} | {x['race_id']} | {x['venue_name']} {x['race_number']}R | {x['grade']}・{x['round']}（{r['stage']}） | "
          f"{x['distance']:.3f} | {'同' if x['same_series'] else ''} | " + "、".join(f"{g} {s:.0%}" for g, s in top3)
          + f" | {r['trifecta']} {r['technique']} {r['payout_3tan']}円 | {marks} |")
    a("\n各項目の今日の値と近傍の値（item_disp）、6艇の着・ST・ST順位・進入は `neighbors[]`・`query.item_disp`。キー `neighbors[]`\n")

    a("## 6. 近傍 N件の結果の集計\n")
    agg = k["outcome_agg"]
    a("| N | " + " | ".join(f"{b}号艇1着" for b in range(1, 7)) + " | 会場一致 | 同じ節 |")
    a("|---|" + "---|" * 6 + "---|---|")
    for n in NS:
        g = agg[n]
        a(f"| {n} | " + " | ".join(f"{g['winner_boat'][str(b)]}（{g['winner_boat'][str(b)] / g['n']:.1%}）" for b in range(1, 7))
          + f" | {g['venue_match']} | {g['same_series']} |")
    pr = k["pool_reference"]["winner_boat_rate"]
    a("| 全母集団 | " + " | ".join(f"{pr[str(b)]:.1%}" for b in range(1, 7)) + " | — | — |")
    techs = list(agg["800"]["technique"])
    a("\n| N | " + " | ".join(techs) + " |")
    a("|---|" + "---|" * len(techs))
    for n in NS:
        a(f"| {n} | " + " | ".join(str(agg[n]["technique"].get(t, 0)) for t in techs) + " |")
    a("\n艇×着順・3連単の全組み合わせはキー `outcome_agg.<N>.boat_finish`・`trifecta`\n")

    a("## 7. 展示を含めた距離との重なり\n")
    a("| N | 重なり |")
    a("|---|---|")
    for n, v in k["overlap_with_exh"].items():
        a(f"| {n} | {v}（{v / int(n):.0%}） |")
    a("\nキー `overlap_with_exh`\n")

    a("## 8. 母集団 408,888R と 120 の 408,723R の差（+165R）\n")
    pdf = k["pool_diff_vs_120"]
    a(f"- 2着か3着が無いレース: {pdf['no_rank2_or_rank3']['total']}R（kb {pdf['no_rank2_or_rank3']['kb']}／本体 "
      f"{pdf['no_rank2_or_rank3']['main']}。3着が無い {pdf['no_rank2_or_rank3']['no_rank3']}、2着が無い {pdf['no_rank2_or_rank3']['no_rank2']}）")
    a(f"- 本体で race_status='no_race' なのにこちらに入っているレース: {', '.join(pdf['main_race_status_no_race_in_ours'])}")
    a(f"- 説明: {pdf['explanation']}")
    a("- 出典: 母集団=上の母集団（work2/races.pkl）と、DB の race_results.race_status（2025-12-03〜2026-09-26 の no_race 8R のうち、"
      "こちらの母集団にあるのは1R）／キー `pool_diff_vs_120`\n")
    (HERE / "knn2.md").write_text("\n".join(L) + "\n")
    print("wrote knn2.md")


if __name__ == "__main__":
    main()
