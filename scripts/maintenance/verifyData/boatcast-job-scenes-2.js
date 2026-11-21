/**
 * verify-boatcast-job.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realJob from "../../lib/boatcast/oritenJob.js";
import {
  createPacer,
  BOATCAST_MIN_INTERVAL_MS,
  buildOritenUrl,
  buildMotorStartUrl,
  CANARY_URL,
} from "../../lib/boatcast/boatcastClient.js";
import { SCRAPE_JOBS, SOFT_DEADLINE_MARGIN_SEC } from "../../lib/scrapeJobs/registry.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import {
  same,
  show,
  createFakeFetch,
  routeOriten,
  THREE,
  FORBIDDEN,
  freshClient,
  RACE_ID,
} from "./boatcast-job-fixtures.js";
import { runWrapped } from "./boatcast-job-scenes-1.js";

let check, createVirtualClock, SLOT;

async function scene1() {
  {
    // 発走20分前から6分前まで2分おき（全レース）。1スロットの再試行の列として、共通ラッパ・ハンドラー・decideNotPublished・
    // computeRetryAt を通して確かめる。Cron は毎分 :05 秒に起動し、claim できるのは「期限 <= 今 <= 期限+許容幅」かつ
    // 「再試行の時刻 <= 今」（claim_scrape_slots と同じ。memoryStore は claim を再現しないため、ここで判定する）
    const def = SCRAPE_JOBS.boatcast_oriten;
    const START_MS = new Date("2026-09-21T10:30:00+09:00").getTime();
    const CRON_SEC = 5;
    async function simulate(publishAtMin) {
      const offset = def.offsets[0];
      const deadlineMs = START_MS + offset * 60000;
      const windowEndMs = deadlineMs + def.graceMin * 60000;
      let nextAttemptMs = 0;
      const attempts = [];
      let final = null;
      for (let min = offset - 2; min <= 40 && !final; min++) {
        const nowMs = START_MS + min * 60000 + CRON_SEC * 1000;
        if (nowMs < deadlineMs || nowMs > windowEndMs) continue;
        if (nowMs < nextAttemptMs) continue;
        attempts.push(min);
        const published = nowMs >= START_MS + publishAtMin * 60000;
        const fetchImpl = createFakeFetch(
          routeOriten(() =>
            published ? { status: 200, body: THREE } : FORBIDDEN,
          ),
        );
        const { store } = await runWrapped({
          mode: "shadow",
          client: freshClient(),
          fetchImpl,
          now: () => new Date(nowMs),
          slots: [
            SLOT(RACE_ID, {
              offset_min: offset,
              last_attempt_at: new Date(nowMs).toISOString(),
              lease_until: new Date(nowMs + def.leaseSec * 1000).toISOString(),
            }),
          ],
        });
        if (store.completed.length > 0) {
          final = store.completed[0].outcome;
        } else if (store.retried.length === 1) {
          nextAttemptMs = new Date(store.retried[0].retryAt).getTime();
        } else {
          final = "unexpected";
        }
      }
      return { attempts, final };
    }
    const never = await simulate(Infinity);
    check(
      "(d) 窓: 未公開のままなら、取得は発走の -20,-18,-16,-14,-12,-10,-8,-6 分（2分おき）→ 窓の後に -1・+7 分 → 打ち切り（最大10回。窓の中は古い5分・8分の再試行を使わない）",
      same(never.attempts, [-20, -18, -16, -14, -12, -10, -8, -6, -1, 7]) &&
        never.final === "skipped_not_target",
      show(never),
    );
    const median = await simulate(-11.4);
    check(
      "(d) 窓: 発走11.4分前に公開（実測の中央値）→ -10 分の取得で完了し、それ以降は取りに行かない（6回）",
      same(median.attempts, [-20, -18, -16, -14, -12, -10]) &&
        median.final === "ok",
      show(median),
    );
    const early = await simulate(-25.2);
    check(
      "(d) 窓: 窓の前に公開済み（発走25.2分前、実測の最大）→ -20 分の1回で完了",
      same(early.attempts, [-20]) && early.final === "ok",
      show(early),
    );
    const late = await simulate(-2.3);
    check(
      "(d) 窓: 窓の後に公開（発走2.3分前、実測の最小）→ 窓の後の -1 分の取得で完了（9回）",
      same(late.attempts, [-20, -18, -16, -14, -12, -10, -8, -6, -1]) &&
        late.final === "ok",
      show(late),
    );
    check(
      "(d) 窓: 最後の取得（+7分）は、許容幅（期限+graceMin）の5分以上手前（Cronの遅れで expired にしない）",
      7 + 5 <= def.offsets[0] + def.graceMin,
      show([def.offsets, def.graceMin]),
    );
  }
}

async function scene2() {
  {
    // 1回の起動の件数（claimLimit）: 10/18〜10/24 の races と公開時刻から求めた1分あたりの取得の最大は6件、hq の見積りは約7件
    // （PR本文の見積り）。大きいほうの7件以上で、全件を処理しても、ソフトデッドライン（maxDuration−30秒）とリース（leaseSec）の
    // 中に収まる
    const def = SCRAPE_JOBS.boatcast_oriten;
    const PEAK_PER_MIN = 7;
    const tickSec = (def.claimLimit + 1) * def.slotSecEstimate; // +1 はカナリア
    check(
      `(d) claimLimit: 1分あたりの最大（${PEAK_PER_MIN}件）以上で、1回の起動（カナリア＋${def.claimLimit}件×${def.slotSecEstimate}秒=${tickSec}秒）がソフトデッドラインとリースの中に収まる。同時数は1のまま`,
      def.offsets.length === 1 &&
        def.claimLimit >= PEAK_PER_MIN &&
        tickSec <= def.maxDurationSec - SOFT_DEADLINE_MARGIN_SEC &&
        tickSec <= def.leaseSec &&
        def.concurrency === 1,
      show(def),
    );
  }
  {
    // リクエストの間隔（2.2秒以上）
    let t = 0;
    const sleeps = [];
    const pacer = createPacer({
      minIntervalMs: BOATCAST_MIN_INTERVAL_MS,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    const started = [];
    for (let i = 0; i < 4; i++) {
      await pacer.wait();
      started.push(t);
      t += 100; // リクエスト自体の所要時間
    }
    const gaps = started.slice(1).map((s, i) => s - started[i]);
    check(
      "(d) リクエストの間隔は、直前の開始から2.2秒以上（調査時と同じ2秒に余裕）",
      BOATCAST_MIN_INTERVAL_MS >= 2200 && gaps.every((g) => g >= 2200),
      show(gaps),
    );
    // 並行して呼んでも、順番に間隔を空ける（仮想の時計。実時間・実タイマーには依存しない → 負荷でぶれない）
    const clock = createVirtualClock();
    const p2 = createPacer({
      minIntervalMs: 30,
      now: clock.now,
      sleep: clock.sleep,
    });
    const starts = [];
    await clock.runUntil(
      Promise.all(
        [0, 1, 2].map(async () => {
          await p2.wait();
          starts.push(clock.now());
        }),
      ),
    );
    check(
      "(d) 並行して呼んでも、全て間隔以上ずつ空く（順番に通す）",
      starts.length === 3 && starts.slice(1).every((x, k) => x - starts[k] >= 30),
      show(starts),
    );
    check(
      "(d) URLの組み立て: txt/{jo}/bc_oriten_{日}_{jo}_{rr}.txt、モーター使用開始日は hp_txt/（txt/ は403）",
      buildOritenUrl("2026-09-21-05-01") ===
        "https://race.boatcast.jp/txt/05/bc_oriten_20260921_05_01.txt" &&
        buildMotorStartUrl("12") ===
          "https://race.boatcast.jp/hp_txt/12/bc_mst_12.txt" &&
        CANARY_URL === buildMotorStartUrl("12"),
    );
  }
}

async function scene3() {
  // ---------------------------------------------------------------------------
  // (e) 予定表・通知
  // ---------------------------------------------------------------------------
  {
    const races = [
      ["03", "10:00:00"], // 江戸川（対象外）
      ["05", "10:30:00"],
      ["12", "15:19:00"],
      ["05", "07:00:00"], // 期限+許容幅を過ぎたレース（作らない）
    ].map(([jo, start], i) => ({
      race_id: `2026-09-21-${jo}-${String(i + 1).padStart(2, "0")}`,
      race_date: "2026-09-21",
      start_time: start,
    }));
    const client = freshClient({ races });
    const store = realJob.createOritenStore(client, {
      base: createMemoryStore(),
    });
    const created = await store.ensureSlots({
      date: "2026-09-21",
      now: new Date("2026-09-21T10:00:00+09:00"),
    });
    const ids = client.data.scrape_slots.map((s) => s.race_id).sort();
    check(
      "(e) 予定表: 公開マップの対象会場のレースにだけスロットを作る（江戸川・期限+許容幅を過ぎたものは作らない）",
      created === 2 &&
        same(ids, ["2026-09-21-05-02", "2026-09-21-12-03"]) &&
        client.data.scrape_slots.every(
          (s) => s.job === realJob.ORITEN_JOB && s.offset_min === -20,
        ),
      show(ids),
    );
  }
  {
    // 切り替えの日: 既に別の offset（旧 -8）のスロットがあるレースには、新しい -20 のスロットを作らない
    // （1レース1本の再試行の列にして、二重に取らない）。スロットの無いレースにだけ作る
    const races = ["01", "02"].map((rr) => ({
      race_id: `2026-09-21-05-${rr}`,
      race_date: "2026-09-21",
      start_time: "12:00:00",
    }));
    const client = freshClient({
      races,
      scrape_slots: [
        {
          job: realJob.ORITEN_JOB,
          race_id: "2026-09-21-05-01",
          offset_min: -8,
          race_date: "2026-09-21",
          status: "pending",
        },
      ],
    });
    const store = realJob.createOritenStore(client, {
      base: createMemoryStore(),
    });
    const created = await store.ensureSlots({
      date: "2026-09-21",
      now: new Date("2026-09-21T10:00:00+09:00"),
    });
    const keys = client.data.scrape_slots
      .map((s) => `${s.race_id}@${s.offset_min}`)
      .sort();
    check(
      "(e) 予定表: 既にスロットのあるレース（旧 -8）には -20 を足さない。スロットの無いレースにだけ作る",
      created === 1 &&
        same(keys, ["2026-09-21-05-01@-8", "2026-09-21-05-02@-20"]),
      show(keys),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・createVirtualClock・SLOT） */
export async function runBoatcastJobScenes2(env) {
  ({ check, createVirtualClock, SLOT } = env);
  await scene1();
  await scene2();
  await scene3();
}
