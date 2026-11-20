import { GRADE_LABELS } from "../race/raceGradeLabels";

// 選手ページの成績・調子（RacerPerformanceStats）の表示用の値。描画の材料を作るだけで I/O は無い

export const VC_RACE_PAGE_SIZE = 10;
// スマホ幅では推移グラフを直近50走に絞る。200走を幅約250pxに描くと1走あたり約1.2pxで、
// 線と点が帯に潰れて読めなかった（BOA-583 ファン評価2周目）
export const NARROW_CHART_RUNS = 50;

/** 選択中の軸だけを「×」でつないだラベル */
export function vcLabelOf(t, { vcVenue, vcBoat, vcGrade, vcStage }) {
  // 選択中の軸だけをラベルに含める（未選択の軸まで「全会場」等と並べると
  // 4軸化で冗長になるため。docs/design/racer-stats-drilldown/plan.md参照）
  const vcLabelParts = [];
  if (vcVenue !== "all") vcLabelParts.push(t(`venues.${vcVenue}`, vcVenue));
  if (vcBoat !== "all") vcLabelParts.push(`${vcBoat}号艇`);
  if (vcGrade !== "all") vcLabelParts.push(GRADE_LABELS[vcGrade] ?? vcGrade);
  if (vcStage !== "all") vcLabelParts.push(vcStage);
  return vcLabelParts.length > 0 ? vcLabelParts.join("×") : "全条件";
}

/** STの推移の縦軸の上端と目盛り */
export function stAxisOf(vcData) {
  // STの推移の縦軸。0 から 0.1 刻みで等間隔にする（自動だと 0.15・0.30・0.50 のように
  // 上だけ間隔が広くなり、上の方の走の数を読み違えた。ファン評価1周目）
  const stMax = Math.max(
    0,
    ...(vcData?.series ?? []).map((d) => d.start_timing ?? 0),
  );
  const stAxisTop = Math.max(0.3, Math.ceil(stMax * 10) / 10);
  const stAxisTicks = Array.from(
    { length: Math.round(stAxisTop * 10) + 1 },
    (_, i) => Math.round(i * 10) / 100,
  );
  return { stAxisTop, stAxisTicks };
}

/**
 * 決まり手表示用に、データソースに関わらず同じ形（{technique, count, percentage}[]）
 * へ正規化する。JSXブロックを1つに統一するため（両ブランチの見た目の重複を回避）
 */
export function displayTechniquesOf(vcData, techniqueProfile) {
  const vcTechTotal = vcData
    ? Object.values(vcData.tech).reduce((a, b) => a + b, 0)
    : 0;
  return vcData
    ? Object.entries(vcData.tech)
        .map(([technique, count]) => ({
          technique,
          count,
          percentage: vcTechTotal > 0 ? (count / vcTechTotal) * 100 : 0,
          countLabel: `${count}回/${vcTechTotal}回`,
        }))
        .sort((a, b) => b.count - a.count)
    : (techniqueProfile?.techniques ?? []).map((tech) => ({
        technique: tech.technique,
        count: tech.count,
        percentage: tech.percentage,
        countLabel: `${tech.count}回`,
      }));
}

/** 全国勝率・当地勝率の推移と、展示タイムの推移（日次の集計） */
export function trendChartsOf(formTrend, exhibitionTimeTrend) {
  const chartData = (formTrend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    national_win_rate: row.win_rate,
    local_win_rate: row.local_win_rate,
  }));
  const exhibitionChartData = (exhibitionTimeTrend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    avg_exhibition_time: row.avg_exhibition_time,
  }));
  return { chartData, exhibitionChartData };
}

/** レース一覧（BOA-159）のページング。vcData.matchedRacesは絞り込み条件に合致した個別レースの配列（新しい順） */
export function racePagesOf(vcData, vcRacePage) {
  const vcRaceTotalPages = vcData
    ? Math.max(1, Math.ceil(vcData.matchedRaces.length / VC_RACE_PAGE_SIZE))
    : 1;
  const vcRacePageRows = vcData
    ? vcData.matchedRaces.slice(
        (vcRacePage - 1) * VC_RACE_PAGE_SIZE,
        vcRacePage * VC_RACE_PAGE_SIZE,
      )
    : [];
  return { vcRaceTotalPages, vcRacePageRows };
}

// course_race_counts: { "1": { total, wins, top2, top3 }, ... } → コース番号昇順の配列に変換
function dailyCourseStats(aggregatedStats) {
  return Object.entries(aggregatedStats?.course_race_counts ?? {}).map(
    ([course, counts]) => ({
      course: Number(course),
      total: counts.total ?? 0,
      wins: counts.wins ?? 0,
      winRate: counts.total > 0 ? counts.wins / counts.total : null,
      // top2/top3は本チケット（BOA-268）で追加したフィールドのため、
      // バッチ集計（aggregate-racer-stats.js）が再実行されるまでは
      // 未集計の選手が存在する。undefinedを0扱いすると「2連率0%」と
      // 誤表示するため、区別してnull（"-"表示）にする
      top2Rate:
        counts.total > 0 && counts.top2 !== undefined
          ? counts.top2 / counts.total
          : null,
      top3Rate:
        counts.total > 0 && counts.top3 !== undefined
          ? counts.top3 / counts.total
          : null,
    }),
  );
}

/** 枠番別成績（全会場計）。履歴から数えた物があればそれを、無ければ日次の集計を使う。5走以上・枠番の順 */
export function courseStatsOf(historyCourseStats, aggregatedStats) {
  return (historyCourseStats ?? dailyCourseStats(aggregatedStats))
    .filter((row) => row.total >= 5)
    .sort((a, b) => a.course - b.course);
}

/** 横軸はレースごとの値（raceKey＝race_id）で、目盛りには日付だけを出す */
export const raceTick = (key) =>
  typeof key === "string" && key.length > 10 ? key.slice(2, 10) : key;

/** 推移グラフのツールチップの見出し。日付だけだと同じ日の2走を見分けられない（BOA-583） */
export const raceLabelOfWith = (t) => (label, payload) => {
  const d = payload?.[0]?.payload;
  if (!d?.venueCode) return label;
  return `${d.date} ${t(`venues.${d.venueCode}`, String(d.venueCode))} ${d.raceNo}R`;
};
