/**
 * verify-data-health-job.js の検査の続き（data-health-job-scenarios.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { near, show } from "./data-health-job-fixtures.js";

// ---------------------------------------------------------------------------
// (d)(e) 判定・通知の一意性（純粋関数）
// ---------------------------------------------------------------------------
export async function evaluateScenarios(evalMod) {
  const { results, t, evaluateCountCheck, evaluateEmptyTables, reconcileAlerts, isDueToday, commonCauseAlert, chk, rowsOf, END } = await evaluateScenariosPart1(evalMod);
  await evaluateScenariosPart2(t, evaluateCountCheck, chk, rowsOf, END);
  return await evaluateScenariosPart3(results, t, evaluateEmptyTables, reconcileAlerts, isDueToday, commonCauseAlert, chk);
}

export async function evaluateScenariosPart1(evalMod) {
  const results = [];
  const t = (label, pass, detail = "") => results.push({ label, pass, detail });
  const {
    evaluateCountCheck,
    evaluateEmptyTables,
    reconcileAlerts,
    isDueToday,
    commonCauseAlert,
  } = evalMod;
  const base = {
    id: "t.x",
    label: "テスト項目",
    classification: "count",
    severity: "alert",
    fn: "f",
    numerator: "n",
    denominator: "d",
  };
  // 列名: 分子 n・分母 den
  const chk = { ...base, denominator: "den" };
  const rowsOf = (list) => list.map(([d, den, n]) => ({ d, den, n }));
  const END = "2026-09-20";

  // 閾値の境界: 99/100 は達成（<）、98/100 は未達
  {
    const ok = evaluateCountCheck(
      chk,
      rowsOf([
        ["2026-09-19", 100, 99],
        ["2026-09-20", 100, 99],
      ]),
      { end: END },
    );
    const ng = evaluateCountCheck(
      chk,
      rowsOf([
        ["2026-09-19", 100, 98],
        ["2026-09-20", 100, 99],
      ]),
      { end: END },
    );
    t(
      "閾値の境界: ちょうど99%は達成、99%未満は未達",
      ok.status === "ok" && ng.status === "breach",
      show([ok.status, ng.status]),
    );
    t(
      "未達: 欠損数・最も低い日・期間が出る",
      ng.missing === 3 &&
        ng.worst.key === "2026-09-19" &&
        near(ng.worst.rate, 0.98) &&
        ng.from === "2026-09-14" &&
        ng.to === END,
      show(ng),
    );
  }
  // 母数の下限
  {
    const r = evaluateCountCheck(chk, rowsOf([["2026-09-20", 10, 5]]), {
      end: END,
    });
    t(
      "母数の下限: 期待件数が30件未満なら判定しない（未達にしない）",
      r.status === "insufficient",
      show(r),
    );
    const r2 = evaluateCountCheck(
      { ...chk, minDenominator: 5 },
      rowsOf([["2026-09-20", 10, 5]]),
      { end: END },
    );
    t(
      "母数の下限: 項目ごとに変えられる（minDenominator）",
      r2.status === "breach",
      show(r2),
    );
  }
  return { results, t, evaluateCountCheck, evaluateEmptyTables, reconcileAlerts, isDueToday, commonCauseAlert, chk, rowsOf, END };
}

export async function evaluateScenariosPart2(t, evaluateCountCheck, chk, rowsOf, END) {
  // 取得開始日
  {
    const rows = rowsOf([
      ["2026-09-15", 100, 0],
      ["2026-09-16", 100, 0],
      ["2026-09-17", 100, 100],
      ["2026-09-18", 100, 100],
    ]);
    const r = evaluateCountCheck({ ...chk, since: "2026-09-17" }, rows, {
      end: END,
    });
    t(
      "取得開始日: それより前の行を分母から外す（取得開始前の欠損を未達にしない）",
      r.status === "ok" && r.denominator === 200 && r.from === "2026-09-17",
      show(r),
    );
    const r2 = evaluateCountCheck({ ...chk, since: "2026-09-22" }, rows, {
      end: END,
    });
    t(
      "取得開始日: 評価の終端より後なら「対象外」（未達にも達成にもしない）",
      r2.status === "not_applicable",
      show(r2),
    );
  }
  // 確定ラグ
  {
    const rows = rowsOf([
      ["2026-09-19", 100, 100],
      ["2026-09-20", 100, 0],
    ]);
    const r = evaluateCountCheck({ ...chk, lagDays: 1 }, rows, { end: END });
    t(
      "確定ラグ: 終端の日（Kファイルの同期前）を評価しない",
      r.status === "ok" && r.to === "2026-09-19" && r.denominator === 100,
      show(r),
    );
    const r0 = evaluateCountCheck(chk, rows, { end: END });
    t("確定ラグなしなら、終端の日も評価する", r0.status === "breach", show(r0));
  }
  // 未導入
  {
    const c = { ...chk, requiresTable: "race_series" };
    const rows = rowsOf([["2026-09-20", 100, 0]]);
    const empty = evaluateCountCheck(c, rows, {
      end: END,
      tableRows: { race_series: false },
    });
    const has = evaluateCountCheck(c, rows, {
      end: END,
      tableRows: { race_series: true },
    });
    t(
      "未導入: テーブルが空の間は「未導入」で警告しない。行が入れば評価する",
      empty.status === "not_introduced" && has.status === "breach",
      show([empty.status, has.status]),
    );
  }
  // 期待件数0
  {
    const r = evaluateCountCheck(chk, rowsOf([["2026-09-20", 0, 0]]), {
      end: END,
    });
    t(
      "期待件数が0件: 対象なし（未達にしない）",
      r.status === "no_target",
      show(r),
    );
  }
  // 月別（行ごと）
  {
    const c = {
      ...chk,
      aggregate: "perRow",
      keyColumn: "month",
      severity: "info",
    };
    const rows = [
      { month: "2026-08", den: 100, n: 99 },
      { month: "2026-09", den: 100, n: 90 },
    ];
    const r = evaluateCountCheck(c, rows, { end: END });
    t(
      "月別: 行ごとに判定し、閾値未満の月を列挙する",
      r.status === "breach" &&
        r.belowRows.length === 1 &&
        r.belowRows[0].key === "2026-09",
      show(r),
    );
  }
}

export async function evaluateScenariosPart3(results, t, evaluateEmptyTables, reconcileAlerts, isDueToday, commonCauseAlert, chk) {
  // 空テーブル
  {
    const res = evaluateEmptyTables(
      {
        a: { policy: "forbid" },
        b: { policy: "info" },
        c: { policy: "pending" },
        d: { policy: "forbid" },
        e: { policy: "forbid" },
      },
      { a: false, b: false, c: false, d: true },
    );
    const by = Object.fromEntries(res.map((r) => [r.table, r.status]));
    t(
      "空テーブル: forbid は空を異常、info は情報、pending は未導入、行があれば ok、関数が返さないテーブルは unknown（異常にしない）",
      by.a === "empty" &&
        by.b === "empty_info" &&
        by.c === "not_introduced" &&
        by.d === "ok" &&
        by.e === "unknown",
      show(by),
    );
  }
  // 週次
  {
    const c = { ...chk, cadence: { weeklyOn: 1 } };
    t(
      "週次: 指定の曜日（月曜）にだけ実行する",
      isDueToday(c, "2026-09-21") === true &&
        isDueToday(c, "2026-09-22") === false &&
        isDueToday(chk, "2026-09-22") === true,
    );
  }
  // 通知の一意性
  await evaluateScenariosBlock(t, reconcileAlerts, commonCauseAlert);
  return results;
}

export async function evaluateScenariosBlock(t, reconcileAlerts, commonCauseAlert) {
  const { now, b, day1 } = await evaluateScenariosBlockPart1(t, reconcileAlerts);
  await evaluateScenariosBlockPart2(t, reconcileAlerts, commonCauseAlert, now, b, day1);
}

export async function evaluateScenariosBlockPart1(t, reconcileAlerts) {
  const now = new Date("2026-09-21T21:35:00Z");
  const b = (missing) => ({ key: "coverage.x", text: "未達", missing });
  const day1 = reconcileAlerts({
    breaches: [b(5)],
    okKeys: new Set(),
    previous: {},
    targetDate: "2026-09-22",
    now,
  });
  t(
    "通知: 初回の未達は通知する。key に対象日、until（有効期限）が付く",
    day1.alerts.length === 1 &&
      day1.alerts[0].key === "dh:coverage.x:2026-09-22" &&
      new Date(day1.alerts[0].until) > now &&
      day1.emitted["coverage.x"].firstAt === "2026-09-22",
    show(day1),
  );
  const day2 = reconcileAlerts({
    breaches: [b(5)],
    okKeys: new Set(),
    previous: day1.emitted,
    targetDate: "2026-09-23",
    now,
  });
  t(
    "通知の一意性: 同じ未達（欠損数が同じ）は、翌日は通知しない",
    day2.alerts.length === 0 &&
      day2.emitted["coverage.x"].lastAt === "2026-09-22",
    show(day2),
  );
  const dec = reconcileAlerts({
    breaches: [b(3)],
    okKeys: new Set(),
    previous: day1.emitted,
    targetDate: "2026-09-23",
    now,
  });
  const worse = reconcileAlerts({
    breaches: [b(4)],
    okKeys: new Set(),
    previous: dec.emitted,
    targetDate: "2026-09-24",
    now,
  });
  t(
    "通知: 欠損が減っても通知しない。減った後に増えたら（悪化）通知する",
    dec.alerts.length === 0 &&
      worse.alerts.length === 1 &&
      worse.alerts[0].text.includes("悪化"),
    show([dec.alerts, worse.alerts]),
  );
  const week = reconcileAlerts({
    breaches: [b(5)],
    okKeys: new Set(),
    previous: day1.emitted,
    targetDate: "2026-09-29",
    now,
  });
  const sixDays = reconcileAlerts({
    breaches: [b(5)],
    okKeys: new Set(),
    previous: day1.emitted,
    targetDate: "2026-09-28",
    now,
  });
  t(
    "通知: 未達が続くときは、7日ごとに再通知する（6日目は通知しない）",
    week.alerts.length === 1 &&
      week.alerts[0].text.includes("継続中") &&
      sixDays.alerts.length === 0,
    show([week.alerts.length, sixDays.alerts.length]),
  );
  return { now, b, day1 };
}

export async function evaluateScenariosBlockPart2(t, reconcileAlerts, commonCauseAlert, now, b, day1) {
  const recovered = reconcileAlerts({
    breaches: [],
    okKeys: new Set(["coverage.x"]),
    previous: day1.emitted,
    targetDate: "2026-09-23",
    now,
  });
  const relapse = reconcileAlerts({
    breaches: [b(5)],
    okKeys: new Set(),
    previous: recovered.emitted,
    targetDate: "2026-09-24",
    now,
  });
  t(
    "通知: 回復すると状態を消し、再発は初回として通知する",
    Object.keys(recovered.emitted).length === 0 &&
      relapse.alerts.length === 1,
    show([recovered.emitted, relapse.alerts.length]),
  );
  {
    const key1 = day1.emitted["coverage.x"].alertKey;
    const notDelivered = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
      deliveredKeys: new Set(),
    });
    const delivered = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
      deliveredKeys: new Set([key1]),
    });
    const unknown = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-23",
      now,
      deliveredKeys: null,
    });
    const twoDays = reconcileAlerts({
      breaches: [b(5)],
      okKeys: new Set(),
      previous: day1.emitted,
      targetDate: "2026-09-24",
      now,
      deliveredKeys: new Set(),
    });
    t(
      "通知の配信確認: 前日の通知が scrape-monitor の通知済みの記録に無ければ再通知する。あれば通知しない。記録を読めない（null）・2日以上前の通知は判定しない",
      notDelivered.alerts.length === 1 &&
        notDelivered.alerts[0].text.includes("届いていない") &&
        delivered.alerts.length === 0 &&
        unknown.alerts.length === 0 &&
        twoDays.alerts.length === 0,
      show([
        notDelivered.alerts.length,
        delivered.alerts.length,
        unknown.alerts.length,
        twoDays.alerts.length,
      ]),
    );
  }
  const skipped = reconcileAlerts({
    breaches: [],
    okKeys: new Set(),
    previous: day1.emitted,
    targetDate: "2026-09-23",
    now,
  });
  t(
    "通知: 今回実行しなかった・実行できなかった項目の状態は残す（消さない）",
    skipped.emitted["coverage.x"] !== undefined,
    show(skipped),
  );
  const cc = commonCauseAlert({ count: 6, targetDate: "2026-09-22", now });
  t(
    "共通原因の要約: 件数と、共通の原因を疑う文言が入る",
    cc.key === "dh:summary:2026-09-22" &&
      cc.text.includes("6項目") &&
      cc.text.includes("共通"),
    show(cc),
  );
}
