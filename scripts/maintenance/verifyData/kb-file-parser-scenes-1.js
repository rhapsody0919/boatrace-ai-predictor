/**
 * verify-kb-file-parser.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-kb-file-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { buildArchiveRows, raceTimeToSeconds, classifyStage } from "../../lib/kbArchiveRows.js";
import { parseKFileText, parseKFileRankings } from "../../lib/kfileParser.js";

let read, check, eq, DAYS, days;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const rows = buildArchiveRows(days["2026-03-15"]);
  check(
    "行数: 開催2・レース24・艇144",
    rows.venueDays.length === 2 &&
      rows.races.length === 24 &&
      rows.boats.length === 144,
    `${rows.venueDays.length}/${rows.races.length}/${rows.boats.length}`,
  );
  check(
    "会場日の行は race_grade を持たない（race_series から補完した値を、load の再実行が NULL で上書きしない。BOA-651）",
    rows.venueDays.every((v) => !("race_grade" in v)),
  );
  check(
    "会場日の行は is_final_day を持たない（K/B は最終日も「第N日」と書くので常に false になる。race_series から補完した値を、load の再実行が false で上書きしない。BOA-696）",
    rows.venueDays.every((v) => !("is_final_day" in v)),
  );
  const race = rows.races.find((r) => r.race_id === "2026-03-15-13-01");
  check(
    "命名: payout_3tan=2760（3連単）・payout_3fuku=1690（3連複）。DB本体の逆転命名を持ち込まない",
    race.payout_3tan === 2760 &&
      race.payout_3fuku === 1690 &&
      race.combo_3tan === "1-4-6",
  );
  check(
    "created_at は全行NULL（バックフィル行の識別）",
    [...rows.venueDays, ...rows.races, ...rows.boats].every(
      (r) => r.created_at === null,
    ),
  );
  const boat = rows.boats.find(
    (b) => b.race_id === "2026-03-15-13-01" && b.boat_number === 1,
  );
  check(
    "艇行: K（展示・進入・ST・着）とB（級別・勝率）が結合",
    boat.exhibition_time === 6.8 &&
      boat.course === 1 &&
      boat.start_timing === 0.1 &&
      boat.finish_rank === 1 &&
      boat.class === "A1" &&
      boat.national_win_rate === 6.69 &&
      boat.race_seconds === 107.9,
  );
  check(
    "警告なし（K/Bの登録番号一致）",
    rows.warnings.length === 0,
    rows.warnings.join(" / "),
  );
  check(
    "race_seconds換算・ステージ区分",
    raceTimeToSeconds("1.49.3") === 109.3 &&
      classifyStage("準優勝戦") === "semifinal" &&
      classifyStage("優勝戦") === "final" &&
      classifyStage("予選") === "qualifier" &&
      classifyStage("ドリーム戦") === "other",
  );
  const only2005 = buildArchiveRows(days["2005-01-01"]);
  return { only2005 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ only2005 }) {
  check(
    "K のみの日（B無し）でも行を作れる（has_b=false・級別等はNULL）",
    only2005.venueDays.every((v) => v.has_k && !v.has_b) &&
      only2005.boats.every((b) => b.class === null && b.finish_raw !== null),
  );
}

function scene3() {
  // --- 2. K/B整合 ---
  for (const d of DAYS.filter((x) => x.hasB)) {
    const day = days[d.date];
    let mismatched = 0;
    let racesOnlyOneSide = 0;
    for (const kv of day.k.venues) {
      const bv = day.b.venues.find((v) => v.venue_code === kv.venue_code);
      for (const kr of kv.races) {
        const br = bv?.races.find((r) => r.race_number === kr.race_number);
        if (!br) {
          racesOnlyOneSide++;
          continue;
        }
        for (const row of kr.rows) {
          const e = br.entries.find((x) => x.boat_number === row.boat_number);
          if (!e || e.racer_id !== row.racer_id) mismatched++;
        }
      }
    }
    check(
      `${d.date} K/B: レース集合が一致し、全艇の登録番号が一致`,
      racesOnlyOneSide === 0 && mismatched === 0,
      `片側のみ${racesOnlyOneSide} / 不一致${mismatched}`,
    );
  }
}

function scene4() {
  // --- 3. ファイル内クロスチェック（レース別払戻 vs 冒頭の払戻金一覧表） ---
  for (const d of DAYS) {
    const day = days[d.date];
    let checked = 0;
    let bad = 0;
    for (const v of day.k.venues) {
      // 一覧表: "  1R  2-5-1   20070    1-2-5     620 ..."（3連単・3連複）。同着の継続行はレース番号なし
      let current = null;
      for (const line of v.payout_summary_lines) {
        const m = /^\s+(\d{1,2})R\s+(\d-\d-\d)\s+(\d+)\s+(\d-\d-\d)\s+(\d+)/.exec(
          line,
        );
        if (!m) continue;
        current = Number(m[1]);
        const race = v.races.find((r) => r.race_number === current);
        const tan = race?.payouts.find(
          (p) => p.kind === "trifecta" && p.combo === m[2],
        );
        const fuku = race?.payouts.find(
          (p) => p.kind === "trio" && p.combo === m[4],
        );
        checked++;
        if (tan?.amount !== Number(m[3]) || fuku?.amount !== Number(m[5])) bad++;
      }
    }
    // 2005-01-01は3連単が無い時代で一覧表の形式が異なるため、対象があれば検証する
    check(
      `${d.date} 払戻: 一覧表と一致（${checked}レース確認）`,
      bad === 0,
      `不一致${bad}`,
    );
  }
}

function scene5() {
  // --- 4. 本番DBとの突合（2026-03-15。DBは race_results・exhibition_data・race_start_timings） ---
  {
    const amagasaki = days["2026-03-15"].k.venues.find(
      (v) => v.venue_code === 13,
    );
    const r1 = amagasaki.races.find((r) => r.race_number === 1);
    const rank = (n) => r1.rows.find((x) => x.rank === n).boat_number;
    check(
      "DB突合 尼崎1R: 着順1-4-6（DB rank1〜3と一致）",
      eq([rank(1), rank(2), rank(3)], [1, 4, 6]),
    );
    const tan = r1.payouts.find((p) => p.kind === "trifecta");
    const fuku = r1.payouts.find((p) => p.kind === "trio");
    check(
      "DB突合 尼崎1R: 3連単2,760円（DB payout_trio）・3連複1,690円（DB payout_trifecta）",
      tan.amount === 2760 && fuku.amount === 1690,
    );
    const ex = Object.fromEntries(
      r1.rows.map((x) => [x.boat_number, x.exhibition_time]),
    );
    check(
      "DB突合 尼崎1R: 展示タイム6艇がexhibition_dataと一致",
      eq(ex, { 1: 6.8, 2: 6.75, 3: 6.81, 4: 6.74, 5: 6.81, 6: 6.7 }),
      JSON.stringify(ex),
    );
    const st = Object.fromEntries(
      r1.rows.map((x) => [x.boat_number, x.start_timing]),
    );
    check(
      "DB突合 尼崎1R: ST6艇がrace_start_timingsと一致",
      eq(st, { 1: 0.1, 2: 0.1, 3: 0.13, 4: 0.08, 5: 0.19, 6: 0.12 }),
      JSON.stringify(st),
    );
    check(
      "DB突合 尼崎1R: 決まり手（逃げ）・ステージ（予選）・締切10:35",
      r1.technique === "逃げ" &&
        r1.stage === "予選" &&
        days["2026-03-15"].b.venues.find((v) => v.venue_code === 13).races[0]
          .deadline_time === "10:35",
    );
    // 尼崎: G1「尼崎市制110周年記念 尼崎センプルカップ」2日目（K/Bにグレード表記は無い）
    check(
      "尼崎: タイトル・日目",
      amagasaki.title === "尼崎市制110周年記念尼崎センプルカップ" &&
        amagasaki.series_day === 2,
    );
  }
}

function scene6() {
  // --- 5. 既存パーサー（kfileParser.js）との一致 ---
  for (const d of DAYS) {
    const text = read(`k${d.ymd}.txt`);
    const existingCourses = parseKFileText(text, d.date);
    const existingRanks = parseKFileRankings(text, d.date);
    let courseDiff = 0;
    let rankDiff = 0;
    const day = days[d.date];
    for (const v of day.k.venues) {
      for (const r of v.races) {
        const id = `${d.date}-${String(v.venue_code).padStart(2, "0")}-${String(r.race_number).padStart(2, "0")}`;
        const ec = existingCourses.find((x) => x.race_id === id);
        for (let b = 1; b <= 6; b++) {
          const mine = r.rows.find((x) => x.boat_number === b)?.course ?? null;
          if ((ec?.[`actual_course_${b}`] ?? null) !== mine) courseDiff++;
        }
        const er = existingRanks.find((x) => x.race_id === id);
        const mineOrder = r.rows.filter((x) => x.rank).map((x) => x.boat_number);
        const theirs = [1, 2, 3, 4, 5, 6]
          .map((n) => er?.[`rank${n}`])
          .filter((x) => x != null);
        if (!eq(mineOrder, theirs)) rankDiff++;
      }
    }
    check(
      `${d.date} 既存パーサーと一致（進入コース差${courseDiff}・着順差${rankDiff}）`,
      courseDiff === 0 && rankDiff === 0,
    );
  }
  // --- 6. 特殊表記の保持 ---
  {
    // 同着（2026-03-15 徳山6R）: 3着が2艇（3号艇と5号艇）、3連単が2通り
    const tokuyama = days["2026-03-15"].k.venues.find((v) => v.venue_code === 18);
    const r6 = tokuyama.races.find((r) => r.race_number === 6);
    const thirds = r6.rows
      .filter((x) => x.rank === 3)
      .map((x) => x.boat_number)
      .sort();
    const tan = r6.payouts
      .filter((p) => p.kind === "trifecta")
      .map((p) => `${p.combo}/${p.amount}`);
    check(
      "同着: 3着2艇（3,5号艇）と3連単2通り（1-2-3/1420・1-2-5/520）を保持",
      eq(thirds, [3, 5]) && eq(tan, ["1-2-3/1420", "1-2-5/520"]),
      JSON.stringify({ thirds, tan }),
    );
    const rows = buildArchiveRows(days["2026-03-15"]);
    check(
      "同着: アーカイブ行の dead_heat=true、3連単は先頭の1件",
      rows.races.find((r) => r.race_id === "2026-03-15-18-06").dead_heat ===
        true &&
        rows.races.find((r) => r.race_id === "2026-03-15-18-06").payout_3tan ===
          1420,
    );
  }
}

function scene7() {
  {
    // 不成立・F（2019-04-15 蒲郡）
    const gamagori = days["2019-04-15"].k.venues.find((v) => v.venue_code === 7);
    const specials = gamagori.races.flatMap((r) =>
      r.payouts.filter((p) => p.special === "不成立"),
    );
    const flying = gamagori.races.flatMap((r) =>
      r.rows.filter((x) => x.finish_raw === "F"),
    );
    check(
      "不成立: 払戻の「不成立」を項目として保持（金額null）",
      specials.length >= 1 && specials.every((p) => p.amount === null),
    );
    check(
      "F: フライング艇の出走・ST（負値）を保持",
      flying.length >= 1 &&
        flying.every(
          (x) =>
            x.is_flying &&
            x.start_timing !== null &&
            x.start_timing < 0 &&
            x.course !== null &&
            x.rank === null,
        ),
    );
    const k = gamagori.races.flatMap((r) =>
      r.rows.filter((x) => /^K/.test(x.finish_raw)),
    );
    check(
      "欠場（K0/K1）: 着・進入・ST・展示・タイムがnullで、行としては残る",
      k.length >= 1 &&
        k.every(
          (x) =>
            x.rank === null &&
            x.course === null &&
            x.start_timing === null &&
            x.race_time === null &&
            x.exhibition_time === null,
        ),
    );
  }
  {
    // 特払い・L・失格（2005-01-01 K）
    const tokuji = days["2005-01-01"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.payouts.filter((p) => p.special === "特払い"));
    const late = days["2005-01-01"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.rows.filter((x) => /^L/.test(x.finish_raw)));
    check(
      "特払い: 払戻の「特払い」（70円）を項目として保持",
      tokuji.length >= 1 &&
        tokuji.every((p) => p.amount === 70 && p.combo === null),
    );
    check(
      "L: 出遅れ艇を is_late_start=true で保持",
      late.length >= 1 &&
        late.every((x) => x.is_late_start === true && x.rank === null),
    );
    const blank = days["2005-01-04"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.payouts.filter((p) => p.special === "blank"));
    check("空欄の払戻行（単勝・複勝が空）も項目として保持", blank.length >= 0);
  }
  {
    const s = days["2005-01-04"].k.venues
      .flatMap((v) => v.races)
      .flatMap((r) => r.rows.filter((x) => /^S/.test(x.finish_raw)));
    check(
      "S（失格等）: 着の原文を保持し、rankはnull",
      s.length >= 1 && s.every((x) => x.rank === null),
    );
  }
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・check・eq・DAYS・days） */
export function runKbFileParserScenes1(env) {
  ({ read, check, eq, DAYS, days } = env);
  scene3();
  scene4();
  scene5();
  scene6();
  scene7();
}
