/**
 * verify-pretest-row-pick.js - 前検タイムの「行の選び方」が成り立ち続けるかを検査する
 * （[BOA-451](https://linear.app/boat-ai/issue/BOA-451) / phase a FR-4a）。
 *
 * ## なぜ要るか
 *
 * `motor_pretest_stats` は「1節に1行」ではない。取得ジョブが節の期間中にスナップショットを
 * 取り直すため、**同じ節・同じ選手の行が複数日ぶん**ある（例: 桐生の9月は 09-20 / 09-23 /
 * 09-24 / 09-25 が1つの節）。画面は2箇所でこの表を読むが、採る行が違う。
 *
 *   - 今節タブ（`getMeetScoreboard`）: 節の**最も古い**行
 *   - モータ情報タブ（`getRaceMotorBreakdown`）: 当日以前6日以内の**最新**行
 *
 * 別々の採り方でも数字が食い違わないのは、**節の中で前検タイム・前検順位が変わらない**
 * という性質に乗っているから（2026-09-28の実測で31,268区間すべて単一値）。この前提が
 * 崩れると、同じレースの2つのタブが違う前検タイムを出す。画面を見ても気づけない
 * （どちらも「それらしい秒数」が出るだけ）ので、データ側で検査する。
 *
 * ## 何を見るか
 *
 *   A. 節の中で `pretest_time` / `pretest_rank` が変動する区間が無いこと
 *      → あると2つのタブが食い違う
 *   B. 6日ルックバックで**前の節の行**を拾わないこと
 *      → 拾うと、今節と無関係な前検タイムをモータ情報タブが出す
 *   C. カバー率が大きく落ちていないこと（目安 90%以上。2026-09-28 実測 94.6%）
 *      → 取得ジョブが止まると列が消えるが、画面は「列ごと出さない」ので気づけない
 *
 * ## 使い方
 *
 *   node --env-file=.env.local scripts/maintenance/verify-pretest-row-pick.js
 *   node --env-file=.env.local scripts/maintenance/verify-pretest-row-pick.js --days 120
 *
 * 読み取り専用。実Supabaseへの接続が要るため tier=manual（CIでは走らない）。
 * 終了コード: 0=合格 / 1=A・Bの違反、またはカバー率が閾値未満。
 */
import { supabase } from "../lib/supabaseClient.js";

/** モータ情報タブと同じルックバック（src/utils/pretestRows.js の PRETEST_LOOKBACK_DAYS） */
const LOOKBACK_DAYS = 6;
/** カバー率の下限。これを割ったら取得ジョブ側を疑う */
const MIN_COVERAGE_PCT = 90;
/** 既定の検査期間（日） */
const DEFAULT_DAYS = 90;

function parseDays(argv) {
  const i = argv.indexOf("--days");
  if (i === -1) return DEFAULT_DAYS;
  const value = Number(argv[i + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `--days には正の数を渡すこと（受け取った値: ${argv[i + 1]}）`,
    );
  }
  return value;
}

function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 1000行の既定上限に当たらないよう、`race_date` で刻んで全件読む。
 * 1日あたり最大 24会場 × 約50名 = 1,200行になりうるので、日単位で引く
 */
