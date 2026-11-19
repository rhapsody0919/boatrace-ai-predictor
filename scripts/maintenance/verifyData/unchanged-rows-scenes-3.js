/**
 * verify-unchanged-rows.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-unchanged-rows.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { upsertChangedRows } from "../../lib/unchangedRows.js";
import { fakeClient } from "./unchanged-rows-scenes-2.js";

let check, clone;

async function scene1() {
  {
    // 【2026-09-27の実害】「列が無い」と判定して列を落としたまま、書き込みは成功として終わり、
    // 6列が一斉に入らないことに誰も気づけなかった。落としたグループは必ず戻り値とログに出す。
    const existing = [
      { race_id: "R1", boat_number: 1, motor_2rate: 40, weight_kg: 50 },
    ];
    let upsertCount = 0;
    const client = {
      from() {
        return {
          select() {
            return {
              async in() {
                return { data: clone(existing), error: null };
              },
            };
          },
          async upsert() {
            upsertCount++;
            // 1回目だけ「weight_kg が無い」を返し、2回目（列を除いた再試行）は成功させる
            return upsertCount === 1
              ? {
                  error: {
                    code: "PGRST204",
                    message:
                      "Could not find the 'weight_kg' column of 'race_entries' in the schema cache",
                  },
                }
              : { error: null };
          },
        };
      },
    };
    const logs = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...a) => logs.push(a.join(" "));
    console.warn = (...a) => logs.push(a.join(" "));
    const r = await upsertChangedRows(
      client,
      "race_entries",
      [{ race_id: "R1", boat_number: 1, motor_2rate: 99, weight_kg: 51 }],
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        optionalColumnGroups: { マイグレーション081: ["weight_kg"] },
      },
    );
    console.log = origLog;
    console.warn = origWarn;
    check(
      "落とした列グループ: 戻り値の droppedGroups に出る",
      JSON.stringify(r.droppedGroups) === JSON.stringify(["マイグレーション081"]),
      JSON.stringify(r.droppedGroups),
    );
    check(
      "落とした列グループ: 書き込みは成功扱い（error=null）でも、ログに必ず出る",
      r.error === null &&
        logs.some((l) => l.includes("列を除いて書いたグループ")) &&
        logs.some((l) => l.includes("書き込まれていません")),
      JSON.stringify(logs),
    );
    check(
      "落とした列グループ: グループ名と列名の両方がログに出る",
      logs.some(
        (l) => l.includes("マイグレーション081") && l.includes("weight_kg"),
      ),
      JSON.stringify(logs),
    );
  }
}

async function scene2() {
  {
    // 列を落としていない通常の書き込みでは、余計な警告を出さない
    const client = fakeClient({
      existingByTable: {
        race_entries: [{ race_id: "R1", boat_number: 1, motor_2rate: 40 }],
      },
    });
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    const r = await upsertChangedRows(
      client,
      "race_entries",
      [{ race_id: "R1", boat_number: 1, motor_2rate: 99 }],
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
      },
    );
    console.log = origLog;
    check(
      "落とした列グループ: 無ければ droppedGroups は空で、警告も出さない",
      r.droppedGroups.length === 0 &&
        !logs.some((l) => l.includes("列を除いて書いたグループ")),
      JSON.stringify(logs),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・clone） */
export async function runUnchangedRowsScenes6(env) {
  ({ check, clone } = env);
  await scene1();
  await scene2();
}
