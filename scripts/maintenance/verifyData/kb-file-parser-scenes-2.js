/**
 * verify-kb-file-parser.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-kb-file-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "node:fs";
import {
  classifyKFileVenues,
  decodeLzhText,
  parseKText,
  _internal as kbInternal,
  summarizeKbDay,
} from "../../lib/kbFileParser.js";
import { buildArchiveRows, KB_ARCHIVE_TABLES } from "../../lib/kbArchiveRows.js";
import { upsertChangedRows } from "../../lib/unchangedRows.js";

let FIX, read, check, eq, days;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const k = parseKText(read("k251212-03-k251203-14-cancelled.txt"));
  const edogawa = k.venues.find((v) => v.venue_code === 3);
  const naruto = k.venues.find((v) => v.venue_code === 14);
  check(
    "中止: 全日中止（江戸川 2025-12-12）は、成績0レース・中止 1〜12R",
    edogawa?.races.length === 0 &&
      JSON.stringify(edogawa?.cancelled_race_numbers) ===
        JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    JSON.stringify(edogawa?.cancelled_race_numbers),
  );
  check(
    "中止: 途中打ち切り（鳴門 2025-12-03）は、成績 1〜10R・中止 11・12R（重ならず、合わせて12）",
    naruto?.races.length === 10 &&
      JSON.stringify(naruto?.cancelled_race_numbers) === "[11,12]" &&
      !naruto.races.some((r) =>
        naruto.cancelled_race_numbers.includes(r.race_number),
      ),
    JSON.stringify({
      races: naruto?.races.length,
      c: naruto?.cancelled_race_numbers,
    }),
  );
  return { k, edogawa };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ k, edogawa }) {
  check(
    "中止: 要約の行は、従来どおり payout_summary_lines にも残す（既存の挙動を変えない）",
    edogawa?.payout_summary_lines.some((l) => /1R\s+中/.test(l)),
  );
  const normal = parseKText(read("k260315.txt"));
  check(
    "中止: 中止の無い日（k260315）は、全会場で cancelled_race_numbers が空。払戻の要約行を中止と取り違えない",
    normal.venues.length > 0 &&
      normal.venues.every((v) => v.cancelled_race_numbers.length === 0),
  );
  const re = kbInternal.K_SUMMARY_CANCELLED_RE;
  check(
    "中止の行の正規表現: 全角スペースの有無を問わず取り、払戻の要約（組番と金額）は取らない",
    re.test("           1R  中　止") &&
      re.test("          12R  中止") &&
      !re.test("           1R  3-1-2    2340  3-1-2   680"),
  );
  check(
    "中止: summarizeKbDay に k_cancelled_races（中止のレース数）が出る",
    summarizeKbDay({ date: "x", k, b: null }).k_cancelled_races === 14,
  );
}

async function scene3() {
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

async function scene4() {
  // 9. Kファイルの確定状況は、会場ブロック単位で判定する（中止・順延の会場があるだけの日を、捨てない）
  {
    const P = "データは、この場の全レース終了後に登録されます。";
    const block = (code, body) => `${code}KBGN\n${body}\n${code}KEND`;
    const done = (code) =>
      block(code, "津［成績］ 7/30 x\n  1R 予選 H1800m 晴 風 北 2m 波 1cm");
    const pend = (code) => block(code, `ボートレース\n${P}`);
    const mixed = [done("10"), pend("09"), done("08")].join("\n\n");
    const c1 = classifyKFileVenues(mixed);
    check(
      "K確定状況: 一部の会場だけ未確定（中止・順延）の日は、日全体を未確定にしない",
      c1.total === 3 &&
        eq(c1.pendingVenues, [9]) &&
        eq(c1.completeVenues, [10, 8]) &&
        c1.allPending === false,
      JSON.stringify(c1),
    );
    const c2 = classifyKFileVenues([pend("01"), pend("02")].join("\n"));
    check(
      "K確定状況: 全会場が未確定の日（全レース終了前）は、日全体を未確定にする",
      c2.total === 2 && c2.allPending === true && c2.completeVenues.length === 0,
      JSON.stringify(c2),
    );
    const c3 = classifyKFileVenues(P);
    check(
      "K確定状況: 会場ブロックが読めない形式は、確定とみなさない（allPendingにしない。呼び出し側がファイル全体のマーカーで判定）",
      c3.total === 0 && c3.allPending === false,
      JSON.stringify(c3),
    );
    const real = await decodeLzhText(
      fs.readFileSync(new URL("k260920-pending.lzh", FIX)),
    );
    const c4 = classifyKFileVenues(real);
    check(
      "K確定状況: 実物のプレースホルダ（k260920-pending.lzh、321バイト）は、日全体が未確定として扱われる",
      c4.allPending === true || (c4.total === 0 && real.includes(P)),
      JSON.stringify(c4),
    );
  }
  {
    const s1 = scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（FIX・read・check・eq・days） */
export async function runKbFileParserScenes2(env) {
  ({ FIX, read, check, eq, days } = env);
  await scene3();
  await scene4();
}
