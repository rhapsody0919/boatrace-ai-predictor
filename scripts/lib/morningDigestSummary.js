/**
 * generate-morning-digest.js のまとめの部品（DB に触らない）。
 * 順位付け・モーター出走数の対象・day 行と報告の組み立て・まとめの出力。出力の文は元の形のまま。
 */
import {
  EXTRACTION_THRESHOLDS,
  IN_FAVORABLE_METRICS,
  NIGASHI_LIST_COURSE,
  computeFeaturedScore,
} from "../../src/utils/digestMetrics.js";

/** フライングの判定に使う着順の記号（race_results.finish_mark）が全レースで埋まっている最初の日 */
export const FLYING_DATA_COMPLETE_FROM = "2026-09-21";

// ---------------------------------------------------------------------------

/** 注目 → 逃げ → まくり → 逃がし → フライング → 帰郷 の順に並べ、rank（セクション内の並び順、1始まり）と digest_date を付ける */
export function rankRows({ featured, sections, flying, returned }, date) {
  const ordered = [
    ...(featured ? [featured] : []),
    ...sections.nige,
    ...sections.makuri,
    ...sections.nigashi,
    ...flying,
    ...returned.rows,
  ];
  const rankBySection = new Map();
  return ordered.map((r) => {
    const next = (rankBySection.get(r.section) ?? 0) + 1;
    rankBySection.set(r.section, next);
    return { ...r, digest_date: date, rank: next };
  });
}

/** 会場公式のモーター出走数（未使用の新モーターの判定、BOA-702）を引く対象（会場×モーター番号） */
export function motorTargetsOf(ranked, entries) {
  const motorNumberOf = new Map(
    entries.map((e) => [`${e.race_id}|${e.boat_number}`, e.motor_number]),
  );
  return ranked
    .filter((r) => r.motor_2rate !== null && r.race_id)
    .map((r) => ({
      venue_code: r.venue_code,
      motor_number: motorNumberOf.get(`${r.race_id}|${r.boat_number}`),
    }))
    .filter((t) => t.motor_number != null);
}

export function logMotorSummary(rows, motorRaceCounts) {
  const motorRows = rows.filter((r) => r.motor_2rate !== null);
  const unusedMotorRows = motorRows.filter(
    (r) => r.motor_2rate === 0 && r.motor_race_count === 0,
  );
  console.log(
    `  モーター出走数: ${motorRows.filter((r) => r.motor_race_count !== null).length}/${motorRows.length} 行で判明、` +
      `未使用の新モーター（2連率0・出走数0）${unusedMotorRows.length} 行` +
      (unusedMotorRows.length > 0
        ? `（${unusedMotorRows.map((r) => `${r.section}:${r.race_id}#${r.boat_number}`).join(", ")}）`
        : ""),
  );
  if (motorRaceCounts.failed > 0) {
    console.log(
      `  ⚠️ モーター出走数の取得に ${motorRaceCounts.failed} 件失敗しました（該当行は motor_race_count を NULL で書きます）`,
    );
  }
}

const nigashiListCount = (sections) =>
  sections.nigashi.filter((r) => r.course === NIGASHI_LIST_COURSE).length;
const nigashiCourse3Count = (sections) =>
  sections.nigashi.filter((r) => r.course !== NIGASHI_LIST_COURSE).length;

export function logSectionSummary({
  featured,
  sections,
  flying,
  returned,
  rows,
}) {
  console.log(
    `\n注目 ${featured ? 1 : 0} / 逃げ ${sections.nige.length}（候補${sections.nigeTotal}）` +
      ` / まくり ${sections.makuri.length}` +
      ` / 逃がし（2号艇） ${nigashiListCount(sections)}` +
      `（3号艇 ${nigashiCourse3Count(sections)}）` +
      ` / フライング ${flying.length} / 帰郷 ${returned.rows.length}` +
      ` / 合計 ${rows.length} 行`,
  );
  if (featured) {
    console.log(
      `  注目: ${featured.race_id} ${featured.racer_name}（${featured.detail.from} score=${featured.detail.score}）`,
    );
  }
  if (returned.suppressed.length > 0) {
    console.log(
      `  ⚠️ 節境界とみなして帰郷判定から除外した会場: ${returned.suppressed.join(", ")}`,
    );
  }
}

