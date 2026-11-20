/**
 * verify-sns-observations.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-observations.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { originalFetch, exportDraft } from "./sns-observations-scenes-1.js";
import { csv } from "./sns-observations-scenes-2.js";

let csvApi;

async function scene1() {
  try {
    let count = 0;
    const request = (query, admin = true) =>
      new Request(
        `https://local.invalid/api/admin/sns-hub/observations?${query}`,
        { headers: admin ? { "x-test-admin": "1" } : {} },
      );
    globalThis.fetch = async (url) => {
      count++;
      const u = new URL(url);
      const q = u.searchParams;
      assert.equal(q.get("limit"), "500");
      assert.ok(q.has("created_at"));
      if (u.pathname.endsWith("sns_drafts")) {
        assert.equal(q.get("status"), "eq.posted");
        assert.equal(q.get("platform"), "eq.x");
        assert.ok(q.get("and").includes("2026-08-31T15:00:00.000Z"));
        const all = Array.from({ length: 1201 }, (_, i) => ({
          ...exportDraft,
          id: String(i).padStart(6, "0"),
        }));
        return Response.json(
          all.filter((d) => d.id > (q.get("id")?.slice(3) || "")).slice(0, 500),
        );
      }
      assert.equal(q.get("source"), "neq.mock");
      assert.equal(q.get("sns_drafts.platform"), "eq.x");
      assert.ok(q.get("select").includes("!inner"));
      return Response.json([]);
    };
    const query = "export=csv&start=2026-09-01&end=2026-09-01&platform=x";
    assert.equal((await csvApi(request(query, false))).status, 401);
    assert.equal(count, 0);
    assert.equal(
      (await csvApi(request("export=csv&start=bad&end=bad"))).status,
      400,
    );
    assert.equal(count, 0);
    const response = await csvApi(request(query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal((await response.text()).split("\r\n").length, 2404);
    assert.equal(count, 4);
    globalThis.fetch = async () => new Response("", { status: 500 });
    assert.equal((await csvApi(request(query))).status, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（csvApi） */
export async function runSnsObservationsScenes4(env) {
  ({ csvApi } = env);
  await scene1();
}

async function scene2() {
  console.log(
    "SNS observations: contract, comparison, collector, UTM, pagination, SQL history/RLS PASS",
  );
  if (process.argv.includes("--ui")) {
    const { verifyObservationCsvUi } =
      await import("../sns-observation-csv-ui.js");
    await verifyObservationCsvUi(csv);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（csvApi） */
export async function runSnsObservationsScenes5(env) {
  ({ csvApi } = env);
  await scene2();
}
