/**
 * verify-kb-file-parser.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-kb-file-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { buildKbUrl, kbArchiveRelPath } from "../../lib/kbFileParser.js";
import { buildArchiveRows, KB_ARCHIVE_TABLES } from "../../lib/kbArchiveRows.js";
import { upsertChangedRows } from "../../lib/unchangedRows.js";
import {
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  latestManifest,
  planDownload,
  estimatePlan,
  _internal as cli,
} from "../kb-backfill.js";

let check, eq, days;

function scene1() {
  // --- 8. CLI ---
  {
    check(
      "URL・アーカイブパス",
      buildKbUrl("K", "2022-03-24") ===
        "https://www1.mbrace.or.jp/od2/K/202203/k220324.lzh" &&
        kbArchiveRelPath("B", "2005-01-04") === "B/200501/b050104.lzh",
    );
    const win = parseWindow("22-06");
    const at = (iso) => new Date(iso);
    // JST 23:00 = 14:00Z、JST 03:00 = 18:00Z（前日）、JST 12:00 = 03:00Z
    check(
      "窓: 22-06は23時と3時が内、12時が外（日またぎ）",
      inWindow(win, at("2026-09-20T14:00:00Z")) &&
        inWindow(win, at("2026-09-20T18:00:00Z")) &&
        !inWindow(win, at("2026-09-20T03:00:00Z")),
    );
    check(
      "日次上限の集計: 23:00と翌03:00が同じ夜",
      windowDayKey(win, at("2026-09-20T14:00:00Z")) ===
        windowDayKey(win, at("2026-09-20T18:00:00Z")) &&
        windowDayKey(win, at("2026-09-20T14:00:00Z")) !==
          windowDayKey(win, at("2026-09-21T14:00:00Z")),
    );
    check(
      "窓any=常に内",
      inWindow(parseWindow("any"), at("2026-09-20T03:00:00Z")),
    );
    check(
      "HTTP分類: 403は閾値2、429/503は閾値3+バックオフ、404は不在",
      classifyResponse(403).threshold === 2 &&
        classifyResponse(429).backoff &&
        classifyResponse(503).threshold === 3 &&
        classifyResponse(404).kind === "absent" &&
        classifyResponse(200).kind === "ok",
    );
    const manifest = latestManifest([
      { date: "2019-04-01", kind: "K", status: "ok" },
      { date: "2019-04-01", kind: "B", status: "error" },
      { date: "2019-04-02", kind: "K", status: "absent" },
      { date: "2019-04-02", kind: "B", status: "skipped" },
    ]);
    const todo = planDownload({
      from: "2019-04-01",
      to: "2019-04-03",
      kinds: ["K", "B"],
      manifest,
    });
    check(
      "再開: 完了（ok/absent/skipped）は除き、error・未着手を対象にする",
      eq(todo, [
        { date: "2019-04-01", kind: "B" },
        { date: "2019-04-03", kind: "K" },
        { date: "2019-04-03", kind: "B" },
      ]),
    );
    const est = estimatePlan({
      requests: 4866,
      dailyLimit: 2000,
      meanIntervalMs: 4000,
      latencyMs: 1000,
    });
    check(
      "見積り: 4,866リクエスト・上限2,000で3夜",
      est.nights === 3 && est.totalHours === 6.8,
    );
    const opts = cli.validateOptions(
      cli.parseArgs([
        "download",
        "--from=2019-04-01",
        "--to=2019-04-02",
        "--interval-min-ms=500",
      ]),
    );
    check(
      "間隔の下限: 3000ms未満の指定は3000msに引き上げる",
      opts.intervalMinMs === 3000 && opts.intervalMaxMs >= 3000,
    );
    let threw = false;
    try {
      cli.validateOptions(cli.parseArgs(["download", "--from=2004-12-31"]));
    } catch {
      threw = true;
    }
    check("公式の最古（2005-01-01）より前は拒否", threw);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・eq・days） */
export function runKbFileParserScenes2(env) {
  ({ check, eq, days } = env);
  scene1();
}

async function scene2() {
  // --- 9. load の書き込み経路（メモリ上の偽クライアント。本番DBには接続しない） ---
  {
    const store = new Map(); // table -> Map(key -> row)
    const fake = {
      from(table) {
        if (!store.has(table)) store.set(table, new Map());
        const rows = store.get(table);
        return {
          select: () => ({
            in: async (col, ids) => ({
              data: [...rows.values()].filter((r) => ids.includes(r[col])),
              error: null,
            }),
          }),
          upsert: async (batch, { onConflict }) => {
            const keys = onConflict.split(",");
            for (const r of batch)
              rows.set(keys.map((k) => r[k]).join("|"), { ...r });
            return { error: null };
          },
        };
      },
    };
    const day = buildArchiveRows(days["2026-03-15"]);
    const writeAll = async () => {
      const out = { written: 0, skipped: 0 };
      for (const [spec, list] of [
        [KB_ARCHIVE_TABLES.venueDays, day.venueDays],
        [KB_ARCHIVE_TABLES.races, day.races],
        [KB_ARCHIVE_TABLES.boats, day.boats],
      ]) {
        for (let i = 0; i < list.length; i += 200) {
          const r = await upsertChangedRows(
            fake,
            spec.table,
            list.slice(i, i + 200),
            {
              onConflict: spec.onConflict,
              keyColumns: spec.keyColumns,
              chunkColumn: spec.chunkColumn,
              batchSize: 200,
            },
          );
          out.written += r.written;
          out.skipped += r.skipped;
        }
      }
      return out;
    };
    const quietLog = console.log;
    console.log = () => {};
    const first = await writeAll();
    const second = await writeAll();
    console.log = quietLog;
    check(
      "load: 初回は全行（開催2＋レース24＋艇144）を書き込む",
      first.written === 170 && first.skipped === 0,
      JSON.stringify(first),
    );
    check(
      "load: 再実行は変更なしの行を書かない（書き込み0・スキップ170）",
      second.written === 0 && second.skipped === 170,
      JSON.stringify(second),
    );
    check(
      "load: 主キー（race_id, boat_number）で重複せず144艇が保存される",
      store.get("kb_archive_boats").size === 144 &&
        store.get("kb_archive_venue_days").size === 2,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・eq・days） */
export async function runKbFileParserScenes3(env) {
  ({ check, eq, days } = env);
  await scene2();
}
