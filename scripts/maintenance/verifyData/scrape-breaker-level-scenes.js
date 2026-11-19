/**
 * verify-scrape-breaker-level.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-breaker-level.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createCircuitBreaker } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createSupabaseStore } from "../../lib/scrapeJobs/store.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";

let check, show, MIN, KEY, T0;

async function scene1() {
  // (i) 審査 P2-1: 別の起動の 429 の開放が、403 で開いたホストの長い期限を短く上書きしない
  {
    const c = { t: T0 };
    const store = createMemoryStore();
    const HOST = "host:boatrace.jp";
    const a = createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
    await a.check(HOST); // A は「閉じている」を読んで TTL の間持つ
    const b = createCircuitBreaker({ store: store.breakerStore, now: () => c.t });
    await b.recordBlocked(HOST, "canary HTTP 403"); // B がホストを60分開く
    c.t += 2000;
    for (let i = 0; i < 3; i++) await a.recordFailure(HOST, "HTTP 429");
    check(
      "(i) 別の起動の 429 の開放は、DB の長い期限（403 の60分）を短く上書きしない",
      store.breakerStore.byKey[HOST] === T0 + 60 * MIN &&
        a.snapshot(HOST).openUntil === T0 + 60 * MIN,
      show({ db: store.breakerStore.byKey, a: a.snapshot(HOST) }),
    );
  }
  // (j) close が閉じた時刻を書く・178 の前は外して書き直す
  {
    const log = [];
    const responses = [
      {
        error: {
          code: "PGRST204",
          message:
            "Could not find the 'breaker_closed_at' column of 'scrape_job_state' in the schema cache",
        },
      },
      { error: null },
    ];
    const client = {
      from() {
        return {
          update(p) {
            log.push(p);
            return { eq: async () => responses.shift() };
          },
        };
      },
    };
    await createSupabaseStore(client).breakerStore.close(KEY, { closedAtMs: T0 });
    check(
      "(j) close は breaker_closed_at も書き、178 の前は外して書き直す",
      log.length === 2 &&
        log[0].breaker_closed_at === new Date(T0).toISOString() &&
        log[0].breaker_open_until === null &&
        !("breaker_closed_at" in log[1]),
      show(log),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・MIN・KEY・T0） */
export async function runScrapeBreakerLevelScenes1(env) {
  ({ check, show, MIN, KEY, T0 } = env);
  await scene1();
}
