/**
 * /today の X 投稿の型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定）の材料（純関数）。
 *
 * 正本: hq drafts/x-today-type-20261027.md §6〜§9・§11（食い違えば §11）。
 *
 * - 指標は「そのコースに入ったときの1着」（決まり手を問わない）。段は 1号艇（1コース）と 4号艇（4コース、A1・A2 だけ）
 * - 比べる相手は「同じ級の全国の、そのコースの1着率」。級は各走の race_entries.grade で数える（RPC
 *   compute_today_course_win_stats、マイグレーション 179）。候補の級は今日の出走表の級
 * - 並べは両段とも「縮めた値（級の全国平均へ寄せたベータ二項）−その選手の級の全国平均」の大きい順。同率は件数の多い方
 * - 候補は率で先に絞らない（今の nigeCandidates は逃げ率70%で絞った後の数で、K にならない）。
 *   載せる条件（走数・期待1着数・級・前付け）だけで決め、全員を残す
 *
 * 朝の一覧の生成（scripts/daily/generate-morning-digest.js）が morning_digest_days.notes.courseWin に書き、
 * /today の計画（scripts/lib/snsTodayPlanner.js）と撮影用のページが同じ値を読む。
 */

/** notes.courseWin の形の版。形を変えたら上げる（読み手は版が違えば型 b を出さない） */
export const COURSE_WIN_VERSION = 1;

/** 段の定義。boat は今日の枠番、course は過去の実進入コース。grades が null なら全級 */
export const COURSE_WIN_SECTIONS = [
  { key: "c1", boat: 1, course: 1, grades: null, limit: 3 },
  // 4コースは B 級の期待1着数が5に届く走数（B1 66・B2 85）を持つ選手がほぼいない（DS r3 P0-1）ので A1・A2 だけ
  { key: "c4", boat: 4, course: 4, grades: ["A1", "A2"], limit: 2 },
];

/** 割合を出す最低の走数（number-wording.md「30件未満の範囲は割合を出さず件数だけ」） */
export const COURSE_WIN_MIN_RUNS = 30;
/** 期待度数の下限（1着・1着以外の両方。DS r3「期待1着数5」） */
export const COURSE_WIN_MIN_EXPECTED = 5;
/**
 * 縮めるときの事前の重み（ベータ二項の α+β）。本番の 2025-12〜2026-10-25 の、30走以上の選手の率のばらつきから
 * モーメント法で出した値は 1コース A1 41・A2 69・B1 22、4コース A1 84・A2 44（data/analysis/today-course-win-prior.json）。
 * 段・級で 22〜84 と幅があるので、真ん中の 40 を1つだけ使う（並べの順にだけ効き、関門にしない）
 */
export const COURSE_WIN_PRIOR_STRENGTH = 40;
/** 前付けの選手とみなす回数（窓の中で、2〜6号艇から1コースに入った回数）。目安（根拠なし、hq §10-1） */
export const FRONT_ENTRY_MIN = 3;

const GRADES = ["A1", "A2", "B1", "B2"];
const round = (value, digits) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** 期待度数の条件も満たす最低の走数（その級の全国の率 p0 で） */
export function minRunsFor(p0) {
  if (!(p0 > 0 && p0 < 1)) return Infinity;
  return Math.max(
    COURSE_WIN_MIN_RUNS,
    Math.ceil(COURSE_WIN_MIN_EXPECTED / p0),
    Math.ceil(COURSE_WIN_MIN_EXPECTED / (1 - p0)),
  );
}

/** 級の全国平均へ縮めた率（0〜1） */
export const shrinkRate = (wins, runs, p0, m = COURSE_WIN_PRIOR_STRENGTH) =>
  (wins + m * p0) / (runs + m);

/** 1標本の z（全国の級の率を既知として扱う。全国の母数は1万走前後で、選手の1標本に比べて十分に大きい） */
export const zScore = (wins, runs, p0) =>
  (wins / runs - p0) / Math.sqrt((p0 * (1 - p0)) / runs);

/**
 * 標準正規分布の分位点 Φ⁻¹(p)（Acklam の近似。相対誤差 1.15e-9 以下）
 * Bonferroni の線は normalQuantile(1 − 0.025 / K)（両側5%を K 人で割る）
 */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new Error(`分位点の p は 0〜1 の間: ${p}`);
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - low) return -normalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** その日の候補数 K からの Bonferroni の線（固定値にしない。K≈100 なら 3.48） */
export const bonferroniLine = (k) => normalQuantile(1 - 0.025 / k);

/**
 * RPC（179）の jsonb の1つを、行の配列（scope='grade'・'racer'、どの行にも窓）にする。形が違えば投げる
 * （集合で返すと PostgREST の上限1000行で黙って切れるので、関数は jsonb の1つで返す。system-architect の審査 P0）
 */
export function courseWinRowsFromJson(data) {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.grade) ||
    !Array.isArray(data.racer)
  )
    throw new Error("コース別1着率の RPC の返り値の形が違う");
  const w = { window_start: data.window_start, window_end: data.window_end };
  return [
    ...data.grade.map((g) => ({ scope: "grade", ...g, ...w })),
    ...data.racer.map((r) => ({ scope: "racer", ...r, ...w })),
  ];
}

