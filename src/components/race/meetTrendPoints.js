/**
 * 今節タブの日付の横軸の図（6艇の推移 R-43・詳細の小さな線 R-45）の点と目盛りを作る純関数。
 * 部品のファイル（RaceMeetTabTrend.jsx）から部品でない関数を出さないため分けた（react-refresh）
 */
import { dayCenter, dayTickLabels } from "../../utils/trendDateLayout";

// 図の点。横の位置（xr）と走らない日をまたぐ印は日付の配置（layoutTrendByDate）から。
// 吹き出しの中身は、選んだ艇なら下の「日別の走り」表と同じ行（艇番・進入・ST を持つ）から。
// 公式の記号（エ・転 等）は labelOf（RaceMeetTab の finishLabelOf）で言語ごとの表記にする
export function pointOf(r, j, layout, { trendKey, rowOf, labelOf }) {
  const label = labelOf(r.finish);
  // 値の無い走（ST の F・L、欠場・転覆等）は上の帯に公式の記号を出す（線が切れた理由を見せる）
  const flagged = r[trendKey] == null && typeof r.finish === "string";
  return {
    raceId: r.raceId,
    date: r.date,
    value: r[trendKey],
    mark: label,
    flag: flagged ? label : null,
    // 同じ日の2走の間を日の間隔の0.4から0.48へ広げる（点の中に着順を描く丸 r=9 が 375px で重ならない幅）
    xr: Math.min(
      1,
      Math.max(0, layout.centers[j] + (layout.xs[j] - layout.centers[j]) * 1.2),
    ),
    breakBefore: layout.breakBefore[j],
    gapDays: null,
    run: rowOf(r.raceId) ?? {
      raceId: r.raceId,
      date: r.date,
      venueCode: r.raceId.slice(11, 13),
      raceNo: Number(r.raceId.slice(14, 16)),
      boatNumber: null,
      entryCourse: null,
      finishRank: typeof r.finish === "number" ? r.finish : null,
      finishMark: typeof r.finish === "number" ? null : label,
    },
  };
}

// 日付の横軸の目盛り（今節の詳細の小さな線 R-45 も同じ目盛りで並べる）
export function dayTicksOf(trendDates) {
  const labels = dayTickLabels(trendDates);
  return trendDates.map((d, i) => ({
    xr: dayCenter(i, trendDates.length),
    label: labels[i],
  }));
}
