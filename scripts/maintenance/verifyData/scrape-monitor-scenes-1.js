/**
 * verify-scrape-monitor.js の後半の場面（1/8）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-monitor.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  computeWindowStats,
  aggregateByJob,
  evaluateWindowRates,
  evaluateExpired,
  THRESHOLDS,
} from "../../lib/scrapeJobs/monitor.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let check, show, DATE, at, iso, slot, doneOdds;
export let D, R, t;

// 10:00発走。-60=09:00〜09:03、-30=09:30〜09:33、-15=09:45〜09:48、-10=09:50〜09:53、-5=09:55〜09:58、0=10:00〜10:03
export const LATER = [-30, -15, -10, -5, 0];

export const nv = (race, over = {}) =>
  slot("odds", -60, "expired", {
    race_id: race,
    attempts: 3,
    outcome: "no_values",
    last_error:
      "単勝オッズを解析できませんでした（未公開・中止・順延の可能性）",
    ...over,
  });

export const later = (race, offsets, status, over = {}) =>
  offsets.map((o) =>
    slot("odds", o, status, {
      race_id: race,
      ...(status === "done" ? { done_at: iso(at("09:31")) } : {}),
      ...over,
    }),
  );

function scene1() {
  // ---------------------------------------------------------------------------
  // (a3) 体重だけの窓（展示の発走60分前。レジストリの weightOnlyOffsets。BOA-500）
  // ---------------------------------------------------------------------------
  {
    const noWeightOnly = {
      ...SCRAPE_JOBS,
      exhibition: { ...SCRAPE_JOBS.exhibition, weightOnlyOffsets: undefined },
    };
    // 10:00発走。-60 の期限は 09:00、-33 の期限は 09:27
    const primaryDone = () =>
      slot("exhibition", -33, "done", {
        done_at: iso(new Date(at("09:27").getTime() + 5 * 60000)),
      });
    // -33: 60件すべてヒット。-60: 体重の公開が窓より遅かった10件が expired（-33 が同じ行を埋めている）
    const slots = [
      ...Array.from({ length: 60 }, () => primaryDone()),
      ...Array.from({ length: 50 }, () =>
        slot("exhibition", -60, "done", {
          done_at: iso(new Date(at("09:00").getTime() + 60000)),
        }),
      ),
      ...Array.from({ length: 10 }, () =>
        slot("exhibition", -60, "expired", { attempts: 6 }),
      ),
    ];
    const stats = computeWindowStats(slots);
    const weightRow = stats.find((x) => x.offset_min === -60);
    const job = aggregateByJob(stats).find((j) => j.job === "exhibition");
    check(
      "体重だけの窓: 窓別の集計には残る（50/60）が、ジョブ別の窓内取得率には束ねない（-33 の60/60のまま。閾値の警告を出さない）",
      weightRow?.total === 60 &&
        weightRow?.hit === 50 &&
        job?.total === 60 &&
        job?.hit === 60 &&
        evaluateWindowRates(stats, DATE).length === 0,
      show({ weightRow, job }),
    );
    const mutantJob = aggregateByJob(stats, noWeightOnly).find(
      (j) => j.job === "exhibition",
    );
    check(
      "変異検証: 「体重だけの窓も束ねる」版では、率が 110/120 に下がり、上の検証が失敗する",
      mutantJob?.total === 120 && mutantJob?.hit === 110,
      show(mutantJob),
    );

    const active = new Set(["exhibition"]);
    const expired = [
      slot("exhibition", -60, "expired", {
        attempts: 6,
        outcome: "no_values",
        race_id: "2026-09-19-02-01",
      }),
      slot("exhibition", -60, "expired", {
        attempts: 0,
        race_id: "2026-09-19-02-02",
      }),
      slot("exhibition", -33, "expired", {
        attempts: 13,
        race_id: "2026-09-19-02-03",
      }),
    ];
    const alerts = evaluateExpired(expired, { activeJobs: active });
    check(
      "体重だけの窓: 期限切れは通知しない（体重の公開が窓より遅くても、-33 の窓が同じ行を埋める）。未実行（attempts=0。claim・Cronの不具合）は通知する。-33 の期限切れは従来どおり通知する",
      show(alerts.map((a) => a.key).sort()) ===
        show(
          [
            "expired:exhibition:2026-09-19-02-03:-33",
            "unexecuted:exhibition:2026-09-19-02-02:-60",
          ].sort(),
        ),
      show(alerts.map((a) => a.key)),
    );
    const mutantAlerts = evaluateExpired(expired, {
      activeJobs: active,
      registry: noWeightOnly,
    });
    check(
      "変異検証: 「体重だけの窓の期限切れも通知する」版では、-60 が通知され、上の検証が失敗する",
      mutantAlerts.some(
        (a) => a.key === "expired:exhibition:2026-09-19-02-01:-60",
      ),
      show(mutantAlerts.map((a) => a.key)),
    );
  }
}

function scene2() {
  // ---------------------------------------------------------------------------
  // (b) expired・未実行・窓内取得率の通知
  // ---------------------------------------------------------------------------
  {
    const active = new Set(["odds"]);
    const expired = [
      slot("odds", -60, "expired", { attempts: 0, race_id: "2026-09-19-01-01" }),
      slot("odds", -60, "expired", {
        attempts: 3,
        race_id: "2026-09-19-01-02",
        outcome: "error",
        last_error: "取得先が429",
      }),
      slot("odds", -60, "expired", {
        attempts: 2,
        cancel: "confirmed",
        race_id: "2026-09-19-01-03",
      }),
      slot("odds", -60, "expired", {
        attempts: 2,
        run_mode: "shadow",
        race_id: "2026-09-19-01-04",
      }),
      slot("result", 5, "expired", { attempts: 0, race_id: "2026-09-19-01-05" }), // result は off（有効でない）
    ];
    const alerts = evaluateExpired(expired, { activeJobs: active });
    check(
      "expired 1件ごとに通知。attempts=0 は『未実行』として区別する。確定中止・shadow・有効でないジョブは除く",
      alerts.length === 2 &&
        alerts[0].kind === "unexecuted" &&
        alerts[0].key === "unexecuted:odds:2026-09-19-01-01:-60" &&
        alerts[1].kind === "expired" &&
        /取得先が429/.test(alerts[1].text) &&
        /2026-09-19-01-02/.test(alerts[1].text) &&
        /-60/.test(alerts[1].text),
      show(alerts.map((a) => a.key)),
    );

    const many = (hit, total) =>
      computeWindowStats([
        ...Array.from({ length: hit }, () => doneOdds(1)),
        ...Array.from({ length: total - hit }, () => doneOdds(10)),
      ]);
    check(
      "窓内取得率 97.5%（39/40）は閾値98%未満で通知",
      evaluateWindowRates(many(39, 40), DATE).length === 1,
    );
    check(
      "窓内取得率 98%（49/50）は通知しない",
      evaluateWindowRates(many(49, 50), DATE).length === 0,
    );
    check(
      `母数が${THRESHOLDS.windowRateMinSamples}件未満では、率が低くても判定しない`,
      evaluateWindowRates(many(1, 10), DATE).length === 0,
    );
  }
}

function scene3() {
  // claim に依存しない検知: 期限+許容幅を超えても pending のまま残っているスロット
  {
    const now = at("12:00");
    const active = new Set(["odds", "result"]);
    const startAt = (hhmm) => `${hhmm}:00`;
    const slots = [
      // odds -60、10:00発走、期限09:00+許容幅3分=09:03。12:00には超過。pending・attempts=0 → 未実行
      slot("odds", -60, "pending", { attempts: 0, race_id: "2026-09-19-03-01" }),
      // 同じく超過。試行1回のpending → expired と同じ扱い
      slot("odds", -60, "pending", { attempts: 1, race_id: "2026-09-19-03-02" }),
      // まだ許容幅内（発走 12:30 → 期限11:30+3分=11:33 → 12:00には超過...）ではなく、期限前
      slot("odds", -60, "pending", {
        attempts: 0,
        race_id: "2026-09-19-03-03",
        start_time: startAt("14:00"),
      }),
      // running でリースが有効（処理中）→ 通知しない
      {
        ...slot("odds", -60, "running", {
          attempts: 1,
          race_id: "2026-09-19-03-04",
        }),
        lease_until: iso(new Date(now.getTime() + 30000)),
      },
      // running でリース切れ → 通知
      {
        ...slot("odds", -60, "running", {
          attempts: 1,
          race_id: "2026-09-19-03-05",
        }),
        lease_until: iso(new Date(now.getTime() - 30000)),
      },
      // 有効でないジョブ・確定中止 → 通知しない
      slot("pcexpect", -720, "pending", {
        attempts: 0,
        race_id: "2026-09-19-03-06",
      }),
      slot("odds", -60, "pending", {
        attempts: 0,
        cancel: "confirmed",
        race_id: "2026-09-19-03-07",
      }),
    ];
    const alerts = evaluateExpired(slots, { activeJobs: active, now });
    const keys = alerts.map((x) => x.key).sort();
    check(
      "claim に依存しない検知: pending・リース切れの running が期限+許容幅を超えたら、expired と同じキーで通知する（処理中・期限前・有効でないジョブ・確定中止は通知しない）",
      show(keys) ===
        show([
          "expired:odds:2026-09-19-03-02:-60",
          "expired:odds:2026-09-19-03-05:-60",
          "unexecuted:odds:2026-09-19-03-01:-60",
        ]) && alerts.every((x) => /まだexpired化されていない/.test(x.text)),
      show(keys),
    );
    check(
      "now を渡さなければ（従来の呼び出し）、pending は判定しない",
      evaluateExpired(slots, { activeJobs: active }).length === 0,
    );
  }
  // ---------------------------------------------------------------------------
  // (b2) 発売開始の遅れ（想定内の未公開。BOA-386・完了の定義Bの見直し）: 全レースの、発走60分前のオッズの未公開
  //      （延長で取得できた、または、後続の窓で公開が確認できたものだけを、警告・窓内取得率の対象外にする）
  // ---------------------------------------------------------------------------
  D = DATE;
  // 会場1の第1レースは、race_id の末尾が 03（末尾が 01 かどうかに依存しない）
  R = `${D}-01-03`;
  // 下の2つの塊で使う、会場1の第1レースの -60 の窓
  t = nv(R);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・DATE・at・iso・slot・doneOdds） */
export function runScrapeMonitorScenes1(env) {
  ({ check, show, DATE, at, iso, slot, doneOdds } = env);
  scene1();
  scene2();
  scene3();
}
