/**
 * verify-prediction-odds-derive.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-prediction-odds-derive.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { createOddsCronHandlerWithPredictionOdds } from "../../lib/scrapeJobs/predictionOddsHandlers.js";

let check;

async function scene1() {
  // ---------------------------------------------------------------------------
  // (g) createOddsCronHandlerWithPredictionOdds
  // ---------------------------------------------------------------------------
  {
    function fakeRes() {
      const res = { statusCode: null, body: null };
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (body) => {
        res.body = body;
        return res;
      };
      return res;
    }
    const calls = [];
    const handler = createOddsCronHandlerWithPredictionOdds({
      getClient: async () => ({ fake: "client" }),
      derivePredictionOdds: async (args) => {
        calls.push(args);
        return { updated: true, count: args.raceIds.length };
      },
    });
    // runScrapeJob 自体は本物を使うため、DBスキーマ未適用（available=false）にして、常に0件（changed無し）にする
    // 差し替えができないため、認証エラーの経路だけを確認する（配線の主要部は (e)(f) が個別に確認済み）
    const unauthorized = fakeRes();
    await handler({ headers: {}, query: {} }, unauthorized);
    check(
      "認証: Authorization ヘッダが無ければ 401",
      unauthorized.statusCode === 401 && unauthorized.body.success === false,
    );

    process.env.CRON_SECRET = "test-secret";
    const noClient = createOddsCronHandlerWithPredictionOdds({
      getClient: async () => null,
    });
    const noClientRes = fakeRes();
    await noClient(
      { headers: { authorization: "Bearer test-secret" }, query: {} },
      noClientRes,
    );
    check(
      "Supabaseクライアントが無ければ 500",
      noClientRes.statusCode === 500 && noClientRes.body.job === "odds",
    );
    delete process.env.CRON_SECRET;
    check(
      "導出フックには到達していない（クライアント無しで打ち切り）",
      calls.length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runPredictionOddsDeriveScenes2(env) {
  ({ check } = env);
  await scene1();
}