/** morning_digest_days の1行 */
export function buildDayRow({
  date,
  races,
  statRows,
  featured,
  sections,
  flying,
  returned,
  rows,
  volatilityMap,
  courseWin,
}) {
  const clamped = rows.filter((r) => r.detail?.clampedPredicted).length;
  return {
    digest_date: date,
    venue_count: new Set(races.map((r) => r.venue_code)).size,
    race_count: races.length,
    window_start: statRows[0]?.window_start ?? null,
    window_end: statRows[0]?.window_end ?? null,
    window_days: statRows[0]?.window_days ?? null,
    flying_data_complete: date >= FLYING_DATA_COMPLETE_FROM,
    suppressed_venues: returned.suppressed,
    notes: {
      sectionCounts: {
        featured: featured ? 1 : 0,
        nige: sections.nige.length,
        nigeCandidates: sections.nigeTotal,
        makuri: sections.makuri.length,
        // 一覧に出す2号艇の件数。3号艇（折りたたみの中）は別に数える
        nigashi: nigashiListCount(sections),
        nigashiCourse3: nigashiCourse3Count(sections),
        flying: flying.length,
        returned: returned.rows.length,
      },
      clampedPredictedRows: clamped,
      volatilityAvailable: volatilityMap.size,
      thresholds: EXTRACTION_THRESHOLDS,
      // /today の X 投稿の型 b（コース別1着率）の候補の全数（src/utils/todayCourseWin.js）
      courseWin,
    },
  };
}

/** 実行の報告（report）と、会場平均に使ったセルの内訳（byGradeReport） */
export function buildReport({ date, dayRow, rows, courseWin }) {
  const byGradeReport = {};
  for (const r of rows) {
    const k = r.detail?.baselineGrade;
    if (k) byGradeReport[k] = (byGradeReport[k] ?? 0) + 1;
  }
  const report = {
    targetDate: date,
    venueCount: dayRow.venue_count,
    raceCount: dayRow.race_count,
    sectionCounts: dayRow.notes?.sectionCounts,
    baselineGrades: byGradeReport,
    courseWin:
      courseWin.status === "ok"
        ? { status: "ok", counts: courseWin.counts, window: courseWin.window }
        : { status: courseWin.status, reason: courseWin.reason },
  };
  return { report, byGradeReport };
}

export function logCompleteness(races, entries) {
  console.log(
    `  完全性チェック: OK（${new Set(races.map((r) => r.venue_code)).size}会場 ${races.length}レース ${entries.length}艇）`,
  );
}

/** 完全性チェックを満たさないときの出力と戻り値（書き込まない） */
export function incompleteResult(date, problems) {
  console.log("\n完全性チェックを満たさないため、書き込まずに終了します:");
  for (const p of problems) console.log(`  - ${p}`);
  console.log(
    "\n（次回の実行で再試行されます。最終回でも満たせない場合はジョブを失敗させてください）",
  );
  return {
    outcome: "ok",
    incomplete: true,
    rowsWritten: 0,
    report: { targetDate: date, problems },
  };
}

export function logDryRun(rows, byGradeReport) {
  console.log("\n[dry-run] 書き込みません。先頭5行:");
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  ${r.section}#${r.rank} ${r.race_id ?? "-"} ${r.racer_name} ` +
        `${r.metric_value ?? "-"}% 地力${r.metric_skill_delta ?? "-"}pt n=${r.sample_size ?? "-"}` +
        ` 会場平均${r.metric_venue_baseline ?? "-"}%(${r.detail?.baselineGrade ?? "-"})`,
    );
  }
  // 会場平均にどのセルを使ったかの内訳。画面のラベルがこれと一致している必要がある
  console.log(
    `  会場平均に使ったセル: ${Object.entries(byGradeReport)
      .map(([k, v]) => `${k}=${v}`)
      .join(" / ")}`,
  );
  console.log("\n完了しました（dry-run のため書き込んでいません）");
}

/**
 * 注目レースの方向一致度に使う当日の値を、旧のイン崩れ指数（volatility_percentile）から
 * イン崩れ注意度（in_caution_pct）に替えるか（BOA-822、plan §5）。digest のスクリプトはブラウザの
 * 機能フラグを読めないので別の定数にし、公開の PR で IN_CAUTION_PUBLIC と一緒に true にする。
 * false の間も in_caution_* の3列は書く（列が増えるだけで、注目レース・画面は旧の値のまま）。
 */
export const MORNING_DIGEST_IN_CAUTION = false;

/** イン崩れ指数・注意度が1件も無い（predictions が未生成）ときの警告 */
export function warnNoVolatility(volatilityMap, inCautionMap = new Map()) {
  const signal = MORNING_DIGEST_IN_CAUTION ? inCautionMap : volatilityMap;
  if (volatilityMap.size === 0) {
    console.log(
      "  ⚠️ イン崩れ指数が1件も取得できませんでした（predictions が未生成）。volatility_percentile は NULL で書きます",
    );
  }
  if (inCautionMap.size === 0) {
    console.log(
      "  ⚠️ イン崩れ注意度が1件も取得できませんでした（predictions が未生成か、夜の表の欠け）。in_caution_* は NULL で書きます",
    );
  }
  if (signal.size === 0) console.log("  ⚠️ 注目レースは生成しません");
}

