/**
 * verify-boatcast-job.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-boatcast-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { show } from "./boatcast-job-fixtures.js";

let out, check, createVirtualClock, withMutant;

async function scene1() {
  {
    // 待ってから次の時刻を予約する版は、逐次の呼び出しでは間隔が空くが、並行の呼び出しでは同じ nextAllowedAt を
    // 読んで全員が同時に通る。仮想の時計にしても並行の検証が効いていることの担保
    const failedConcurrentPacer = await withMutant(
      "boatcastClient.js",
      [
        [
          `      nextAllowedAt = startAt + minIntervalMs;
      if (startAt > t) await sleep(startAt - t);`,
          `      if (startAt > t) await sleep(startAt - t);
      nextAllowedAt = now() + minIntervalMs;`,
        ],
      ],
      async (m) => {
        const clock = createVirtualClock();
        const p = m.createPacer({
          minIntervalMs: 30,
          now: clock.now,
          sleep: clock.sleep,
        });
        const s = [];
        await clock.runUntil(
          Promise.all(
            [0, 1, 2].map(async () => {
              await p.wait();
              s.push(clock.now());
            }),
          ),
        );
        const sequential = [];
        await clock.runUntil(
          (async () => {
            for (let i = 0; i < 3; i++) {
              await p.wait();
              sequential.push(clock.now());
            }
          })(),
        );
        const spaced = (xs) => xs.slice(1).every((x, i) => x - xs[i] >= 30);
        return [
          ...(spaced(s) ? [] : ["並行の呼び出しで間隔が空かない"]),
          ...(spaced(sequential) ? ["逐次では間隔が空いてしまう（見逃す）"] : []),
        ];
      },
    );
    check(
      `(i) 変異検証（間隔・並行）: 待ってから次の時刻を予約すると、並行の呼び出しが同時に通る → 検証が失敗する（逐次だけでは見逃す）（${failedConcurrentPacer.length}項目）`,
      failedConcurrentPacer.length === 2,
      show(failedConcurrentPacer),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・createVirtualClock・withMutant） */
export async function runBoatcastJobScenes7(env) {
  ({ out, check, createVirtualClock, withMutant } = env);
  await scene1();
}

function scene2() {
  out.log("\nすべての検証が通りました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（out・check・createVirtualClock・withMutant） */
export function runBoatcastJobScenes8(env) {
  ({ out, check, createVirtualClock, withMutant } = env);
  scene2();
}
