/**
 * verify-series-points-stage-rules.js の一部の場面。大きさの関所のため、本文を字のまま移した。verify ではない。
 * check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

/** verify の元の 606〜792 行（2つに割った） */
export function absentScenesLate({ listSeriesFinishes, listAbsentOnlyRacers, runFinishLabel, officialMarkOf, dayCenter, dayTickLabels, layoutTrendByDate, buildRacerScopedRaceRows, check, meetTabSource, base, withPrelim, board, RA, RB }) {
  absentScenesLatePart1({ listSeriesFinishes, runFinishLabel, officialMarkOf, buildRacerScopedRaceRows, check, meetTabSource, base, withPrelim, RA, RB });
  absentScenesLatePart2({ listAbsentOnlyRacers, dayCenter, dayTickLabels, layoutTrendByDate, check, board });
}

function absentScenesLatePart1({ listSeriesFinishes, runFinishLabel, officialMarkOf, buildRacerScopedRaceRows, check, meetTabSource, base, withPrelim, RA, RB }) {
  {
    // 本番STの行そのものが無い欠場（他艇の行はある）も、履歴で「欠場」と出す
    // （2026-06-13 浜名湖5R・12R の中岡正彦が「着外(順位不明)」になっていた）。
    // 整形は getRacerScopedRaceStats から racerScopedRaceRows.js へ移した（BOA-1022）
    // 行の整形（buildRacerScopedRaceRows）を呼んで見る。RA は他艇の行だけ・RB は「欠」の行・RC は行が無い（取得漏れは欠場にしない）
    const RC = `${RA.slice(0, 14)}03`, ids = [RA, RB, RC];
    const scoped = buildRacerScopedRaceRows({ entries: ids.map((race_id) => ({ race_id, boat_number: 4 })), raceRows: ids.map((race_id) => ({ race_id, race_date: race_id.slice(0, 10), venue_code: 5 })),
      resultRows: ids.map((race_id) => ({ race_id, rank1: 1 })), exhibitionRows: [], conditionRows: [],
      startTimingRows: [{ race_id: RA, boat_number: 1, start_timing: 0.12 }, { race_id: RB, boat_number: 4, start_timing: null, finish_mark: "欠" }] });
    check("選手の履歴は、本番STの行が無い欠場も欠場として扱う", scoped.map((r) => [r.raceId, r.absent]), [[RA, true], [RB, true], [RC, false]]);
    const meetTab = meetTabSource;
    check(
      "全走欠場の選手を選んだ詳細に欠場の見出し、「欠」があれば意味の注記を出す",
      meetTab.includes('t("meetTab.absentDetail")') &&
        // 「欠」を含む走の判定で注記を出し分けていること。条件を変数に切り出す・
        // 段落を組み替える（BOA-714・BOA-738）たびに書き方の照合が外れたので、
        // 変数名と JSX の書き方には依存しない（判定の式と、その変数で注記を出すことだけ見る）
        /(\w+) = [^;]*r\.finishes\.includes\(FINISH_ABSENT\)[\s\S]*\b\1 &&[\s\S]{0,40}t\("meetTab\.finishAbsentNote"\)/.test(
          meetTab,
        ),
      true,
    );
  }
  // 推移の点の下に出す着順（BOA-537）。数字・F・欠・公式の記号。推測で「失」と書かない
  {
    const res = {
      rank1: 3,
      rank2: 1,
      rank3: 6,
      rank4: 2,
      rank5: 4,
      rank6: null,
    };
    check(
      "runFinishLabel: 着順・F・欠・公式の記号・未実施",
      [
        runFinishLabel(res, 1, { start_timing: 0.12 }, true),
        runFinishLabel(res, 5, { start_timing: 0.2, is_flying: true }, true),
        runFinishLabel(res, 5, { start_timing: null, finish_mark: "欠" }, true),
        runFinishLabel(res, 5, null, true),
        runFinishLabel(res, 5, { start_timing: 0.18, finish_mark: "転" }, true),
        runFinishLabel(res, 5, { start_timing: 0.18, finish_mark: null }, true),
        runFinishLabel(null, 1, null, false),
      ],
      [2, "F", "欠", "欠", "転", null, null],
    );
  }
  // 着順が付かない走は、比較表の並び・推移・日別の表で同じ公式の記号を出す（BOA-537）
  check(
    "officialMarkOf: 記号だけを返す（数字・空・null は記号でない）",
    [
      officialMarkOf("落"),
      officialMarkOf("転"),
      officialMarkOf("3"),
      officialMarkOf(""),
      officialMarkOf(null),
    ],
    ["落", "転", null, null, null],
  );
  check(
    "着順の並び: 着順の無い走は公式の記号（無ければ null＝画面は「失」）",
    listSeriesFinishes(
      [
        {
          ...base,
          raceId: "2026-09-23-20-01",
          boatNumber: 6,
          started: true,
          finishMark: "落",
        },
        { ...base, raceId: "2026-09-23-20-02", boatNumber: 6, started: true },
      ],
      withPrelim,
    ),
    ["落", null],
  );
  check(
    "着順の並び: 着欄の記号が未取得でも、フライングの走は「失」ではなく F（推移の点と同じ。BOA-589）",
    listSeriesFinishes(
      [
        {
          ...base,
          raceId: "2026-09-23-20-03",
          boatNumber: 6,
          started: true,
          isFlying: true,
        },
      ],
      withPrelim,
    ),
    ["F"],
  );
}

