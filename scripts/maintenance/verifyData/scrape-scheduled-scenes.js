/**
 * scrape-scheduled-scenes.js - scripts/daily/scrape-scheduled.js（GitHub Actions のオーケストレーター）の切り替えの確かめ（verify の部品）。
 * 本文の字は読まず、scrape-scheduled-run.js で偽の取得・偽のスケジュールのもとで main を回し、呼んだ取得・引数・ログで見る。
 * check は呼ぶ verify の check(label, pass, detail)。
 *
 * 発走までの分（今の時刻から。窓は本物の判定で、オッズ 60/30/15/10/5/0・レース情報 60・展示 30/15/10 の各 ±3分）:
 *   61 レース情報とオッズ（60分前）　30 オッズと展示（30分前）・買い目オッズ　5 オッズ（5分前）・買い目オッズ
 *   45 買い目オッズだけ　-20 結果（発走後5〜90分）　100 どの窓にも無い
 */
import { raceAt, runScheduled, UPDATED } from "./scrape-scheduled-run.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idsOf = (races) => races.map((r) => r.race_id);
const only = (r, steps) =>
  same(
    r.calls.filter((c) => c.name === "run").map((c) => c.m),
    steps,
  );

/** オッズ（A3）・買い目オッズ（A4）の切り替え（SKIP_ODDS_ON_GHA）と、案1が無いままの停止の警告 */
export async function checkScheduledOdds({ check, show }) {
  const due = [raceAt("O5", 5)];
  let r = await runScheduled({ races: due });
  check(
    "scrape-scheduled.js: SKIP_ODDS_ON_GHA が未設定なら肩代わりを確かめず（gate を呼ばない）、オッズの run(schedule, date) と買い目オッズを呼ぶ",
    same(r.gateVars, []) &&
      r.ran("odds").length === 1 &&
      same(idsOf(r.ran("odds")[0][0]), ["O5"]) &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.ran("odds")[0][1]) &&
      same(r.ran("predictionOdds"), [[["O5"], r.ran("odds")[0][1]]]) &&
      r.logs.includes("\n💹 予測買い目オッズ更新: 1レース"),
    show({ calls: r.calls, logs: r.logs }),
  );
  check(
    "scrape-scheduled.js: オッズを止めていなければ、案1の順序の警告を出さない",
    !r.warns.some((w) => w.includes("SKIP_ODDS_REFRESH_ON_GHA")),
    show(r.warns),
  );
  for (const v of ["", "false", "1"]) {
    r = await runScheduled({ env: { SKIP_ODDS_ON_GHA: v }, races: due });
    check(
      `scrape-scheduled.js: SKIP_ODDS_ON_GHA=${JSON.stringify(v)} は従来どおりオッズを取る（gate を呼ばない）`,
      same(r.gateVars, []) && only(r, ["odds", "predictionOdds"]),
      show(r.calls),
    );
  }
  r = await runScheduled({ env: { SKIP_ODDS_ON_GHA: "true" }, races: due });
  check(
    "scrape-scheduled.js: SKIP_ODDS_ON_GHA=true で対象があり Vercel が健全（gate が skip）なら、オッズも買い目オッズも取らず早く終わる",
    same(r.gateVars, ["SKIP_ODDS_ON_GHA"]) &&
      only(r, []) &&
      r.logs.some((l) => l.includes("全ウィンドウ対象レースなし")),
    show({ calls: r.calls, logs: r.logs }),
  );
  r = await runScheduled({
    env: { SKIP_ODDS_ON_GHA: "true" },
    races: due,
    gate: { SKIP_ODDS_ON_GHA: false },
  });
  check(
    "scrape-scheduled.js: SKIP_ODDS_ON_GHA=true でも gate が肩代わり（skip でない）ならオッズと買い目オッズを取る",
    same(r.gateVars, ["SKIP_ODDS_ON_GHA"]) &&
      only(r, ["odds", "predictionOdds"]),
    show(r.calls),
  );
  r = await runScheduled({
    env: { SKIP_ODDS_ON_GHA: "true" },
    races: [raceAt("O5", 5), raceAt("R-20", -20)],
  });
  check(
    "scrape-scheduled.js: オッズを止めた（skip）起動では買い目オッズも取らず、案1（SKIP_ODDS_REFRESH_ON_GHA=true）が無ければ警告する",
    only(r, ["results"]) &&
      r.warns.some((w) => w.includes("SKIP_ODDS_REFRESH_ON_GHA")),
    show({ calls: r.calls, warns: r.warns }),
  );
  r = await runScheduled({
    env: { SKIP_ODDS_ON_GHA: "true", SKIP_ODDS_REFRESH_ON_GHA: "true" },
    races: [raceAt("O5", 5), raceAt("R-20", -20)],
  });
  check(
    "scrape-scheduled.js: 案1が有効（SKIP_ODDS_REFRESH_ON_GHA=true）なら、オッズを止めても警告しない",
    only(r, ["results"]) &&
      !r.warns.some((w) => w.includes("SKIP_ODDS_REFRESH_ON_GHA")),
    show(r.warns),
  );
  r = await runScheduled({
    env: { SKIP_ODDS_ON_GHA: "true" },
    races: [raceAt("R-20", -20)],
  });
  check(
    "scrape-scheduled.js: SKIP_ODDS_ON_GHA=true でもオッズの対象が無ければ gate を呼ばない（DB を読まない）",
    same(r.gateVars, []) && only(r, ["results"]),
    show(r.calls),
  );
  r = await runScheduled({ races: [raceAt("A45", 45)] });
  check(
    "scrape-scheduled.js: 買い目オッズだけの対象（発走45分前）でも早く終わらず、買い目オッズを1回取る",
    only(r, ["predictionOdds"]) &&
      same(r.ran("predictionOdds")[0][0], ["A45"]) &&
      r.finished,
    show({ calls: r.calls, logs: r.logs }),
  );
  r = await runScheduled({ races: [raceAt("R-20", -20)] });
  check(
    "scrape-scheduled.js: オッズの窓の外（結果だけ）ではオッズを取らない",
    only(r, ["results"]),
    show(r.calls),
  );
  r = await runScheduled({ races: [raceAt("F100", 100)] });
  check(
    "scrape-scheduled.js: どの窓にも対象が無ければ何も取らず早く終わる（完了のログまで進まない）",
    only(r, []) &&
      r.logs.some((l) => l.includes("全ウィンドウ対象レースなし")) &&
      !r.finished,
    show(r.logs),
  );
}