function featuredSignal(row, useInCaution) {
  return useInCaution ? row.in_caution_pct : row.volatility_percentile;
}

function featuredSignalSentence(row, useInCaution) {
  if (useInCaution) {
    return (
      `イン崩れ注意度は${row.in_caution_pct}%（1号艇と、他の艇で一番高い全国勝率の差が同じくらいの` +
      `全国の過去レース${Number(row.in_caution_n).toLocaleString("ja-JP")}件で、` +
      `1号艇が1着を逃した割合）で、`
    );
  }
  return `AIが当日条件から算出したイン崩れ指数は${row.volatility_percentile}%で、`;
}

/**
 * 「今日の注目レース」。**地力(pt)のまま指標横断で比較しない**。
 * ベースレートが逃げ53%・まくり4%と桁違いなので、zスコアに標準化してから
 * 当日の値（イン崩れ指数か注意度。どちらも 0〜100）との方向一致度を掛ける（plan.md §3.3、レビュー指摘C-1）。
 *
 * @param {object} sections
 * @param {{useInCaution?: boolean}} [opts] 既定は MORNING_DIGEST_IN_CAUTION
 */
export function pickFeatured(
  sections,
  { useInCaution = MORNING_DIGEST_IN_CAUTION } = {},
) {
  const candidates = [
    ...(sections.nigeAll ?? sections.nige),
    ...sections.makuri,
    // 逃がしは注目レースの候補にしない（抽出の当たりと1号艇の1着に差が無い。2026-11-04、digestMetrics.js NOT_FEATURED_METRICS）
  ]
    .filter((r) => (featuredSignal(r, useInCaution) ?? null) !== null)
    .map((r) => ({
      row: r,
      score: computeFeaturedScore({
        metric: r.section,
        rate: r.metric_value,
        expected: r.metric_expected,
        n: r.sample_size,
        volatilityPercentile: featuredSignal(r, useInCaution),
      }),
    }))
    .filter((c) => c.score !== null);

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => b.score - a.score || a.row.race_id.localeCompare(b.row.race_id),
  );
  const best = candidates[0];

  const metricLabel = {
    nige: "逃げ切った割合",
    makuri: "まくりで1着になった割合",
  }[best.row.section];
  const direction = IN_FAVORABLE_METRICS.has(best.row.section)
    ? "イン有利"
    : "イン不利（1号艇が崩れる）";
  // 集計した事実だけで書く。推定値（metric_predicted）は文にも出さない
  // （2026-09-24、UIと同じ改訂。予想を提示している体裁を避ける）
  const reason =
    `この選手が${best.row.course}コースに入ったとき${metricLabel}は、` +
    `全国${best.row.sample_size}走で${best.row.metric_value}%。` +
    `この会場の平均は${best.row.metric_venue_baseline}%です。` +
    featuredSignalSentence(best.row, useInCaution) +
    `過去の実績と当日条件がどちらも「${direction}」方向を向いています。`;

  return {
    ...best.row,
    section: "featured",
    detail: {
      ...best.row.detail,
      reason,
      score: best.score,
      from: best.row.section,
    },
  };
}

/**
 * 各行に motor_race_count を付ける（純粋関数）。motor_2rate が NULL の行・モーター番号が分からない行・
 * スナップショットが無い行は NULL。全行に同じキーを持たせる（バルク INSERT で行ごとにキーの集合を変えない）。
 *
 * @param {Array<Object>} rows
 * @param {Array<{race_id: string, boat_number: number, motor_number: number|null}>} entries
 * @param {Map<string, number|null>} counts fetchMotorRaceCounts の counts
 */
export function attachMotorRaceCounts(rows, entries, counts) {
  const motorByBoat = new Map(
    entries.map((e) => [`${e.race_id}|${e.boat_number}`, e.motor_number]),
  );
  return rows.map((r) => {
    const motorNumber =
      r.race_id && r.boat_number != null
        ? motorByBoat.get(`${r.race_id}|${r.boat_number}`)
        : null;
    const count =
      r.motor_2rate !== null && motorNumber != null
        ? counts.get(`${r.venue_code}|${motorNumber}`)
        : null;
    return { ...r, motor_race_count: count ?? null };
  });
}
