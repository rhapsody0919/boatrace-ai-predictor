/**
 * 選手ページの「公式の期別成績」と「進入コース別成績（公式）」の表示用の値を作る（純関数、GS00）。
 *
 * 元は racer_period_stats（公式の期別成績ファイル fan）。期の呼び名・列の定義は official-data-spec の確認
 * （2026-10-28）、出してよい範囲は data-scientist の確認（docs/design/racer-period-stats/analysis/display-scope.md）。
 *
 * - (Y,1) は「Y年前期」（集計 (Y-1)/05/01〜(Y-1)/10/31）、(Y,2) は「Y年後期」（集計 (Y-1)/11/01〜Y/04/30）
 * - win_rate は公式の勝率（着順点の平均、点）。top2_rate は2連対率（%、小数1桁）
 * - 3連対率は DB に無いので、全コースの3着回数（c{N}_p3 の合計）から出す
 * - コースは進入コース（枠番ではない）。コース別の率は着回数の合計から出す（(Σp1+Σp2)/Σ進入）
 * - 進入数が10未満の率は出さない（null）。10〜29は「参考」、30以上はそのまま
 */

export const COURSE_RATE_MIN_ENTRIES = 10;
export const COURSE_RATE_FIRM_ENTRIES = 30;
/** コース別は直近3期を合算する（1期だと1コースあたりの進入が少ない。A1 の中央値で6コース16走） */
export const COURSE_SUM_PERIODS = 3;

const COURSES = [1, 2, 3, 4, 5, 6];

const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** 期の公式の呼び名（例「2026年後期」） */
export function periodLabel(periodYear, periodNo) {
  return `${periodYear}年${periodNo === 1 ? "前期" : "後期"}`;
}

/** 期の級が使われる期間（例 (2026,2) →「2026/7〜12」） */
export function periodAppliedLabel(periodYear, periodNo) {
  return periodNo === 1 ? `${periodYear}/1〜6` : `${periodYear}/7〜12`;
}

/** 期の集計期間（例「2025/11/01〜2026/04/30」） */
export function periodRangeLabel(calcFrom, calcTo) {
  const slash = (d) => (d ?? "").replaceAll("-", "/");
  return `${slash(calcFrom)}〜${slash(calcTo)}`;
}

const ratio = (hit, n) => (n > 0 ? hit / n : null);

/**
 * 期ごとの行（新しい期が先）。出走0の期は率を null にする（公式は「-」）
 * @param {object[]} rows racer_period_stats の行
 */
export function buildPeriodRows(rows) {
  return [...(rows ?? [])]
    .sort((a, b) => b.period_year - a.period_year || b.period_no - a.period_no)
    .map((r) => {
      const starts = num(r.starts) ?? 0;
      const firsts = num(r.first_count) ?? 0;
      const seconds = num(r.second_count) ?? 0;
      // コース別の列が全部 NULL の期は3着の回数が分からないので、3連対率を出さない
      const hasCourseCols = COURSES.some((c) => num(r[`c${c}_p3`]) !== null);
      const thirds = COURSES.reduce(
        (sum, c) => sum + (num(r[`c${c}_p3`]) ?? 0),
        0,
      );
      return {
        key: `${r.period_year}-${r.period_no}`,
        label: periodLabel(r.period_year, r.period_no),
        range: periodRangeLabel(r.calc_from, r.calc_to),
        // grade はその期の成績で決まった級（適用は applied の期間）
        grade: r.grade ?? null,
        applied: periodAppliedLabel(r.period_year, r.period_no),
        winRate: starts > 0 ? num(r.win_rate) : null,
        top2Rate: starts > 0 ? num(r.top2_rate) : null,
        top3Rate:
          starts > 0 && hasCourseCols
            ? ratio(firsts + seconds + thirds, starts) * 100
            : null,
        starts,
        firsts,
        seconds,
        finals: num(r.finals) ?? 0,
        wins: num(r.wins) ?? 0,
        avgSt: starts > 0 ? num(r.avg_st) : null,
      };
    });
}

/**
 * 進入コース別（直近 periods 期の合算）。出走のある期を新しい順に periods 個使う（出走0の期は数えない）。
 * 平均STは、期ごとの値を「進入 − F − L − 欠場」で重み付けした平均（公式の期の値からの近似。±0.01以内が99.9%、data-scientist）。
 * 公式は F・L を除いた走で ST を平均し、該当する走が無いと 0 を入れるので、0 は重みに入れない（data-accuracy-verifier）。
 * 平均スタート順位は合算の妥当性を確かめていないので出さない
 * @returns {{ periods: object[], courses: object[] } | null} 行が無ければ null
 */
export function buildCourseRows(rows, periods = COURSE_SUM_PERIODS) {
  const used = [...(rows ?? [])]
    // 出走があり、コース別の列が入っている期だけを数える
    .filter(
      (r) =>
        (num(r.starts) ?? 0) > 0 &&
        COURSES.some((c) => num(r[`c${c}_entries`]) !== null),
    )
    .sort((a, b) => b.period_year - a.period_year || b.period_no - a.period_no)
    .slice(0, periods);
  if (used.length === 0) return null;

  const courses = COURSES.map((c) => {
    let entries = 0;
    const placeCounts = [0, 0, 0];
    let stWeighted = 0;
    let stN = 0;
    for (const r of used) {
      const n = num(r[`c${c}_entries`]) ?? 0;
      entries += n;
      for (let p = 0; p < 3; p += 1) {
        placeCounts[p] += num(r[`c${c}_p${p + 1}`]) ?? 0;
      }
      const st = num(r[`c${c}_avg_st`]);
      const stRuns =
        n -
        (num(r[`c${c}_f`]) ?? 0) -
        (num(r[`c${c}_l0`]) ?? 0) -
        (num(r[`c${c}_l1`]) ?? 0) -
        (num(r[`c${c}_k0`]) ?? 0) -
        (num(r[`c${c}_k1`]) ?? 0);
      if (stRuns > 0 && st !== null && st > 0) {
        stWeighted += st * stRuns;
        stN += stRuns;
      }
    }
    const show = entries >= COURSE_RATE_MIN_ENTRIES;
    const [p1, p2, p3] = placeCounts;
    return {
      course: c,
      entries,
      // reliability: none（出さない）/ reference（参考）/ firm
      reliability: !show
        ? "none"
        : entries < COURSE_RATE_FIRM_ENTRIES
          ? "reference"
          : "firm",
      winRate: show ? ratio(p1, entries) * 100 : null,
      top2Rate: show ? ratio(p1 + p2, entries) * 100 : null,
      top3Rate: show ? ratio(p1 + p2 + p3, entries) * 100 : null,
      avgSt: show && stN > 0 ? stWeighted / stN : null,
    };
  });

  // 合算に使った期が連続しているか（出走0の期を飛ばすと連続しない）
  const contiguous = used.every((r, i) => {
    if (i === 0) return true;
    const prev = used[i - 1];
    const expected =
      prev.period_no === 2
        ? [prev.period_year, 1]
        : [prev.period_year - 1, 2];
    return r.period_year === expected[0] && r.period_no === expected[1];
  });

  return {
    contiguous,
    periods: used.map((r) => ({
      label: periodLabel(r.period_year, r.period_no),
      range: periodRangeLabel(r.calc_from, r.calc_to),
    })),
    courses,
  };
}