/** レース情報（A1）・展示（A2）の切り替え（SKIP_RACE_INFO_ON_GHA・SKIP_EXHIBITION_ON_GHA） */
export async function checkScheduledPreRace({ check, show }) {
  // オッズは止めて（gate skip）、レース情報・展示の分だけを見る
  const base = { SKIP_ODDS_ON_GHA: "true", SKIP_ODDS_REFRESH_ON_GHA: "true" };
  const sides = [
    ["SKIP_RACE_INFO_ON_GHA", "raceInfo", raceAt("I61", 61)],
    ["SKIP_EXHIBITION_ON_GHA", "exhibition", raceAt("E30", 30)],
  ];
  const other = [raceAt("R-20", -20)];
  for (const [v, step, race] of sides) {
    const races = [race, ...other];
    let r = await runScheduled({ env: base, races });
    check(
      `scrape-scheduled.js: ${v} が未設定なら gate を呼ばず（オッズの分だけ）、${step} の run(schedule, date) を呼ぶ`,
      same(r.gateVars, ["SKIP_ODDS_ON_GHA"]) &&
        r.ran(step).length === 1 &&
        same(idsOf(r.ran(step)[0][0]), [race.race_id, "R-20"]) &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.ran(step)[0][1]),
      show(r.calls),
    );
    for (const val of ["", "false", "TRUE"]) {
      r = await runScheduled({ env: { ...base, [v]: val }, races });
      check(
        `scrape-scheduled.js: ${v}=${JSON.stringify(val)} は文字列 "true" でないので従来どおり ${step} を取る`,
        same(r.gateVars, ["SKIP_ODDS_ON_GHA"]) && r.ran(step).length === 1,
        show(r.calls),
      );
    }
    r = await runScheduled({ env: { ...base, [v]: "true" }, races });
    check(
      `scrape-scheduled.js: ${v}=true で対象があり gate が skip なら ${step} を取らない`,
      same(r.gateVars, ["SKIP_ODDS_ON_GHA", v]) && r.ran(step).length === 0,
      show(r.calls),
    );
    r = await runScheduled({
      env: { ...base, [v]: "true" },
      races,
      gate: { [v]: false },
    });
    check(
      `scrape-scheduled.js: ${v}=true でも gate が肩代わりなら ${step} を取る`,
      same(r.gateVars, ["SKIP_ODDS_ON_GHA", v]) && r.ran(step).length === 1,
      show(r.calls),
    );
    r = await runScheduled({ env: { ...base, [v]: "true" }, races: other });
    check(
      `scrape-scheduled.js: ${v}=true でも ${step} の対象が無ければ gate を呼ばず、取らない`,
      same(r.gateVars, []) && only(r, ["results"]),
      show(r.calls),
    );
    r = await runScheduled({ env: base, races: other });
    check(
      `scrape-scheduled.js: ${step} の対象が無ければ（変数が未設定でも）取らない`,
      only(r, ["results"]),
      show(r.calls),
    );
  }
  const r = await runScheduled({
    env: { SKIP_RACE_INFO_ON_GHA: "true" },
    races: [raceAt("I61", 61)],
  });
  check(
    "scrape-scheduled.js: レース情報を止めた起動はそのことをログに出す",
    r.logs.some((l) => l.includes("レース情報更新をスキップ")) &&
      r.ran("raceInfo").length === 0,
    show(r.logs),
  );
}

