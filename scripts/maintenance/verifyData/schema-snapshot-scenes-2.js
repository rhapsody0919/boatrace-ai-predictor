/**
 * verify-schema-snapshot.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-schema-snapshot.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { snapshotFreshness, snapshotRegression } from "../../lib/schemaSnapshot.js";

let check, LEDGER, db, snap;
let older;

const freshnessAfter = (from, to) =>
  snapshotFreshness(snap, LEDGER.replace(from, to));

function scene1() {
  check(
    "写しと同じ台帳なら古くない",
    snapshotFreshness(snap, LEDGER).stale === false,
  );
  check(
    "後の番号が適用済みになったら古い",
    JSON.stringify(
      freshnessAfter("| 008_h.sql | 未適用 |", "| 008_h.sql | 適用済み |"),
    ) ===
      JSON.stringify({
        stale: true,
        snapshotAppliedThrough: 6,
        ledgerAppliedThrough: 8,
        appliedSince: ["008_h.sql"],
      }),
  );
  check(
    "取得の時に未適用だった小さい番号が後で適用済みになっても古い",
    JSON.stringify(
      freshnessAfter("| 002_b.sql | 未適用（案） |", "| 002_b.sql | 適用済み |")
        .appliedSince,
    ) === '["002_b.sql"]',
  );
  check(
    "同じ番号の片方（004_d2）が後で適用済みになっても古い",
    JSON.stringify(
      freshnessAfter("| 004_d2.sql | 未適用 |", "| 004_d2.sql | 適用済み |")
        .appliedSince,
    ) === '["004_d2.sql"]',
  );
  check(
    "013b のような番号のファイルが後で適用済みになっても古い",
    JSON.stringify(
      freshnessAfter("| 013b_g.sql | 不明 |", "| 013b_g.sql | 適用済み |")
        .appliedSince,
    ) === '["013b_g.sql"]',
  );
  check(
    "取得の時に台帳に行の無かったファイルが後で適用済みで足されても古い",
    JSON.stringify(
      snapshotFreshness(
        snap,
        `${LEDGER}\n| 003 | 003_c.sql | 適用済み（db-apply が行を足した） | c |`,
      ).appliedSince,
    ) === '["003_c.sql"]',
  );
  older = { ...snap, capturedAt: "2026-10-26T00:00:00.000Z" };
  check(
    "巻き戻り: 前の取得の写しは失敗、同じか後の取得は通る、base が無ければ通る",
    /より前/.test(snapshotRegression(older, snap) ?? "") &&
      snapshotRegression(snap, snap) === null &&
      snapshotRegression(snap, older) === null &&
      snapshotRegression(snap, null) === null,
  );
  check(
    "巻き戻り: 台帳の行の後戻りで適用済みのファイルが減った後の取り直しは通る",
    snapshotRegression(
      {
        ...snap,
        capturedAt: "2026-10-28T00:00:00.000Z",
        appliedFilesAtCapture: ["001_a.sql"],
      },
      snap,
    ) === null,
  );
  check(
    "巻き戻り: capturedAt が時刻として読めなければ失敗（黙って通さない）",
    /読めない/.test(
      snapshotRegression(snap, { ...snap, capturedAt: undefined }) ?? "",
    ) &&
      /読めない/.test(
        snapshotRegression({ ...snap, capturedAt: "x" }, snap) ?? "",
      ),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・LEDGER・db・snap） */
export function runSchemaSnapshotScenes2(env) {
  ({ check, LEDGER, db, snap } = env);
  scene1();
}

async function scene2() {
  await db.close();
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・LEDGER・db・snap） */
export async function runSchemaSnapshotScenes3(env) {
  ({ check, LEDGER, db, snap } = env);
  await scene2();
}
