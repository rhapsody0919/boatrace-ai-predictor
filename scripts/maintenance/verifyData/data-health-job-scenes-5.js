/**
 * verify-data-health-job.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-data-health-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { cancellationWithResultOk } from "./data-health-job-scenes-4.js";
import { db } from "./data-health-job-scenes-1.js";

let printOut, check, migrationSql, sqlMutantFails, runCancellationWithResult;

const sqlMutants = [
  [
    "確定中止の除外を外す（分母）",
    (s) =>
      s.replace(
        "(r.cancellation_status is distinct from 'confirmed') as active",
        "true as active",
      ),
  ],
  [
    "ピットレポートの対象を、G1・G2の7R以降から全レースにする",
    (s) => s.replace("r.race_number >= 7", "r.race_number >= 1"),
  ],
  [
    "ピットレポートの確定中止の除外を外す",
    (s) =>
      s.replace(
        /(from races r\nleft join race_pit_reports p on p\.race_id = r\.race_id\nwhere r\.race_date between p_from and p_to\n) {2}and r\.cancellation_status is distinct from 'confirmed'\n/,
        "$1",
      ),
  ],
  [
    "節の照合を、開始日のみの一致にする",
    (s) =>
      s.replace(
        "r.race_date between s.start_date and s.end_date",
        "r.race_date = s.start_date",
      ),
  ],
];

async function scene1() {
  for (const [label, mutate] of [
    [
      "中止の誤検出: rank1 を見ず、結果の行があれば数える（返還の行を誤検出にする）",
      (x) =>
        x.replaceAll(
          "r.cancellation_status = 'confirmed' and rr.rank1 is not null",
          "r.cancellation_status = 'confirmed' and rr.race_id is not null",
        ),
    ],
    [
      "中止の誤検出: tentative も数える",
      (x) =>
        x.replaceAll(
          "r.cancellation_status = 'confirmed' and rr.rank1 is not null",
          "r.cancellation_status is not null and rr.rank1 is not null",
        ),
    ],
    [
      "中止の誤検出: 否定の論理式で一致を数える（cancellation_status が NULL の行を取りこぼす）",
      (x) =>
        x.replace(
          "count(*) - count(*) filter (where r.cancellation_status = 'confirmed' and rr.rank1 is not null) as consistent_races",
          "count(*) filter (where not (r.cancellation_status = 'confirmed' and rr.rank1 is not null)) as consistent_races",
        ),
    ],
  ]) {
    const mutated = mutate(migrationSql);
    if (mutated === migrationSql)
      throw new Error(`SQLの変異の対象が見つかりません: ${label}`);
    let detected = false;
    try {
      detected = !cancellationWithResultOk(
        await runCancellationWithResult(mutated),
      );
    } catch {
      detected = true;
    }
    check(
      `変異検証（SQL）: ${label}`,
      detected,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
  for (const [label, mutate] of sqlMutants) {
    check(
      `変異検証（SQL）: ${label}`,
      await sqlMutantFails(label, mutate),
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
  await db.close();
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・migrationSql・sqlMutantFails・runCancellationWithResult） */
export async function runDataHealthJobScenes9(env) {
  ({ printOut, check, migrationSql, sqlMutantFails, runCancellationWithResult } = env);
  await scene1();
}

function scene2() {
  printOut("\n全ての検証に成功");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・migrationSql・sqlMutantFails・runCancellationWithResult） */
export function runDataHealthJobScenes10(env) {
  ({ printOut, check, migrationSql, sqlMutantFails, runCancellationWithResult } = env);
  scene2();
}