/** 結果（SKIP_RESULTS_ON_GHA）・Kファイル同期（SKIP_KFILE_ON_GHA）の切り替え */
export async function checkScheduledResults({ check, show }) {
  const finished = [raceAt("R-20", -20)];
  const flags = (r) => r.ran("results").map((a) => a[2]);
  let r = await runScheduled({ races: finished });
  check(
    "scrape-scheduled.js: 結果の対象（発走後5〜90分）があり変数が未設定なら、gate を呼ばず run(schedule, date, 両方 false) を呼ぶ",
    same(r.gateVars, []) &&
      r.ran("results").length === 1 &&
      same(idsOf(r.ran("results")[0][0]), ["R-20"]) &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.ran("results")[0][1]) &&
      same(flags(r), [{ skipResults: false, skipKFile: false }]),
    show(r.calls),
  );
  for (const val of ["", "false", "1"]) {
    r = await runScheduled({
      env: { SKIP_RESULTS_ON_GHA: val, SKIP_KFILE_ON_GHA: val },
      races: finished,
    });
    check(
      `scrape-scheduled.js: SKIP_RESULTS_ON_GHA・SKIP_KFILE_ON_GHA=${JSON.stringify(val)} は従来どおり全て取る`,
      same(r.gateVars, []) &&
        same(flags(r), [{ skipResults: false, skipKFile: false }]),
      show(r.calls),
    );
  }
  const cases = [
    [
      { SKIP_RESULTS_ON_GHA: "true" },
      {},
      { skipResults: true, skipKFile: false },
    ],
    [
      { SKIP_KFILE_ON_GHA: "true" },
      {},
      { skipResults: false, skipKFile: true },
    ],
    [
      { SKIP_RESULTS_ON_GHA: "true", SKIP_KFILE_ON_GHA: "true" },
      { SKIP_KFILE_ON_GHA: false },
      { skipResults: true, skipKFile: false },
    ],
    [
      { SKIP_RESULTS_ON_GHA: "true", SKIP_KFILE_ON_GHA: "true" },
      { SKIP_RESULTS_ON_GHA: false },
      { skipResults: false, skipKFile: true },
    ],
  ];
  for (const [env, gate, want] of cases) {
    r = await runScheduled({ env, races: finished, gate });
    check(
      `scrape-scheduled.js: ${show(env)}・gate ${show(gate)} は片方だけ止め、run に ${show(want)} を渡す`,
      same(r.gateVars, Object.keys(env)) && same(flags(r), [want]),
      show(r.calls),
    );
  }
  r = await runScheduled({
    env: { SKIP_RESULTS_ON_GHA: "true", SKIP_KFILE_ON_GHA: "true" },
    races: finished,
  });
  check(
    "scrape-scheduled.js: 結果とKファイル同期の両方を止めた（gate が skip）ときだけ、結果の run を呼ばない",
    same(r.gateVars, ["SKIP_RESULTS_ON_GHA", "SKIP_KFILE_ON_GHA"]) &&
      r.ran("results").length === 0,
    show(r.calls),
  );
  r = await runScheduled({
    env: { SKIP_RESULTS_ON_GHA: "true", SKIP_KFILE_ON_GHA: "true" },
    races: [raceAt("A45", 45)],
  });
  check(
    "scrape-scheduled.js: 結果の対象が無ければ gate を呼ばず、結果の run も呼ばない",
    same(r.gateVars, []) && only(r, ["predictionOdds"]),
    show(r.calls),
  );
  r = await runScheduled({ races: [raceAt("A45", 45)] });
  check(
    "scrape-scheduled.js: 変数が未設定でも結果の対象が無ければ結果の run を呼ばない",
    only(r, ["predictionOdds"]),
    show(r.calls),
  );
}

