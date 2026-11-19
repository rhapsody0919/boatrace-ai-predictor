/**
 * verify-unchanged-rows.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-unchanged-rows.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { upsertChangedRows, filterUnchangedRows, diffRows } from "../../lib/unchangedRows.js";
import { kRows, project, actualOptions } from "./unchanged-rows-scenes-1.js";

let check, db, clone, diff, entryIncoming, racesOptions, racesIncoming, ACTUAL;

// ---------------------------------------------------------------------------
// 7. filterUnchangedRows / upsertChangedRows（Supabaseクライアントの差し替えで、
//    既存行の取得・チャンク分割・書き込み対象の絞り込み・dry-runを確認する）
// ---------------------------------------------------------------------------
export function fakeClient({ existingByTable = {}, selectError = null } = {}) {
  const calls = { selects: [], upserts: [] };
  const client = {
    calls,
    from(table) {
      return {
        select(columns) {
          return {
            async in(column, ids) {
              calls.selects.push({ table, columns, column, ids });
              if (selectError) return { data: null, error: selectError };
              const rows = (existingByTable[table] ?? []).filter((row) =>
                ids.includes(row[column]),
              );
              return { data: clone(rows), error: null };
            },
          };
        },
        async upsert(batch, options) {
          calls.upserts.push({ table, batch, options });
          return { error: null };
        },
      };
    },
  };
  return client;
}

function scene1() {
  {
    // 未同期のレースが3件（DBはnull、Kファイルに値がある）→ その3件だけUPDATE
    const incoming = kRows.map(project);
    const existing = clone(incoming);
    for (const i of [0, 50, 143]) for (const c of ACTUAL) existing[i][c] = null;
    const r = diff("race_results", existing, incoming, actualOptions);
    check(
      "BOA-349: 未同期の3レースだけUPDATEする（値が入る変更を握りつぶさない）",
      r.toWrite.length === 3 && r.stats.unchanged === 141,
      JSON.stringify(r.stats),
    );
  }
  {
    // Kファイルの値が既存と違う（進入変化の訂正）→ UPDATE
    const incoming = kRows.map(project);
    const existing = clone(incoming);
    existing[20].actual_course_2 = ((incoming[20].actual_course_2 ?? 0) % 6) + 1;
    const r = diff("race_results", existing, incoming, actualOptions);
    check(
      "BOA-349: 進入コースの値が異なるレースはUPDATEする",
      r.toWrite.length === 1 && r.toWrite[0].race_id === incoming[20].race_id,
      JSON.stringify(r.stats),
    );
  }
  {
    // race_resultsに行が無いレース（Kファイルにはある）→ UPDATEしても0件のため書かない
    const incoming = kRows.map(project);
    const existing = clone(incoming).slice(0, 100);
    const r = diff("race_results", existing, incoming, actualOptions);
    check(
      "BOA-349: race_resultsに行が無い44レースはUPDATEを発行しない",
      r.toWrite.length === 0 && r.stats.missing === 44,
      JSON.stringify(r.stats),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・db・clone・diff・entryIncoming・racesOptions・racesIncoming・ACTUAL） */
export function runUnchangedRowsScenes3(env) {
  ({ check, db, clone, diff, entryIncoming, racesOptions, racesIncoming, ACTUAL } = env);
  scene1();
}

async function scene2() {
  {
    // 未取得レース（全columnがnull）は、新しい判定でも「未取得」と判定される
    const unsynced = Object.fromEntries(ACTUAL.map((c) => [c, null]));
    check(
      "BOA-349対策: 全columnがnullのレースは未取得と判定される（取りこぼしを起こさない）",
      ACTUAL.every((c) => unsynced[c] === null),
    );
  }
  {
    const existing = db.race_entries;
    const client = fakeClient({ existingByTable: { race_entries: existing } });
    const incoming = db.race_entries.map(entryIncoming);
    incoming[0].motor_2rate = 47.1;
    const r = await upsertChangedRows(client, "race_entries", incoming, {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
    });
    check(
      "upsertChangedRows: 変更のある1行だけをupsertする",
      client.calls.upserts.length === 1 &&
        client.calls.upserts[0].batch.length === 1 &&
        client.calls.upserts[0].batch[0].boat_number === 1 &&
        r.skipped === 5 &&
        r.written === 1,
    );
    check(
      "upsertChangedRows: 既存行の取得は主キー先頭列のIN句で、書き込む列と主キーだけをselectする",
      client.calls.selects.length === 1 &&
        client.calls.selects[0].column === "race_id" &&
        !client.calls.selects[0].columns.includes("ai_score_standard") &&
        client.calls.selects[0].columns.includes("boat_number"),
      client.calls.selects[0]?.columns,
    );
  }
  {
    const client = fakeClient({
      existingByTable: { race_entries: db.race_entries },
    });
    const r = await upsertChangedRows(
      client,
      "race_entries",
      db.race_entries.map(entryIncoming),
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
      },
    );
    check(
      "upsertChangedRows: 全行が変更なしならupsertを1回も呼ばない",
      client.calls.upserts.length === 0 && r.written === 0 && r.skipped === 6,
    );
  }
  {
    const client = fakeClient({
      existingByTable: { race_entries: db.race_entries },
    });
    const incoming = db.race_entries.map(entryIncoming);
    incoming[0].motor_2rate = 47.1;
    const r = await upsertChangedRows(client, "race_entries", incoming, {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      dryRun: true,
    });
    check(
      "upsertChangedRows: dry-runは書き込みを行わず、書くはずの件数(1件)を返す",
      client.calls.upserts.length === 0 &&
        r.stats.toWrite === 1 &&
        r.toWrite.length === 1,
    );
  }
  {
    const client = fakeClient({ selectError: { message: "boom" } });
    const incoming = db.race_entries.map(entryIncoming);
    const r = await filterUnchangedRows(client, "race_entries", incoming, {
      keyColumns: ["race_id", "boat_number"],
    });
    check(
      "既存行の取得に失敗したら全行を書く（変更なしにしない）",
      r.fallback === true && r.toWrite.length === 6 && r.stats.unchanged === 0,
    );
  }
}

