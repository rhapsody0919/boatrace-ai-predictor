/**
 * verify-pr-lane.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { classifyCommits } from "../pr-lane.js";
import { prlCli4, prlCli6, prlCli9, prlCli11, prlCli13, prlCli15 } from "./pr-lane-scenes-5.js";

let prlCli1, prlCli2, prlCli3, prlCli5, prlCli7, prlCli8, prlCli10, prlCli12, prlCli14, prlCli16, prlCli18, prlCli19;

/** { の中身を割った 17/19 */
function prlCli17({ cli, docs, flagAsValue, master, repo, utils }) {
  assert.notEqual(flagAsValue.status, 0);
  assert.match(
    JSON.parse(flagAsValue.stdout).error,
    /--base と --head が要る/,
    "次の旗を値にしない",
  );
  const empty = cli(docs, docs);
  assert.notEqual(empty.status, 0, "差分が空のときは判定しない（0 以外）");

  // 時間の上限を超えたら判定しない
  assert.throws(
    () => classifyCommits(repo, master, utils, 0),
    /時間の上限/,
    "上限を超えたら投げる（CLI は 0 以外）",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（prlCli1・prlCli2・prlCli3・prlCli5・prlCli7・prlCli8・prlCli10・prlCli12・prlCli14・prlCli16・prlCli18・prlCli19） */
export function runPrLaneScenes14(env) {
  ({ prlCli1, prlCli2, prlCli3, prlCli5, prlCli7, prlCli8, prlCli10, prlCli12, prlCli14, prlCli16, prlCli18, prlCli19 } = env);

}

function prl6Scene1() {
  {
    const { repo } = prlCli1();
    const { g } = prlCli2({ repo });
    const { put } = prlCli3({ repo });
    prlCli4({ g, put });
    prlCli5({ put });
    const { start, master, docs, utils } = prlCli6({ g, put });
    prlCli7({ repo });
    prlCli8({ repo });
    const { page, words, splitBase, splitHead, splitFresh } = prlCli9({ g, put, start });
    const { risk } = prlCli10({ repo });
    const { weaken, moveBase, moveHead, moveChanged } = prlCli11({ g, put, risk, start });
    const { cli } = prlCli12({ repo });
    prlCli13({ cli, docs, master, moveBase, moveChanged, moveHead, page, splitBase, splitFresh, splitHead, utils, weaken, words });
    const { missing } = prlCli14({ repo });
    prlCli15({ missing });
    const { flagAsValue } = prlCli16({ docs, repo });
    prlCli17({ cli, docs, flagAsValue, master, repo, utils });
    prlCli18({ master, repo, words });
    prlCli19();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（prlCli1・prlCli2・prlCli3・prlCli5・prlCli7・prlCli8・prlCli10・prlCli12・prlCli14・prlCli16・prlCli18・prlCli19） */
export function runPrLaneScenes15(env) {
  ({ prlCli1, prlCli2, prlCli3, prlCli5, prlCli7, prlCli8, prlCli10, prlCli12, prlCli14, prlCli16, prlCli18, prlCli19 } = env);
  prl6Scene1();
}
