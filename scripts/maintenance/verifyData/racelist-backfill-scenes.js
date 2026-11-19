/**
 * verify-racelist-backfill.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-racelist-backfill.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { parseRaceListPage } from "../../lib/raceListParser.js";
import {
  buildFillRow,
  RACELIST_BACKFILL_COLUMNS,
  racelistArchiveRelPath,
} from "../../lib/racelistBackfillRows.js";
import * as cli from "../racelist-backfill.js";

let FIXTURES, check, existingAllNull, entry;

// ---------------------------------------------------------------------------
// 7. load: フェイククライアントでの統合確認
// ---------------------------------------------------------------------------

function fakeLoadClient({ existingRows = [], failUpsert = false } = {}) {
  const calls = { upserts: [] };
  return {
    calls,
    from(table) {
      return {
        select() {
          return {
            async in(column, ids) {
              const rows = existingRows.filter((r) => ids.includes(r[column]));
              return { data: rows.map((r) => ({ ...r })), error: null };
            },
            limit() {
              return Promise.resolve({
                data: existingRows.slice(0, 1),
                error: null,
              });
            },
          };
        },
        async upsert(batch, options) {
          if (failUpsert) return { error: { message: "boom" } };
          calls.upserts.push({
            table,
            batch: batch.map((r) => ({ ...r })),
            options,
          });
          return { error: null };
        },
      };
    },
  };
}

async function withTmpArchive(fn) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "racelist-backfill-verify-"),
  );
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeParsedFixture(dir, raceId, entries) {
  const rel = racelistArchiveRelPath(raceId, "json.gz");
  const file = path.join(dir, "parsed", rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    zlib.gzipSync(
      JSON.stringify({
        schema: "racelist-backfill/v1",
        race_id: raceId,
        entries,
        anomalies: [],
      }),
    ),
  );
}

async function scene1() {
  // ---------------------------------------------------------------------------
  // 6. 実ページのフィクスチャ（scripts/lib/__fixtures__/raceInfo/）
  // ---------------------------------------------------------------------------

  {
    const html = fs.readFileSync(
      path.join(FIXTURES, "racelist-2026-09-16-23-12-absent.html"),
      "utf8",
    );
    const page = parseRaceListPage(html);
    const absentEntry = page.entries.find((e) => e.is_absent);
    check(
      "フィクスチャ(欠場艇): entriesは6件、欠場艇も含め全項目が取れる",
      page.entries.length === 6 && absentEntry !== undefined,
      JSON.stringify({ n: page.entries.length, absentEntry }),
    );
    if (absentEntry) {
      const row = buildFillRow(
        {
          race_id: "x",
          boat_number: absentEntry.boat_number,
          ...Object.fromEntries(RACELIST_BACKFILL_COLUMNS.map((c) => [c, null])),
        },
        absentEntry,
      );
      check(
        "フィクスチャ(欠場艇): is_absent=true を含め、埋められる列は埋まる",
        row && row.is_absent === true,
        JSON.stringify(row),
      );
    }
  }
  {
    const html = fs.readFileSync(
      path.join(FIXTURES, "racelist-2026-09-21-10-04-stabilizer-1200m.html"),
      "utf8",
    );
    const page = parseRaceListPage(html);
    check(
      "フィクスチャ(安定板使用): anomaliesが無く、6艇とも3連率等が取れる",
      page.anomalies.length === 0 &&
        page.entries.length === 6 &&
        page.entries.every((e) => RACELIST_BACKFILL_COLUMNS.every((c) => c in e)),
    );
  }
  await withTmpArchive(async (dir) => {
    const raceId = "2025-12-03-01-07";
    writeParsedFixture(dir, raceId, [
      { ...entry, boat_number: 1 },
      { ...entry, boat_number: 2 },
    ]);
    const existingRows = [
      { ...existingAllNull, race_id: raceId, boat_number: 1 },
      {
        ...existingAllNull,
        race_id: raceId,
        boat_number: 2,
        global_3rate: 12.34, // 既に値がある。上書きされてはならない
      },
    ];
    const client = fakeLoadClient({ existingRows });
    const r = await cli._internal.loadBatch(
      client,
      [raceId],
      { archiveDir: dir, apply: false, batchSize: 500 },
      {},
    );
    check(
      "loadBatch (DRY-RUN): upsertは呼ばれない",
      client.calls.upserts.length === 0,
    );
    check(
      "loadBatch: races=1、書き込み予定は2艇分（列単位では1号艇が全列、2号艇はglobal_3rate以外）",
      r.races === 1 && r.error === false,
      JSON.stringify(r),
    );
  });
}

async function scene2() {
  await withTmpArchive(async (dir) => {
    const raceId = "2025-12-03-01-07";
    writeParsedFixture(dir, raceId, [{ ...entry, boat_number: 1 }]);
    const existingRows = [
      { ...existingAllNull, race_id: raceId, boat_number: 1 },
    ];
    const client = fakeLoadClient({ existingRows });
    const r = await cli._internal.loadBatch(
      client,
      [raceId],
      { archiveDir: dir, apply: true, batchSize: 500 },
      {},
    );
    check(
      "loadBatch (--apply): upsertが呼ばれ、対象外の列(win_rate等)を含まない",
      client.calls.upserts.length === 1 &&
        client.calls.upserts[0].batch.length === 1 &&
        !("win_rate" in client.calls.upserts[0].batch[0]) &&
        client.calls.upserts[0].batch[0].global_3rate === 57.33,
      JSON.stringify(client.calls.upserts),
    );
    check("loadBatch (--apply): written=1", r.written === 1, JSON.stringify(r));
  });
  await withTmpArchive(async (dir) => {
    // 既存行に対応するentryが無い艇番（艇番のずれ・解析漏れ）
    const raceId = "2025-12-03-01-07";
    writeParsedFixture(dir, raceId, [{ ...entry, boat_number: 1 }]);
    const existingRows = [
      { ...existingAllNull, race_id: raceId, boat_number: 1 },
      { ...existingAllNull, race_id: raceId, boat_number: 2 },
    ];
    const client = fakeLoadClient({ existingRows });
    const originalWarn = console.warn;
    console.warn = () => {};
    const r = await cli._internal.loadBatch(
      client,
      [raceId],
      { archiveDir: dir, apply: false, batchSize: 500 },
      {},
    );
    console.warn = originalWarn;
    check(
      "loadBatch: 対応するentryの無い艇番はunmatchedRacesとして検出する",
      r.unmatchedRaces === 1,
      JSON.stringify(r),
    );
  });
  // ---------------------------------------------------------------------------
  // 8. 変異検証（buildFillRow の上書き禁止ロジックを壊すと、検証2が失敗すること）
  // ---------------------------------------------------------------------------

  {
    function brokenBuildFillRow(existingRow, e) {
      // 「既存値があれば上書きしない」判定を外した壊れた実装（比較対象）
      const row = {
        race_id: existingRow.race_id,
        boat_number: existingRow.boat_number,
      };
      let filled = false;
      for (const column of RACELIST_BACKFILL_COLUMNS) {
        const value = e[column];
        if (value === null || value === undefined) continue;
        row[column] = value;
        filled = true;
      }
      return filled ? row : null;
    }
    const existingPartial = {
      ...existingAllNull,
      boat_3rate: 12.34,
    };
    const broken = brokenBuildFillRow(existingPartial, entry);
    check(
      "変異検証: 上書き禁止を外した実装は boat_3rate を書き換えてしまう（本実装との違いを確認）",
      "boat_3rate" in broken && broken.boat_3rate === 0,
    );
    const real = buildFillRow(existingPartial, entry);
    check(
      "変異検証: 本実装は boat_3rate を書き換えない（上と対比）",
      !("boat_3rate" in real),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（FIXTURES・check・existingAllNull・entry） */
export async function runRacelistBackfillScenes1(env) {
  ({ FIXTURES, check, existingAllNull, entry } = env);
  await scene1();
  await scene2();
}