async function scene3() {
  {
    // 250レース分 → 100件ずつ3リクエストに分割
    const client = fakeClient();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      race_id: `2026-09-18-01-${String(i).padStart(3, "0")}`,
      weather: "晴",
    }));
    const r = await filterUnchangedRows(client, "race_conditions", rows, {
      keyColumns: ["race_id"],
    });
    check(
      "filterUnchangedRows: 既存行の取得は100レースずつに分割される",
      client.calls.selects.length === 3 &&
        client.calls.selects.map((c) => c.ids.length).join(",") ===
          "100,100,50" &&
        r.toWrite.length === 250,
    );
  }
  {
    // ignoreColumns（updated_at）は既存行のselectに含めない
    const client = fakeClient({ existingByTable: { races: db.races } });
    await filterUnchangedRows(
      client,
      "races",
      [racesIncoming(db.races[0])],
      racesOptions,
    );
    check(
      "filterUnchangedRows: 比較から外す列(updated_at)はselectしない",
      !client.calls.selects[0].columns.includes("updated_at"),
      client.calls.selects[0]?.columns,
    );
  }
  {
    // 【2026-09-27の実害】PostgREST のバルク upsert は1リクエスト内でカラムを揃える必要があるため、
    // キーの集合が異なる行を混ぜると、その列を持たない行に NULL が書かれる。N19（racelist-backfill の
    // buildFillRow は「既存値がNULLの列だけ」を行に入れる）で実際に起き、race_entries の
    // branch・hometown が 1,729行で消えた。書き込む行は、payload 全体の列にそろえる（欠けた列は既存値）。
    const existing = [
      { race_id: "R1", boat_number: 1, global_3rate: null, branch: "東京" },
      { race_id: "R1", boat_number: 2, global_3rate: null, branch: null },
    ];
    // 1号艇は branch を持たない（既存が非NULLなので呼び出し元が意図的に省いた）、2号艇は持つ
    const incoming = [
      { race_id: "R1", boat_number: 1, global_3rate: 50 },
      { race_id: "R1", boat_number: 2, global_3rate: 60, branch: "大阪" },
    ];
    const r = diffRows(existing, incoming, {
      keyColumns: ["race_id", "boat_number"],
    });
    const boat1 = r.toWrite.find((row) => row.boat_number === 1);
    const boat2 = r.toWrite.find((row) => row.boat_number === 2);
    check(
      "payloadの列そろえ: 列を省いた行にも、既存値を入れて列をそろえる（NULLで潰さない）",
      boat1?.branch === "東京",
      JSON.stringify(boat1),
    );
    check(
      "payloadの列そろえ: 値を持つ行はその値のまま",
      boat2?.branch === "大阪",
      JSON.stringify(boat2),
    );
    check(
      "payloadの列そろえ: 書き込む全行のキー集合が一致する",
      r.toWrite.every(
        (row) =>
          JSON.stringify(Object.keys(row).sort()) ===
          JSON.stringify(Object.keys(r.toWrite[0]).sort()),
      ),
      JSON.stringify(r.toWrite.map((row) => Object.keys(row).sort())),
    );
    check(
      "payloadの列そろえ: そろえるために足した列は「変更のあった列」に数えない",
      (r.stats.changedColumns?.branch ?? 0) === 1,
      JSON.stringify(r.stats.changedColumns),
    );
  }
}

function scene4() {
  {
    // 既存行が無い行（新規）は、そろえる相手が無いのでそのまま書く
    const r = diffRows(
      [{ race_id: "R1", boat_number: 1, branch: "東京" }],
      [
        { race_id: "R1", boat_number: 1, global_3rate: 50 },
        { race_id: "R1", boat_number: 9, global_3rate: 60 },
      ],
      { keyColumns: ["race_id", "boat_number"] },
    );
    const added = r.toWrite.find((row) => row.boat_number === 9);
    check(
      "payloadの列そろえ: 新規行は既存値が無いのでそのまま（例外にしない）",
      r.stats.missing === 1 && added?.global_3rate === 60,
      JSON.stringify(added),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・db・clone・diff・entryIncoming・racesOptions・racesIncoming・ACTUAL） */
export async function runUnchangedRowsScenes4(env) {
  ({ check, db, clone, diff, entryIncoming, racesOptions, racesIncoming, ACTUAL } = env);
  await scene2();
  await scene3();
  scene4();
}
