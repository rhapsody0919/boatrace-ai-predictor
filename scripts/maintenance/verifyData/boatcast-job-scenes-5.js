/**
 * verify-boatcast-job.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as realParser from "../../lib/boatcast/oritenParser.js";
import * as realJob from "../../lib/boatcast/oritenJob.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { freshClient, RACE_ID, createFakeFetch, FORBIDDEN } from "./boatcast-job-fixtures.js";
import { evaluateRows } from "./boatcast-job-parse-rows.js";
import { evaluateJob } from "./boatcast-job-job.js";
import { safeEval } from "./boatcast-job-scenes-4.js";
import { noWaitPacer, NOW } from "./boatcast-job-scenes-1.js";

let check, SLOT, withMutant;

const rowsMutants = [
  [
    "値の行の kind を項目の位置（番号）にする",
    [["kind: label,", "kind: String(i),"]],
  ],
  [
    "ハッシュに選手名を含める",
    [
      [
        "rows: [...parsed.rows]\n      .sort((a, b) => a.boatNumber - b.boatNumber)\n      .map((r) => [r.boatNumber, r.values]),",
        "rows: [...parsed.rows]\n      .sort((a, b) => a.boatNumber - b.boatNumber)\n      .map((r) => [r.boatNumber, r.racerName, r.values]),",
      ],
    ],
  ],
  [
    "公開時刻（Last-Modified）を保存しない",
    [
      [
        "source_last_modified: parseLastModified(lastModified),",
        "source_last_modified: null,",
      ],
    ],
  ],
  [
    "403を常に再試行する（打ち切らない）",
    [
      [
        "if (minutesToStart <= policy.finalAtOrBelowMin) return { final: true };",
        "",
      ],
    ],
  ],
  [
    "403の再試行の間隔を延ばさない（常に5分）",
    [
      [
        "return { final: false, retrySec: policy.secondRetrySec };",
        "return { final: false, retrySec: policy.firstRetrySec };",
      ],
    ],
  ],
  [
    "窓の中でも古い5分の規則で再試行する（2分おきにしない）",
    [
      [
        "return { final: false, retrySec: policy.windowRetrySec };",
        "return { final: false, retrySec: policy.firstRetrySec };",
      ],
    ],
  ],
  [
    "窓の後も2分おきを続ける（後段の規則に移らない）",
    [
      [
        "if (minutesToStart > policy.windowRetryAboveMin) {",
        "if (minutesToStart > policy.finalAtOrBelowMin) {",
      ],
    ],
  ],
  [
    "発走時刻が不明でも待つ（バックフィルで打ち切らない）",
    [
      [
        "if (!Number.isFinite(minutesToStart)) return { final: true };",
        "if (!Number.isFinite(minutesToStart)) return { final: false, retrySec: 300 };",
      ],
    ],
  ],
  [
    "計測不可のレースの行を作らない",
    [
      [
        "parsed.status !== ORITEN_STATUSES.measured &&\n    parsed.status !== ORITEN_STATUSES.unmeasurable",
        "parsed.status !== ORITEN_STATUSES.measured",
      ],
    ],
  ],
];

const jobMutants = [
  ["shadow でも書き込む", [['if (mode !== "live") {', "if (false) {"]]],
  [
    "計測不可でも、値の期待件数を持つ（0件エラーになる）",
    [
      [
        "rowsExpected: measured ? expectedValueRows(jo, 6, map) : 0,",
        "rowsExpected: expectedValueRows(jo, 6, map),",
      ],
    ],
  ],
  [
    "書く順序を逆にする（レース単位の行を先に書く）",
    [
      [
        '    "race_original_exhibition_values",\n      rows.values,',
        '    "race_original_exhibition_values_X",\n      rows.values,',
      ],
    ],
  ],
  [
    "091の適用を確認せずに書く",
    [
      [
        "if (!(await detectBoatcastSchema(client, ORITEN_TABLES))) {",
        "if (false) {",
      ],
    ],
  ],
  [
    "403を、カナリアの確認後でも常にデータ無しにする（再試行しない）",
    [
      [
        "const decision = decideNotPublished(minutesToStart);",
        "const decision = { final: true };",
      ],
    ],
  ],
  [
    "HTTP 403以外のエラーを error にせず成功扱いにする",
    [["if (res.status !== 200) {", "if (res.status !== 200 && false) {"]],
  ],
  [
    "構造の異常でも書き込む",
    [["if (parsed.status === ORITEN_STATUSES.unrecognized) {", "if (false) {"]],
  ],
  [
    "マップ外の会場（江戸川）も取得する",
    [['if (!entry || entry.status !== "public") {', "if (false) {"]],
  ],
  [
    "古い値の行を消さない",
    [
      [
        "if (existing) {\n    // 内容が変わったとき",
        "if (false) {\n    // 内容が変わったとき",
      ],
    ],
  ],
];

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 予定表: 対象会場の絞り込みを外すと、対象外の会場（江戸川）のスロットができる
  const failedEnsure = await withMutant(
    "oritenJob.js",
    [
      [
        'venueEntry(venueOfRaceId(r.race_id), map)?.status === "public",',
        "true,",
      ],
    ],
    async (m) => {
      const races = [
        {
          race_id: "2026-09-21-03-01",
          race_date: "2026-09-21",
          start_time: "10:00:00",
        },
        {
          race_id: "2026-09-21-05-02",
          race_date: "2026-09-21",
          start_time: "10:30:00",
        },
      ];
      const client = freshClient({ races });
      const store = m.createOritenStore(client, { base: createMemoryStore() });
      await store.ensureSlots({
        date: "2026-09-21",
        now: new Date("2026-09-21T10:00:00+09:00"),
      });
      return client.data.scrape_slots.some((s) => s.race_id.includes("-03-"))
        ? ["江戸川のスロットができた"]
        : [];
    },
  );
  check(
    `(i) 変異検証（予定表）: 対象会場の絞り込みを外すと、対象外のスロットができる → 検証が失敗する（${failedEnsure.length}項目）`,
    failedEnsure.length > 0,
  );
  // 予定表: 既存スロットの確認を外すと、旧 offset のスロットがあるレースにも新しいスロットができる（二重の取得）
  const failedDedupe = await withMutant(
    "oritenJob.js",
    [["!hasSlot.has(r.race_id) &&", ""]],
    async (m) => {
      const client = freshClient({
        scrape_slots: [
          {
            job: realJob.ORITEN_JOB,
            race_id: RACE_ID,
            offset_min: -8,
            race_date: "2026-09-21",
            status: "pending",
          },
        ],
      });
      const store = m.createOritenStore(client, { base: createMemoryStore() });
      await store.ensureSlots({
        date: "2026-09-21",
        now: new Date("2026-09-21T10:00:00+09:00"),
      });
      return client.data.scrape_slots.length > 1
        ? ["旧 offset のスロットがあるレースに新しいスロットができた"]
        : [];
    },
  );
  check(
    `(i) 変異検証（予定表）: 既存スロットの確認を外すと、同じレースに2本目のスロットができる → 検証が失敗する（${failedDedupe.length}項目）`,
    failedDedupe.length > 0,
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2() {
  // カナリア: 失敗でもデータを取りに行く
  const failedCanary = await withMutant(
    "oritenJob.js",
    [["if (!canaryResult.ok) {", "if (false) {"]],
    async (m) => {
      const client = freshClient();
      const fetchImpl = createFakeFetch(() => FORBIDDEN);
      realJob.clearTicks();
      const memory = createMemoryStore({
        rows: {
          [realJob.ORITEN_JOB]: {
            job: realJob.ORITEN_JOB,
            mode: "live",
            consecutive_failures: 0,
          },
        },
        slots: [SLOT(RACE_ID)],
      });
      await runScrapeJob({
        job: realJob.ORITEN_JOB,
        store: m.createOritenStore(client, { base: memory }),
        handleSlot: m.createOritenSlotHandler({
          pacer: noWaitPacer,
          venueNoData: async () => null,
        }),
        now: NOW,
        client,
        politeFetch: fetchImpl,
      });
      return fetchImpl.calls.length > 1
        ? ["カナリアが失敗でもデータを取った"]
        : [];
    },
  );
  check(
    `(i) 変異検証（カナリア）: カナリアが失敗でも取得を続けると、リクエストが増える → 検証が失敗する（${failedCanary.length}項目）`,
    failedCanary.length > 0,
  );
}

async function scene3() {
  for (const [label, replacements] of rowsMutants) {
    const failed = await withMutant("oritenRows.js", replacements, async (m) =>
      safeEval(() => evaluateRows(m, realParser)),
    );
    check(
      `(i) 変異検証（行の組み立て）: ${label} → 検証が失敗する（${failed.length}項目）`,
      failed.length > 0,
    );
  }
  for (const [label, replacements] of jobMutants) {
    try {
      const failed = await withMutant("oritenJob.js", replacements, async (m) =>
        safeEval(() => evaluateJob(m.processOritenRace)),
      );
      check(
        `(i) 変異検証（取得ジョブ）: ${label} → 検証が失敗する（${failed.length}項目）`,
        failed.length > 0,
      );
    } catch (e) {
      check(`(i) 変異検証（取得ジョブ）: ${label}`, false, e.message);
    }
  }
  {
    await scene1();
    await scene2();
  }
  {
    const failedPacer = await withMutant(
      "boatcastClient.js",
      [["const startAt = Math.max(t, nextAllowedAt);", "const startAt = t;"]],
      async (m) => {
        let t = 0;
        const p = m.createPacer({
          minIntervalMs: 2200,
          now: () => t,
          sleep: async (ms) => {
            t += ms;
          },
        });
        const s = [];
        for (let i = 0; i < 3; i++) {
          await p.wait();
          s.push(t);
        }
        return s.slice(1).every((x, i) => x - s[i] >= 2200)
          ? []
          : ["間隔が空かない"];
      },
    );
    check(
      `(i) 変異検証（間隔）: 間隔を空けないと検証が失敗する（${failedPacer.length}項目）`,
      failedPacer.length > 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・SLOT・withMutant） */
export async function runBoatcastJobScenes6(env) {
  ({ check, SLOT, withMutant } = env);
  await scene3();
}