/** 予測の再計算の対象（起点ごとの集合・SKIP_ODDS_REFRESH_ON_GHA でオッズ起点だけを外す・書き方を指定しない） */
export async function checkScheduledRefresh({ check, show }) {
  // I61 はレース情報とオッズ、E30 はオッズと展示、O5 はオッズだけの窓
  const races = [raceAt("I61", 61), raceAt("E30", 30), raceAt("O5", 5)];
  const all = { raceInfo: UPDATED, odds: UPDATED, exhibition: UPDATED };
  const ids = (r) => r.refreshes.map((a) => [...a[0].specificRaceIds].sort());
  let r = await runScheduled({ races, updated: all });
  check(
    "scrape-scheduled.js: 既定はレース情報・オッズ・展示のどの起点で更新したレースも1回の mainRefresh で再計算し、書き方（writeMode）を渡さない",
    same(ids(r), [["E30", "I61", "O5"]]) &&
      same(Object.keys(r.refreshes[0][0]).sort(), [
        "isDryRun",
        "specificRaceIds",
      ]) &&
      r.refreshes[0][0].isDryRun === false,
    show(r.refreshes),
  );
  for (const [step, want] of [
    ["raceInfo", ["I61"]],
    ["odds", ["E30", "I61", "O5"]],
    ["exhibition", ["E30"]],
  ]) {
    r = await runScheduled({ races, updated: { [step]: UPDATED } });
    check(
      `scrape-scheduled.js: ${step} だけが更新したときは、その窓のレース ${want.join("・")} だけを再計算する（起点ごとに別の集合）`,
      same(ids(r), [want]),
      show(r.refreshes),
    );
  }
  r = await runScheduled({
    env: { SKIP_ODDS_REFRESH_ON_GHA: "true" },
    races,
    updated: all,
  });
  check(
    "scrape-scheduled.js: SKIP_ODDS_REFRESH_ON_GHA=true はオッズ起点だけを外す（レース情報・展示の起点は残す）",
    same(ids(r), [["E30", "I61"]]) &&
      r.logs.some((l) => l.includes("オッズ起点の予測リフレッシュを除外")),
    show({ refreshes: r.refreshes, logs: r.logs }),
  );
  r = await runScheduled({
    env: { SKIP_ODDS_REFRESH_ON_GHA: "true" },
    races,
    updated: { odds: UPDATED },
  });
  check(
    "scrape-scheduled.js: SKIP_ODDS_REFRESH_ON_GHA=true でオッズだけが更新したときは再計算しない",
    same(r.refreshes, []),
    show(r.refreshes),
  );
  r = await runScheduled({ races });
  check(
    "scrape-scheduled.js: どの取得も更新しなければ再計算しない",
    same(r.refreshes, []) && r.logs.some((l) => l.includes("新規データなし")),
    show(r.logs),
  );
}