function absentScenesLatePart2({ listAbsentOnlyRacers, dayCenter, dayTickLabels, layoutTrendByDate, check, board }) {
  // 6艇の推移の横軸を日付にする配置（BOA-538）
  {
    const days = ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23"];
    const a = layoutTrendByDate(
      [
        { date: "2026-09-20" },
        { date: "2026-09-21" },
        { date: "2026-09-21" },
        { date: "2026-09-23" },
      ],
      days,
    );
    check(
      "日付の横軸: 日の位置に置き、1日2走は左右にずらし、走らない日をまたぐと線を切る",
      [
        Math.abs(a.xs[0] - dayCenter(0, 4)) < 1e-9,
        a.xs[1] < dayCenter(1, 4) && a.xs[2] > dayCenter(1, 4),
        Math.abs((a.xs[1] + a.xs[2]) / 2 - dayCenter(1, 4)) < 1e-9,
        Math.abs(a.xs[3] - dayCenter(3, 4)) < 1e-9,
        a.breakBefore,
      ],
      [true, true, true, true, [false, false, false, true]],
    );
    const one = layoutTrendByDate([{ date: "2026-09-20" }], ["2026-09-20"]);
    check("日付の横軸: 節の日が1日だけなら中央", one.xs, [0.5]);
    // 2走が続く行でも、同じ日の2点は日をまたぐ間より近い（等間隔に見えない。ファン評価）
    const pairs = layoutTrendByDate(
      ["2026-09-23", "2026-09-23", "2026-09-24", "2026-09-24"].map((date) => ({
        date,
      })),
      ["2026-09-23", "2026-09-24", "2026-09-25"],
    );
    check(
      "日付の横軸: 各走の日の位置（centers）を返し、同じ日の2走は同じ位置",
      [
        pairs.centers[0] === pairs.centers[1],
        pairs.centers[2] === pairs.centers[3],
      ],
      [true, true],
    );
    check(
      "日付の横軸: 同じ日の2点は、日をまたぐ間隔より近い",
      pairs.xs[1] - pairs.xs[0] < pairs.xs[2] - pairs.xs[1],
      true,
    );
    const oneDay = layoutTrendByDate(
      [{ date: "2026-09-20" }, { date: "2026-09-20" }],
      ["2026-09-20"],
    );
    check(
      "日付の横軸: 1日だけの節の2走は中央の近くに寄る（全幅の2割）",
      Math.abs(oneDay.xs[1] - oneDay.xs[0] - 0.2) < 1e-9,
      true,
    );
    check(
      "日付の目盛り: 最初の日と月が変わった日だけ「月/日」、ほかは日だけ",
      dayTickLabels([
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ]),
      ["9/28", "29", "30", "10/1", "2"],
    );
    // 端の日の2走も、ずらした両方が 0〜1 の中に収まる（端で潰れて重ならない）
    const edge = layoutTrendByDate(
      [
        { date: "2026-09-20" },
        { date: "2026-09-20" },
        { date: "2026-09-25" },
        { date: "2026-09-25" },
      ],
      [
        "2026-09-20",
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
      ],
    );
    check(
      "日付の横軸: 端の日の2走も同じ幅でずれ、0〜1に収まる",
      edge.xs.every((v) => v >= 0 && v <= 1) &&
        Math.abs(edge.xs[1] - edge.xs[0] - (edge.xs[3] - edge.xs[2])) < 1e-9 &&
        edge.xs[1] - edge.xs[0] > 0.05,
      true,
    );
  }
  check(
    "男女Ｗ優勝戦の節では別シリーズの全走欠場者を返さない",
    listAbsentOnlyRacers({ ...board, seriesRacerIds: [1001, 3003] }),
    [],
  );
}
