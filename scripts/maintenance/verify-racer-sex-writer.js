#!/usr/bin/env node
/**
 * racer_sex（214）の書き手（scripts/lib/racerSexRows.js・fanPeriodJob.js の1段・racer-sex-backfill.js）: 1・2 だけを書く、sex だけを比べる、男女が逆なら書かずに警告、updated_at を入れる、racer_period_stats より先に書き失敗なら stats を書かない、shadow・dry-run は書かない
 *
 * 設計: docs/design/data-gaps/db-draft.md §1.5（M5）。DB は偽のクライアント（scripts/lib/fakeSupabaseClient.js）、
 * fan は scripts/lib/__fixtures__/fan/fan-sample.json（fan2604 の実レコード12人分）。ネットワーク・実DBに繋がない。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRacerSexRows,
  planRacerSexWrites,
  syncRacerSex,
} from "../lib/racerSexRows.js";
import { runFanPeriodJob } from "../lib/fanPeriodJob.js";
import { parseFanFile } from "../lib/fanPeriodParser.js";
import { fakeClient } from "../lib/fakeSupabaseClient.js";
import { parseArgs, readFans, run } from "./racer-sex-backfill.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NOW = new Date("2026-11-29T00:00:00Z");
const STAMP = NOW.toISOString();
let passed = 0;
async function check(label, fn) {
  await fn();
  passed++;
  console.log(`✅ ${label}`);
}

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "scripts/lib/__fixtures__/fan/fan-sample.json"),
    "utf8",
  ),
);
const FAN_BYTES = new Uint8Array(
  Buffer.concat(
    FIXTURE.files.fan2604.records.flatMap((r) => [
      Buffer.from(r.b64, "base64"),
      Buffer.from([0x0d, 0x0a]),
    ]),
  ),
);
const FAN = parseFanFile(FAN_BYTES, { id: "fan2604" });
const SEXES = FAN.records.map((r) => [r.racer_id, r.sex]);

const fan = (id, records) => ({ id, schema: FAN.schema, records });
const rec = (racer_id, sex) => ({ racer_id, sex });

// 1. fan → 行
await check("fixture は男女の両方を含む（以下の確かめの前提）", () => {
  assert.equal(SEXES.length, 12);
  assert.ok(SEXES.some(([, s]) => s === 1) && SEXES.some(([, s]) => s === 2));
});
await check(
  "buildRacerSexRows: 1・2 だけを行にし、それ以外は数える。登番が無いレコードは数えない",
  () => {
    const { rows, skipped } = buildRacerSexRows(
      fan("fan2510", [
        rec(1, 1),
        rec(2, 2),
        rec(3, 0),
        rec(4, null),
        rec(null, 1),
        rec(5, 3),
      ]),
    );
    assert.deepEqual(rows, [
      { racer_id: 1, sex: 1, source_fan: "fan2510" },
      { racer_id: 2, sex: 2, source_fan: "fan2510" },
    ]);
    assert.equal(skipped, 3);
  },
);
await check("buildRacerSexRows: 登番の重複は例外", () => {
  assert.throws(
    () => buildRacerSexRows(fan("fan2510", [rec(1, 1), rec(1, 1)])),
    /重複/,
  );
});

// 2. 比べ方
await check(
  "planRacerSexWrites: 無い選手は updated_at つきで書く・同じ値は書かない・逆は書かずに分ける",
  () => {
    const plan = planRacerSexWrites(
      [
        { racer_id: 1, sex: 1 },
        { racer_id: 2, sex: 2 },
      ],
      [
        { racer_id: 1, sex: 1, source_fan: "fan2604" },
        { racer_id: 2, sex: 1, source_fan: "fan2604" },
        { racer_id: 3, sex: 2, source_fan: "fan2604" },
      ],
      STAMP,
    );
    assert.deepEqual(plan.toWrite, [
      { racer_id: 3, sex: 2, source_fan: "fan2604", updated_at: STAMP },
    ]);
    assert.equal(plan.unchanged, 1);
    assert.deepEqual(plan.conflicts, [{ racer_id: 2, before: 2, after: 1 }]);
  },
);

// 3. 読み書き
await check(
  "syncRacerSex: 既存と source_fan が違っても sex が同じなら書かない。逆は警告して元の値を残す",
  async () => {
    const tables = {
      racer_sex: [
        { racer_id: 1, sex: 1, source_fan: "fan1904" },
        { racer_id: 2, sex: 2, source_fan: "fan1904" },
      ],
    };
    const client = fakeClient(tables);
    const r = await syncRacerSex(
      client,
      fan("fan2604", [rec(1, 1), rec(2, 1), rec(3, 2)]),
      { now: NOW },
    );
    assert.deepEqual(
      {
        rows: r.rows,
        written: r.written,
        unchanged: r.unchanged,
        conflicts: r.conflicts.length,
      },
      { rows: 3, written: 1, unchanged: 1, conflicts: 1 },
    );
    assert.match(r.warnings[0], /登番 2 の性別が既存（2）と逆（1）/);
    assert.deepEqual(tables.racer_sex, [
      { racer_id: 1, sex: 1, source_fan: "fan1904" },
      { racer_id: 2, sex: 2, source_fan: "fan1904" },
      { racer_id: 3, sex: 2, source_fan: "fan2604", updated_at: STAMP },
    ]);
  },
);
await check(
  "syncRacerSex: 1000行を超える既存を全部読む（1001行目の選手も逆と分かる）",
  async () => {
    const existing = Array.from({ length: 1500 }, (_, i) => ({
      racer_id: i + 1,
      sex: 1,
    }));
    const tables = { racer_sex: existing.map((e) => ({ ...e })) };
    const r = await syncRacerSex(
      fakeClient(tables),
      fan("fan2604", [rec(1200, 2), rec(1501, 2)]),
      { now: NOW },
    );
    assert.equal(r.conflicts.length, 1);
    assert.equal(r.written, 1);
    assert.equal(tables.racer_sex.length, 1501);
  },
);
await check("syncRacerSex: dryRun は書かない", async () => {
  const tables = { racer_sex: [] };
  const r = await syncRacerSex(
    fakeClient(tables),
    fan("fan2604", [rec(1, 1)]),
    { dryRun: true },
  );
  assert.equal(r.written, 0);
  assert.equal(tables.racer_sex.length, 0);
});
await check("syncRacerSex: 読めない・書けないは例外", async () => {
  await assert.rejects(
    syncRacerSex(
      fakeClient({}, { missing: new Set(["racer_sex"]) }),
      fan("fan2604", [rec(1, 1)]),
    ),
    /racer_sex の取得に失敗/,
  );
  await assert.rejects(
    syncRacerSex(
      fakeClient({ racer_sex: [] }, { failUpsert: true }),
      fan("fan2604", [rec(1, 1)]),
    ),
    /racer_sex への書き込みに失敗（0\/1行で停止）/,
  );
});

// 4. 毎日の Cron の1段
function jobCtx({
  mode = "live",
  tables = {},
  missing,
  query = {},
  date = "2026-06-10",
} = {}) {
  const client = fakeClient(tables, { missing });
  const uploads = [];
  client.storage = {
    from: () => ({
      async upload(p) {
        uploads.push(p);
        return { error: null };
      },
    }),
  };
  const urls = [];
  return {
    tables,
    uploads,
    urls,
    ctx: {
      targetDate: date,
      mode,
      client,
      query,
      worker: "test",
      politeFetch: async (url) => {
        urls.push(url);
        return new Response(FAN_BYTES, { status: 200 });
      },
    },
  };
}
const OPTS = { sleepMs: 0, decode: async (b) => b, minRecords: 10 };
const sexRowsOf = (tables) =>
  (tables.racer_sex ?? [])
    .map((r) => [r.racer_id, r.sex])
    .sort((a, b) => a[0] - b[0]);
const expectedSex = [...SEXES].sort((a, b) => a[0] - b[0]);

await check(
  "fanPeriodJob（live）: 取り込みで racer_sex に全員の性別を書き、報告に数を載せる",
  async () => {
    const t = jobCtx();
    const res = await runFanPeriodJob(t.ctx, OPTS);
    assert.equal(res.report.status, "imported");
    assert.deepEqual(sexRowsOf(t.tables), expectedSex);
    assert.ok(
      t.tables.racer_sex.every(
        (r) => r.source_fan === "fan2604" && r.updated_at,
      ),
    );
    assert.deepEqual(res.report.racerSex, {
      rows: 12,
      skipped: 0,
      written: 12,
      unchanged: 0,
      conflicts: 0,
    });
    assert.equal(res.rowsWritten, 12);
    assert.equal(t.tables.racer_period_stats.length, 12);
  },
);
await check(
  "fanPeriodJob: racer_sex を読めなければ例外で、racer_period_stats も生ファイルも書かない",
  async () => {
    const t = jobCtx({ missing: new Set(["racer_sex"]) });
    await assert.rejects(
      runFanPeriodJob(t.ctx, OPTS),
      /racer_sex の取得に失敗/,
    );
    assert.equal((t.tables.racer_period_stats ?? []).length, 0);
    assert.equal(t.uploads.length, 0);
  },
);
await check(
  "fanPeriodJob（shadow）: racer_sex を書かず、書く候補を数える",
  async () => {
    const t = jobCtx({ mode: "shadow" });
    const res = await runFanPeriodJob(t.ctx, OPTS);
    assert.equal(res.report.status, "parsed");
    assert.equal((t.tables.racer_sex ?? []).length, 0);
    assert.deepEqual(res.report.racerSex, {
      rows: 12,
      skipped: 0,
      written: 0,
      unchanged: 0,
      conflicts: 0,
    });
  },
);
await check(
  "fanPeriodJob: 取り直し（?fanId=）では変わらない性別を書かず、逆の1人は警告に出して残す",
  async () => {
    const [flipId, flipSex] = SEXES[0];
    const t = jobCtx({ query: { fanId: "fan2604" } });
    await runFanPeriodJob(t.ctx, OPTS);
    const row = t.tables.racer_sex.find((r) => r.racer_id === flipId);
    row.sex = 3 - flipSex;
    const res = await runFanPeriodJob(t.ctx, OPTS);
    assert.deepEqual(res.report.racerSex, {
      rows: 12,
      skipped: 0,
      written: 0,
      unchanged: 11,
      conflicts: 1,
    });
    assert.ok(
      res.report.warnings.some((w) =>
        w.includes(`登番 ${flipId} の性別が既存`),
      ),
    );
    assert.equal(row.sex, 3 - flipSex);
    assert.equal(res.incomplete, true);
  },
);
await check(
  "fanPeriodJob: 取り込み済みの期は取得も racer_sex の読みもしない",
  async () => {
    const t = jobCtx({
      tables: {
        racer_period_stats: [{ racer_id: 1, period_year: 2026, period_no: 2 }],
      },
    });
    const res = await runFanPeriodJob(t.ctx, OPTS);
    assert.equal(res.report.status, "already_imported");
    assert.equal(t.urls.length, 0);
    assert.equal(t.tables.racer_sex, undefined);
  },
);

// 5. 過去分の CLI
await check(
  "CLI parseArgs: --from・--to は必須、不明なオプションと形式の誤りは例外",
  () => {
    assert.deepEqual(
      (({ from, to, apply }) => ({ from, to, apply }))(
        parseArgs(["--from=fan1904", "--to=fan2604", "--apply"]),
      ),
      { from: "fan1904", to: "fan2604", apply: true },
    );
    assert.equal(parseArgs(["--from=fan1904", "--to=fan2604"]).apply, false);
    assert.throws(() => parseArgs(["--from=fan1904"]), /--from と --to/);
    assert.throws(
      () => parseArgs(["--from=fan1904", "--to=fan2604", "--force"]),
      /不明なオプション/,
    );
    assert.throws(() => parseArgs(["--from=fan1905", "--to=fan2604"]));
  },
);
const FANS = {
  fan2510: fan("fan2510", [rec(1, 1), rec(2, 2)]),
  fan2604: fan("fan2604", [rec(1, 1), rec(2, 1), rec(3, 2)]),
};
const read = (_dir, id) => FANS[id] ?? null;
const quiet = () => {};
await check(
  "CLI readFans: 古い順に読み、範囲に中間JSONの無い fan・違うスキーマがあれば書く前に例外",
  () => {
    assert.deepEqual(
      readFans({ from: "fan2510", to: "fan2604" }, read).map((f) => f.id),
      ["fan2510", "fan2604"],
    );
    assert.throws(
      () => readFans({ from: "fan2504", to: "fan2604" }, read),
      /中間JSONがありません: fan2504/,
    );
    assert.throws(
      () => readFans({ from: "fan2604", to: "fan2510" }, read),
      /以前/,
    );
    assert.throws(
      () =>
        readFans({ from: "fan2510", to: "fan2510" }, () => ({
          ...FANS.fan2510,
          schema: "x",
        })),
      /未対応のスキーマ/,
    );
  },
);
await check(
  "CLI run: 既定は書かない。--apply は古い順に書き、後の fan の逆は書かない",
  async () => {
    const opts = { from: "fan2510", to: "fan2604", archiveDir: "x" };
    const dry = { racer_sex: [] };
    assert.equal(
      await run(
        { ...opts, apply: false },
        { client: fakeClient(dry), read, log: quiet, now: NOW },
      ),
      0,
    );
    assert.equal(dry.racer_sex.length, 0);
    const tables = { racer_sex: [] };
    const lines = [];
    const code = await run(
      { ...opts, apply: true },
      { client: fakeClient(tables), read, log: (l) => lines.push(l), now: NOW },
    );
    assert.equal(code, 0);
    assert.deepEqual(
      tables.racer_sex.map((r) => [r.racer_id, r.sex, r.source_fan]),
      [
        [1, 1, "fan2510"],
        [2, 2, "fan2510"],
        [3, 2, "fan2604"],
      ],
    );
    assert.equal(lines.at(-1), "書いた 3 / 変わらない 1 / 逆 1");
  },
);
await check("CLI run: 書く行も変わらない行も0なら 1", async () => {
  const empty = () => fan("fan2510", [rec(1, 0)]);
  const code = await run(
    { from: "fan2510", to: "fan2510", archiveDir: "x", apply: true },
    { client: fakeClient({ racer_sex: [] }), read: empty, log: quiet },
  );
  assert.equal(code, 1);
});

console.log(`\n全件成功（${passed}件）`);
