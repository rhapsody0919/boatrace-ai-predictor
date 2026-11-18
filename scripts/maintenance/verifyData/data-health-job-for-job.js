/**
 * verify-data-health-job.js の検査の続き（data-health-job-for-job.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { ALL_TABLES_OK, NOW, TARGET, coverageRow, dates, makeCaller, show } from "./data-health-job-fixtures.js";
import { COUNT_CHECKS } from "../../lib/dataHealth/checks.js";

export async function scenariosForJob(jobMod) {
  const { results, t, run } = await scenariosForJobPart1(jobMod);
  await scenariosForJobPart2(t, run);
  await scenariosForJobPart3(t, run);
  await scenariosForJobPart4(t, run);
  return await scenariosForJobPart5(results, t, run);
}

export async function scenariosForJobPart1(jobMod) {
  const results = [];
  const t = (label, pass, detail = "") => results.push({ label, pass, detail });
  const { runDataHealthChecks: run } = jobMod;

  // 正常
  {
    const caller = makeCaller();
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: caller,
    });
    t(
      "正常: 全項目が達成なら、通知は0件。関数は、データセットごとに1回だけ呼ぶ（逐次）",
      out.alerts.length === 0 &&
        out.breaches.length === 0 &&
        new Set(caller.calls.map((c) => c.name)).size === caller.calls.length,
      show(out.report.summary),
    );
    t(
      "正常: 期間は直近7日（終端は対象日の前日）、月別（週次）は火曜には実行しない",
      caller.calls.find((c) => c.name === "data_health_coverage").args
        .p_from === "2026-09-15" &&
        caller.calls.find((c) => c.name === "data_health_coverage").args
          .p_to === "2026-09-21" &&
        !caller.calls.some((c) => c.name === "data_health_monthly_result"),
      show(caller.calls),
    );
    const monday = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      callFunction: makeCaller(),
    });
    t(
      "週次: 月曜には月別を実行する",
      monday.report.checks.some((c) => c.id === "result.monthly"),
    );
    t(
      "正常: 未導入（節・期別成績）と、取得開始前（出走表の拡張列・ピットレポート）は、警告しない",
      out.report.checks.find((c) => c.id === "race_series.covered").status ===
        "not_introduced" &&
        out.report.checks.find((c) => c.id === "pre_race.weight_kg").status ===
          "not_applicable",
    );
  }
  // 閾値未達
  {
    const rows = dates.map((d) =>
      coverageRow(
        d,
        d === "2026-09-18" ? { exhibition_time: 90, exhibition_row: 90 } : {},
      ),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "閾値未達: 該当の項目だけが通知になる（他の項目は通知しない）",
      out.alerts.length === 2 &&
        out.alerts.every((a) => a.text.includes("展示")) &&
        out.breaches.length === 2,
      show(out.alerts.map((a) => a.text)),
    );
    t(
      "閾値未達: 通知の key は monitor の再通知抑制に使える形（dh:項目:対象日）",
      out.alerts.every((a) =>
        /^dh:coverage\.exhibition_(row|time):2026-09-22$/.test(a.key),
      ),
      show(out.alerts.map((a) => a.key)),
    );
  }
  return { results, t, run };
}

export async function scenariosForJobPart2(t, run) {
  // 確定ラグ: 終端の日のKファイル由来の欠損は通知しない
  {
    const rows = dates.map((d) =>
      coverageRow(
        d,
        d === "2026-09-21" ? { actual_course: 0, rank4_6: 0 } : {},
      ),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "確定ラグ: 前日分の実進入・着順4位以降（Kファイルの同期前）の欠損は、通知しない",
      out.alerts.length === 0,
      show(out.alerts),
    );
    const rows2 = dates.map((d) =>
      coverageRow(d, d === "2026-09-20" ? { actual_course: 0 } : {}),
    );
    const out2 = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows2 }),
    });
    t(
      "確定ラグ: 前々日の実進入の欠損は通知する",
      out2.alerts.some((a) => a.text.includes("実進入")),
      show(out2.alerts),
    );
  }
  // 順延日（確定中止に入れれば分母から外れる）と、開催の無い日
  {
    const rows = dates.map((d) =>
      d === "2026-09-21"
        ? coverageRow(d, {
            total: 100,
            excluded: 100,
            denom: 0,
            result: 0,
            rank_denom: 0,
            rank4_6: 0,
            actual_course: 0,
            winning_technique: 0,
            race_stage: 0,
            st_row: 0,
            st_value: 0,
            exhibition_row: 0,
            exhibition_time: 0,
            odds: 0,
            odds_all: 0,
            trifecta_all: 0,
            trio_all: 0,
            exacta_all: 0,
            quinella_all: 0,
            wide_all: 0,
          })
        : coverageRow(d),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "順延日・開催の無い日: 確定中止で分母が0の日は、欠損にしない",
      out.alerts.length === 0,
      show(out.alerts),
    );
  }
}

export async function scenariosForJobPart3(t, run) {
  // 空テーブル
  {
    const caller = makeCaller({
      tableRows: {
        ...ALL_TABLES_OK,
        races: false,
        race_special_notes: false,
        race_series: false,
        racer_period_stats: false,
      },
    });
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: caller,
    });
    t(
      "空テーブル: 空であってはならないテーブル（races）が0件なら通知する。race_special_notes（info）・未導入は通知しない",
      out.alerts.length === 1 &&
        out.alerts[0].text.includes("races") &&
        out.report.emptyTables.some(
          (e) => e.table === "race_special_notes" && e.status === "empty_info",
        ),
      show(out.alerts),
    );
  }
  // 共通原因の要約
  {
    const rows = dates.map((d) =>
      d === "2026-09-21"
        ? coverageRow(d, {
            result: 0,
            winning_technique: 0,
            st_row: 0,
            st_value: 0,
            exhibition_row: 0,
            exhibition_time: 0,
          })
        : coverageRow(d),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({ coverage: rows }),
    });
    t(
      "共通原因: 4項目以上が同時に未達なら、先頭に要約の通知が付く",
      out.alerts.length >= 5 && out.alerts[0].key.startsWith("dh:summary:"),
      show(out.alerts.map((a) => a.key)),
    );
  }
}

export async function scenariosForJobPart4(t, run) {
  // info の項目: 閾値未満でも通知しない（last_report に載せるだけ）
  //
  // 題材は合成の項目にする。以前は実在の result.monthly を使っていたが、BOA-468で解消して
  // severity を info → alert に上げたところ、**実在の info 項目が0件になり、この検証が
  // 題材ごと消えた**（2026-09-28）。検証したいのは severity の挙動であって特定の項目ではないので、
  // checks を差し替えて、同じ項目の info 版と alert 版を突き合わせる形にした。
  {
    const monthlyCheck = COUNT_CHECKS.find((c) => c.id === "result.monthly");
    const overrides = {
      data_health_monthly_result: [
        { month: "2026-01", denom: 1000, with_result: 800 },
      ],
    };
    const asInfo = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      checks: [{ ...monthlyCheck, id: "synthetic.info", severity: "info" }],
      callFunction: makeCaller({ overrides }),
    });
    const infoCheck = asInfo.report.checks.find(
      (c) => c.id === "synthetic.info",
    );
    t(
      "info の項目: 閾値未満でも通知しない（last_report に status=breach として載せる）",
      asInfo.alerts.length === 0 &&
        infoCheck.status === "breach" &&
        infoCheck.below.length === 1,
      show(asInfo.report.checks),
    );

    // 対照: 同じ項目・同じデータでも alert なら通知する（info の抑制が「常に通知しない」ではないことの歯）
    const asAlert = await run({
      targetDate: "2026-09-28",
      now: NOW,
      mode: "live",
      checks: [{ ...monthlyCheck, id: "synthetic.alert", severity: "alert" }],
      callFunction: makeCaller({ overrides }),
    });
    t(
      "対照: 同じ未達でも severity が alert なら通知する",
      asAlert.alerts.length === 1 &&
        asAlert.report.checks.find((c) => c.id === "synthetic.alert")
          ?.status === "breach",
      show(asAlert.alerts.map((a) => a.key)),
    );
  }
  // shadow
  {
    const rows = dates.map((d) =>
      coverageRow(d, d === "2026-09-18" ? { odds: 50 } : {}),
    );
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "shadow",
      callFunction: makeCaller({ coverage: rows }),
      previousEmitted: {
        old: { firstAt: "2026-09-01", lastAt: "2026-09-01", missing: 1 },
      },
    });
    t(
      "shadow: 通知（alerts）は出さず、出すはずだった内容を wouldAlert に残す。通知の状態（emitted）は更新しない",
      out.report.alerts.length === 0 &&
        out.report.wouldAlert.length === 1 &&
        show(out.report.emitted) ===
          show({
            old: { firstAt: "2026-09-01", lastAt: "2026-09-01", missing: 1 },
          }),
      show(out.report),
    );
  }
}

export async function scenariosForJobPart5(results, t, run) {
  // 一部の関数の失敗
  {
    const out = await run({
      targetDate: TARGET,
      now: NOW,
      mode: "live",
      callFunction: makeCaller({
        fail: { data_health_pit_reports: "statement timeout" },
      }),
    });
    t(
      "一部の関数の失敗: 他の項目は判定を続け、失敗した関数は「検査を実行できなかった」通知にする",
      out.alerts.length === 1 &&
        out.alerts[0].text.includes("検査を実行できませんでした") &&
        out.alerts[0].text.includes("statement timeout") &&
        out.report.checks.find((c) => c.id === "coverage.result").status ===
          "ok",
      show(out.alerts),
    );
    const again = await run({
      targetDate: "2026-09-23",
      now: NOW,
      mode: "live",
      callFunction: makeCaller({
        fail: { data_health_pit_reports: "statement timeout" },
      }),
      previousEmitted: out.report.emitted,
    });
    t(
      "一部の関数の失敗: 失敗が続いても、翌日は通知しない（一意性）",
      again.alerts.length === 0,
    );
  }
  // 全ての失敗
  {
    let thrown = null;
    try {
      await run({
        targetDate: TARGET,
        now: NOW,
        mode: "live",
        callFunction: async () => {
          throw new Error("マイグレーション089が未適用");
        },
      });
    } catch (e) {
      thrown = e;
    }
    t(
      "全ての関数が失敗: 成功にせず例外にする（実行の失敗として記録される）",
      thrown !== null &&
        thrown.message.includes("全て失敗") &&
        thrown.message.includes("089"),
      thrown?.message,
    );
  }
  return results;
}