async function fetchPretestRows(fromDate, toDate) {
  const rows = [];
  for (let date = fromDate; date <= toDate; date = shiftDate(date, 1)) {
    const { data, error } = await supabase
      .from("motor_pretest_stats")
      .select(
        "race_date, venue_code, racer_id, pretest_time, pretest_rank, series_title",
      )
      .eq("race_date", date);
    if (error) {
      throw new Error(
        `motor_pretest_stats の取得に失敗（${date}）: ${error.message}`,
      );
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchEntries(fromDate, toDate) {
  const rows = [];
  for (let date = fromDate; date <= toDate; date = shiftDate(date, 1)) {
    const { data, error } = await supabase
      .from("races")
      .select("race_id, race_date, venue_code, race_entries(racer_id)")
      .eq("race_date", date);
    if (error) {
      throw new Error(
        `races/race_entries の取得に失敗（${date}）: ${error.message}`,
      );
    }
    (data ?? []).forEach((race) => {
      (race.race_entries ?? []).forEach((entry) => {
        if (entry.racer_id === null || entry.racer_id === undefined) return;
        rows.push({
          race_date: race.race_date,
          venue_code: race.venue_code,
          racer_id: entry.racer_id,
        });
      });
    });
  }
  return rows;
}

/** 会場×選手×series_title を日付の連続性で区間に切る（= 節） */
function groupIntoRuns(rows) {
  const byKey = new Map();
  rows.forEach((row) => {
    const key = `${row.venue_code}|${row.racer_id}|${row.series_title ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  });
  const runs = [];
  byKey.forEach((group) => {
    group.sort((a, b) => a.race_date.localeCompare(b.race_date));
    let current = [group[0]];
    for (let i = 1; i < group.length; i += 1) {
      const gap =
        (new Date(group[i].race_date) - new Date(group[i - 1].race_date)) /
        86_400_000;
      // 節の中でも行が飛ぶ日がある（桐生 09-20 → 09-23）。9日空いたら別の節とみなす
      if (gap > 9) {
        runs.push(current);
        current = [];
      }
      current.push(group[i]);
    }
    runs.push(current);
  });
  return runs;
}

async function main() {
  const days = parseDays(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const from = shiftDate(today, -days);
  // 6日ルックバックの検査に、期間の頭より前の行も要る
  const pretestFrom = shiftDate(from, -LOOKBACK_DAYS);

  console.log(`前検タイムの行の選び方を検査します（${from} 〜 ${today}）`);

  const [pretestRows, entryRows] = await Promise.all([
    fetchPretestRows(pretestFrom, today),
    fetchEntries(from, today),
  ]);
  console.log(
    `  motor_pretest_stats: ${pretestRows.length}行 / 出走: ${entryRows.length}件`,
  );

  const failures = [];

  // A. 節の中で前検タイム・順位が変動しないこと
  const runs = groupIntoRuns(pretestRows);
  const varyingRuns = runs.filter((run) => {
    const times = new Set(run.map((r) => String(r.pretest_time)));
    const ranks = new Set(run.map((r) => String(r.pretest_rank)));
    return times.size > 1 || ranks.size > 1;
  });
  if (varyingRuns.length > 0) {
    failures.push(
      `[A] 節の中で前検タイム/順位が変わる区間が ${varyingRuns.length} 件あります。\n` +
        `    今節タブ（節の最初の行）とモータ情報タブ（最新の行）が違う値を出します。\n` +
        varyingRuns
          .slice(0, 5)
          .map(
            (run) =>
              `    - 会場${run[0].venue_code} 登番${run[0].racer_id} ` +
              `${run[0].race_date}〜${run[run.length - 1].race_date}: ` +
              run
                .map(
                  (r) => `${r.race_date}=${r.pretest_time}/${r.pretest_rank}位`,
                )
                .join(", "),
          )
          .join("\n"),
    );
  } else {
    console.log(`  [A] OK: ${runs.length}区間すべてで前検タイム・順位が単一値`);
  }

  // B/C. 6日ルックバックで採る行が「その日の節」のものか、カバー率が保てているか
  const byVenueRacer = new Map();
  pretestRows.forEach((row) => {
    const key = `${row.venue_code}|${row.racer_id}`;
    if (!byVenueRacer.has(key)) byVenueRacer.set(key, []);
    byVenueRacer.get(key).push(row);
  });
  byVenueRacer.forEach((list) =>
    list.sort((a, b) => b.race_date.localeCompare(a.race_date)),
  );

  // その会場・その日の「今の節」の series_title（最新の行のもの）
  const seriesByVenueDate = new Map();
  pretestRows.forEach((row) => {
    const key = `${row.venue_code}|${row.race_date}`;
    seriesByVenueDate.set(key, row.series_title ?? "");
  });
  const currentSeries = (venueCode, date) => {
    for (let i = 0; i <= LOOKBACK_DAYS; i += 1) {
      const key = `${venueCode}|${shiftDate(date, -i)}`;
      if (seriesByVenueDate.has(key)) return seriesByVenueDate.get(key);
    }
    return null;
  };

  let matched = 0;
  const crossMeet = [];
  entryRows.forEach((entry) => {
    const list =
      byVenueRacer.get(`${entry.venue_code}|${entry.racer_id}`) ?? [];
    const floor = shiftDate(entry.race_date, -LOOKBACK_DAYS);
    const picked = list.find(
      (row) => row.race_date <= entry.race_date && row.race_date >= floor,
    );
    if (!picked) return;
    matched += 1;
    const expected = currentSeries(entry.venue_code, entry.race_date);
    if (expected !== null && (picked.series_title ?? "") !== expected) {
      crossMeet.push({ entry, picked, expected });
    }
  });

  if (crossMeet.length > 0) {
    failures.push(
      `[B] 6日ルックバックで前の節の行を拾う例が ${crossMeet.length} 件あります。\n` +
        crossMeet
          .slice(0, 5)
          .map(
            ({ entry, picked, expected }) =>
              `    - 会場${entry.venue_code} 登番${entry.racer_id} ${entry.race_date}: ` +
              `採った行=${picked.race_date}「${picked.series_title}」/ その日の節=「${expected}」`,
          )
          .join("\n"),
    );
  } else {
    console.log("  [B] OK: 前の節の行を拾う例は0件");
  }

  const coverage =
    entryRows.length > 0 ? (matched / entryRows.length) * 100 : 0;
  if (coverage < MIN_COVERAGE_PCT) {
    failures.push(
      `[C] 前検タイムのカバー率が ${coverage.toFixed(1)}% で、下限 ${MIN_COVERAGE_PCT}% を割っています。\n` +
        `    取得ジョブ（N23）が止まっている可能性があります（画面は列ごと消えるだけで気づけません）。`,
    );
  } else {
    console.log(
      `  [C] OK: カバー率 ${coverage.toFixed(1)}%（下限 ${MIN_COVERAGE_PCT}%）`,
    );
  }

  if (failures.length > 0) {
    console.error("\n❌ 前検タイムの行の選び方の前提が崩れています\n");
    failures.forEach((f) => console.error(`${f}\n`));
    process.exit(1);
  }
  console.log("\n✅ 前検タイムの行の選び方は前提どおりです");
}

main().catch((error) => {
  console.error(`❌ 検査に失敗しました: ${error.message}`);
  process.exit(1);
});
