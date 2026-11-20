/**
 * verify-sns-observations.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-observations.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  buildObservationCsvRows,
  csvPublicationRange,
  serializeObservationCsv,
  CSV_COLUMNS,
} from "../../../src/utils/snsObservationCsv.js";
import { downloadObservationCsv } from "../../../src/services/snsHubService.js";
import { exports, exportDraft, options, originalFetch } from "./sns-observations-scenes-1.js";

let draft, row;
let boundary, correctedMissing, originalDocument;
export let csv;

function scene1() {
  assert.equal(exports.length, 2);
  assert.equal(exports[0].link_clicks, 0);
  assert.equal(exports[0].link_clicks_revision, 1);
  assert.equal(exports[0].link_clicks_source, "csv");
  assert.equal(exports[0].impressions, 100);
  assert.equal(exports[0].revision, 5);
  assert.equal(exports[0].views, "");
  assert.equal(exports[0].views_missing_reason, "遅延");
  assert.equal(exports[0].data_through, "");
  assert.equal(exports[0].content_version, "");
  assert.equal(exports[0].source_timezone, "");
  assert.equal(exports[0].traffic_scope, "");
  assert.equal(exports[1].observed_at, "");
  assert.equal(exports[1].link_clicks_missing_reason, "未収集");
  assert.equal(exports[0].coverage, "exact");
  assert.equal(
    buildObservationCsvRows(
      [exportDraft],
      [
        row({
          metric_name: "url_link_clicks",
          period_end: "2026-09-03T12:00:00+00:00",
          data_through: "2026-09-03T12:00:00+00:00",
        }),
        row({ metric_name: "impressions" }),
      ],
      options,
    )[0].coverage,
    "exact",
  );
  assert.equal(
    buildObservationCsvRows(
      [{ ...draft, source_data: { youtube_video_id: "confirmed-video" } }],
      [],
      options,
    )[0].external_post_id,
    "confirmed-video",
  );
  assert.equal(
    buildObservationCsvRows([draft], [row()], options)[0].stayed_to_watch_percent,
    "",
  );
  assert.equal(
    buildObservationCsvRows([exportDraft], [], {
      ...options,
      now: Date.parse(draft.posted_at),
    })[0].link_clicks_missing_reason,
    "観測窓未終了",
  );
  assert.equal(
    buildObservationCsvRows([exportDraft], [], {
      ...options,
      platform: "youtube",
    }).length,
    0,
  );
  boundary = [
    "2026-08-31T14:59:59Z",
    "2026-08-31T15:00:00Z",
    "2026-09-01T14:59:59Z",
    "2026-09-01T15:00:00Z",
  ].map((posted_at, i) => ({ ...exportDraft, id: `edge-${i}`, posted_at }));
  assert.equal(buildObservationCsvRows(boundary, [], options).length, 4);
  // posted_atがDate.parseには通るが厳密なISO形式でない行は、CSV全体を失敗させず1行だけ除く。
  {
    const malformed = {
      ...exportDraft,
      id: "malformed-posted-at",
      posted_at: "2026-09-01 10:00:00+09:00",
    };
    assert.ok(Number.isFinite(Date.parse(malformed.posted_at)));
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args);
    let rows;
    try {
      rows = buildObservationCsvRows([malformed, boundary[2]], [], options);
    } finally {
      console.error = originalError;
    }
    assert.equal(rows.length, 2, "正常な行は除外されず残る");
    assert.ok(logs.length > 0, "除外した行をログに残す");
  }
  for (const args of [
    ["2026-02-30", "2026-03-01"],
    ["2026-09-02", "2026-09-01"],
    ["", "2026-09-01"],
    ["2026-09-01", "2026-09-01", "note"],
  ])
    assert.throws(() => csvPublicationRange(...args));
  assert.equal(exports[1].external_post_id, "video-id");
}

function scene2() {
  correctedMissing = buildObservationCsvRows(
    [exportDraft],
    [
      row({ metric_name: "url_link_clicks", metric_value: 3 }),
      row({
        metric_name: "url_link_clicks",
        revision: 2,
        observed_at: "2026-09-04T12:00:00Z",
        metric_value: null,
        missing_reason: "反映遅れ",
        data_through: null,
      }),
    ],
    options,
  )[0];
  assert.equal(correctedMissing.link_clicks, "");
  assert.equal(correctedMissing.link_clicks_missing_reason, "反映遅れ");
  assert.equal(
    buildObservationCsvRows(
      [exportDraft],
      [
        row({ external_post_id: "one" }),
        row({ metric_name: "likes", external_post_id: "two" }),
      ],
      options,
    )[0].external_post_id,
    "",
  );
  assert.equal(
    buildObservationCsvRows([{ ...exportDraft, status: "approved" }], [], options)
      .length,
    0,
  );
  csv = serializeObservationCsv(exports);
  assert.ok(csv.includes('"clicks,""raw""\nline"'));
  assert.ok(serializeObservationCsv([{ draft_id: "=1+1" }]).includes('"\'=1+1"'));
  assert.ok(!CSV_COLUMNS.includes("production_minutes"));
  assert.deepEqual(
    buildObservationCsvRows(
      [exportDraft],
      [row({ id: "b" }), row({ id: "a" })],
      options,
    ),
    buildObservationCsvRows(
      [exportDraft],
      [row({ id: "a" }), row({ id: "b" })],
      options,
    ),
  );
  // サービスの実コードをDOMモックで実行。CSV以外を保存せず、同じ認証経路を使う。
  originalDocument = globalThis.document;
}

async function scene3() {
  try {
    let clicked = 0;
    let fileName;
    globalThis.document = {
      createElement: () => ({
        click() {
          clicked++;
          fileName = this.download;
        },
        remove() {},
      }),
      body: { appendChild() {} },
    };
    globalThis.fetch = async (url) => {
      const query = new URL(url, "https://local.invalid").searchParams;
      assert.equal(query.get("export"), "csv");
      assert.equal(query.get("platform"), "x");
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      });
    };
    await downloadObservationCsv({
      start: "2026-09-01",
      end: "2026-09-01",
      platform: "x",
    });
    assert.equal(clicked, 1);
    assert.equal(fileName, "posts-2026-09-01-2026-09-01-x.csv");
    for (const response of [
      new Response("HTML", { headers: { "Content-Type": "text/html" } }),
      new Response("bad", { status: 500 }),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(
        downloadObservationCsv({
          start: "2026-09-01",
          end: "2026-09-01",
          platform: "x",
        }),
      );
      assert.equal(clicked, 1);
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（draft・row） */
export async function runSnsObservationsScenes3(env) {
  ({ draft, row } = env);
  scene1();
  scene2();
  await scene3();
}