/**
 * RPC の行（scope='grade' と 'racer'）と今日の出走表から、notes.courseWin を作る。
 * 候補は載せる条件を満たす全員（率で絞らない）。締切の時刻で切るのは送る側（送る時刻が日によって違うため）
 *
 * @param {{races: object[], entries: object[], rpcRows: object[], until: string}} input
 *   races: race_id・venue_code・race_number・start_time。entries: 欠場を除いた今日の出走（race_id・boat_number・racer_id・player_name・grade）
 */
export function buildCourseWinNotes({ races, entries, rpcRows, until }) {
  const gradeRows = rpcRows.filter((r) => r.scope === "grade");
  const racerRows = rpcRows.filter((r) => r.scope === "racer");
  if (!gradeRows.length)
    return {
      v: COURSE_WIN_VERSION,
      status: "unavailable",
      reason: "no_grade_rows",
    };
  const windows = new Set(
    rpcRows.map((r) => `${r.window_start}|${r.window_end}`),
  );
  if (windows.size !== 1)
    throw new Error(
      `コース別1着率の RPC の窓がそろっていない: ${[...windows].join(", ")}`,
    );
  const [windowStart, windowEnd] = [...windows][0].split("|");

  const baselines = {};
  for (const row of gradeRows) {
    if (!GRADES.includes(row.grade)) continue;
    baselines[`${row.grade}|${row.course}`] = {
      runs: Number(row.runs),
      wins: Number(row.wins),
    };
  }
  const stat = new Map(
    racerRows.map((r) => [
      `${r.racer_id}|${r.course}`,
      {
        runs: Number(r.runs),
        wins: Number(r.wins),
        offFrame: Number(r.off_frame_runs),
      },
    ]),
  );
  const raceById = new Map(races.map((r) => [r.race_id, r]));

  // 前付けの選手（2〜6号艇で、窓の中に枠2以上から1コースに入った回数が FRONT_ENTRY_MIN 以上）がいるレースは外す
  const frontRaces = [
    ...new Set(
      entries
        .filter(
          (e) =>
            e.boat_number >= 2 &&
            (stat.get(`${e.racer_id}|1`)?.offFrame ?? 0) >= FRONT_ENTRY_MIN,
        )
        .map((e) => e.race_id),
    ),
  ].sort();
  const front = new Set(frontRaces);

  const excludedCounts = {};
  const skip = (reason) => {
    excludedCounts[reason] = (excludedCounts[reason] ?? 0) + 1;
  };
  const candidates = [];
  for (const section of COURSE_WIN_SECTIONS) {
    for (const entry of entries) {
      if (entry.boat_number !== section.boat) continue;
      const race = raceById.get(entry.race_id);
      if (!race) continue;
      const tag = `${section.key}:`;
      if (section.grades && !section.grades.includes(entry.grade)) {
        skip(`${tag}grade_out`);
        continue;
      }
      const base = baselines[`${entry.grade}|${section.course}`];
      if (!base || base.runs < COURSE_WIN_MIN_RUNS) {
        skip(`${tag}no_baseline`);
        continue;
      }
      const p0 = base.wins / base.runs;
      // 全国の群にも期待度数の条件をかける（どちらかの群が足りなければ差を言わない、BOA-1157 と同じ）
      if (base.runs < minRunsFor(p0)) {
        skip(`${tag}baseline_small`);
        continue;
      }
      const s = stat.get(`${entry.racer_id}|${section.course}`);
      if (!s || s.runs < minRunsFor(p0)) {
        skip(`${tag}too_few_runs`);
        continue;
      }
      if (front.has(entry.race_id)) {
        skip(`${tag}front_race`);
        continue;
      }
      const shrunk = shrinkRate(s.wins, s.runs, p0);
      candidates.push({
        section: section.key,
        race_id: entry.race_id,
        venue_code: race.venue_code,
        race_number: race.race_number,
        start_time: race.start_time,
        boat_number: entry.boat_number,
        course: section.course,
        racer_id: entry.racer_id,
        // \s は全角の空白（U+3000）も含む
        racer_name: String(entry.player_name ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        grade: entry.grade,
        runs: s.runs,
        wins: s.wins,
        baseline_pct: round(p0 * 100, 2),
        shrunk_pct: round(shrunk * 100, 2),
        gap_pt: round((shrunk - p0) * 100, 2),
        z: round(zScore(s.wins, s.runs, p0), 3),
      });
    }
  }
  return {
    v: COURSE_WIN_VERSION,
    status: "ok",
    window: { start: windowStart, end: windowEnd, until },
    prior_strength: COURSE_WIN_PRIOR_STRENGTH,
    baselines,
    front_races: frontRaces,
    excluded_counts: excludedCounts,
    // その日の全レース分の候補の数（送る時刻で切る前）。送る時刻での K は送る側が数えて下書きに残す
    counts: Object.fromEntries(
      COURSE_WIN_SECTIONS.map((s) => [
        s.key,
        candidates.filter((c) => c.section === s.key).length,
      ]),
    ),
    candidates,
  };
}
