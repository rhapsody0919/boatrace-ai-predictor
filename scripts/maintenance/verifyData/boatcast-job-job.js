/**
 * verify-boatcast-job.js の検査の続き（boatcast-job-job.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { FORBIDDEN, HTML_ERROR, RACE, RACE_ID, THREE, TWO, UNMEASURABLE, createFakeFetch, fetchTextOf, freshClient, orderOf, routeOriten, same, show, withMissingTables } from "./boatcast-job-fixtures.js";
import { ORITEN_PUBLIC_MAP, expectedValueRows, publicVenueCodes } from "../../lib/boatcast/publicMap.js";
import { clearBoatcastSchemaCache } from "../../lib/boatcast/oritenSchema.js";

// ---------------------------------------------------------------------------
// (c) 取得ジョブ
// ---------------------------------------------------------------------------
/** 取得ジョブの評価（変異検証で、壊した版にも同じ評価をかける） */
export async function evaluateJob(processFn) {
  const { failed, expect, go } = await evaluateJobPart1(processFn);
  await evaluateJobPart2(expect, go);
  await evaluateJobPart3(expect, go);
  await evaluateJobPart4(expect, go);
  return await evaluateJobPart5(failed, expect, go);
}

export async function evaluateJobPart1(processFn) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const go = (over = {}) =>
    processFn({
      raceId: RACE_ID,
      race: RACE,
      mode: "live",
      minutesToStart: 8,
      client: over.client ?? freshClient(),
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({
            status: 200,
            body: THREE,
            lastModified: "Mon, 21 Sep 2026 01:16:32 GMT",
          })),
        ),
      ),
      ...over,
    });

  // shadow
  {
    const client = freshClient();
    const r = await go({ mode: "shadow", client });
    expect(
      "shadow: 何も書かず、resultDigest・件数を返す",
      r.outcome === "ok" &&
        r.rowsWritten === 0 &&
        r.resultDigest?.length === 64 &&
        r.rowsParsed === 18 &&
        r.rowsExpected === 18 &&
        client.writes.length === 0,
    );
  }
  return { failed, expect, go };
}

export async function evaluateJobPart2(expect, go) {
  // live
  {
    const client = freshClient();
    const r = await go({ client });
    expect(
      "live: ok。値18行＋レース単位1行を書く",
      r.outcome === "ok" &&
        r.rowsWritten === 19 &&
        client.data.race_original_exhibition_values.length === 18 &&
        client.data.race_original_exhibition.length === 1,
    );
    expect(
      "書く順序: 値 → レース単位の行（レース単位の行が「完了」の目印）",
      same(orderOf(client), [
        "race_original_exhibition_values",
        "race_original_exhibition",
      ]),
    );
    const rep = client.data.race_original_exhibition[0];
    expect(
      "レース単位の行: 状態・ハッシュ・公開時刻・更新時刻",
      rep.measure_status === 1 &&
        rep.content_hash === r.resultDigest &&
        rep.source_last_modified === "2026-09-21T01:16:32.000Z" &&
        typeof rep.updated_at === "string",
    );
    // 冪等: 同じ内容の再取得は書かない
    const before = client.writes.length;
    const again = await go({ client });
    expect(
      "同じ内容の再取得は何も書かない（rowsWritten=0・書き込みの呼び出しなし）",
      again.outcome === "ok" &&
        again.rowsWritten === 0 &&
        client.writes.length === before,
    );
    // 内容が変わったら書き直す（1艇の1項目だけが変わる）
    const changed = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({
            status: 200,
            body: THREE.replace("37.24", "37.30"),
          })),
        ),
      ),
    });
    const row = client.data.race_original_exhibition_values.find(
      (v) => v.boat_number === 1 && v.kind === "一周",
    );
    expect(
      "内容が変わったら書き直す（変わった行だけ）",
      changed.outcome === "ok" &&
        row.value === 37.3 &&
        changed.rowsWritten === 2,
      `written=${changed.rowsWritten} value=${row?.value}`,
    );
  }
  // 項目が減った（艇×項目の行を残さない）
  {
    const client = freshClient();
    await go({ client });
    await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body: TWO }))),
      ),
      raceId: RACE_ID,
    });
    const kinds = new Set(
      client.data.race_original_exhibition_values.map((v) => v.kind),
    );
    expect(
      "新しい内容に無い項目（直線）の古い行は消す",
      !kinds.has("直線") &&
        client.data.race_original_exhibition_values.length === 12,
      show([...kinds]),
    );
  }
}

export async function evaluateJobPart3(expect, go) {
  // 計測不可
  {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(
          routeOriten(() => ({ status: 200, body: UNMEASURABLE })),
        ),
      ),
    });
    expect(
      "計測不可: ok（0件エラーにしない）。レース単位の行のみ書く",
      r.outcome === "ok" &&
        r.rowsExpected === 0 &&
        r.rowsParsed === 0 &&
        client.data.race_original_exhibition[0].measure_status === 2 &&
        client.data.race_original_exhibition_values.length === 0,
    );
  }
  // 未知の項目名: 値は保存し、warnings で通知する
  {
    const client = freshClient();
    const body =
      "data=\n1\t2\n一　周\tフライング\n1\t選手　　名\t37.00\t1.23\n";
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body }))),
      ),
    });
    expect(
      "未知の項目名: 保存し（取りこぼさない）、warnings に出す",
      r.outcome === "ok" &&
        client.data.race_original_exhibition_values.some(
          (v) => v.kind === "フライング",
        ) &&
        r.warnings.some((w) => w.includes("フライング")),
      show(r.warnings),
    );
  }
  // マップと項目名が違う会場（住之江の想定は2項目。3項目のファイル）
  {
    const client = freshClient({
      races: [
        {
          race_id: "2026-09-21-12-01",
          race_date: "2026-09-21",
          start_time: "15:19:00",
        },
      ],
    });
    const r = await go({ client, raceId: "2026-09-21-12-01", mode: "shadow" });
    expect(
      "公開マップと項目名が違う: 保存は続け、warnings に出す",
      r.outcome === "ok" &&
        r.warnings.some((w) => w.includes("公開マップと項目名が違います")),
      show(r.warnings),
    );
  }
  // 未適用のDB
  {
    const client = withMissingTables(freshClient(), [
      "race_original_exhibition",
      "race_original_exhibition_values",
    ]);
    clearBoatcastSchemaCache(client);
    const r = await go({ client });
    expect(
      "091が未適用のDB: 書かず error（成功にしない。理由を残す）",
      r.outcome === "error" && /091/.test(r.error),
    );
    const s = await go({ client, mode: "shadow" });
    expect(
      "091が未適用でも shadow は動く（取得・解析のみ）",
      s.outcome === "ok",
    );
  }
}

export async function evaluateJobPart4(expect, go) {
  // 構造の異常
  {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status: 200, body: HTML_ERROR }))),
      ),
    });
    expect(
      "200でHTML（構造の変化）: 書かず error（parse_anomaly）",
      r.outcome === "error" &&
        /^parse_anomaly/.test(r.error) &&
        r.anomalies.length > 0 &&
        client.writes.length === 0,
    );
  }
  // HTTPエラー
  for (const status of [404, 500, 503, 429]) {
    const client = freshClient();
    const r = await go({
      client,
      fetchText: fetchTextOf(
        createFakeFetch(routeOriten(() => ({ status, body: "x" }))),
      ),
    });
    expect(
      `HTTP ${status}: 書かず error（403と混同しない。再試行）`,
      r.outcome === "error" &&
        r.error.includes(String(status)) &&
        client.writes.length === 0,
    );
  }
  // 403（カナリアは呼び出し側が確認済み）
  {
    const f403 = fetchTextOf(createFakeFetch(routeOriten(() => FORBIDDEN)));
    const first = await go({ fetchText: f403, minutesToStart: 8 });
    expect(
      "403（発走8分前、窓の中）: no_values・2分後に再試行（データ無しにしない）",
      first.outcome === "no_values" &&
        first.retrySec === 120 &&
        first.rowsWritten === 0,
      show(first),
    );
    const afterWindow = await go({ fetchText: f403, minutesToStart: 6 });
    expect(
      "403（発走6分前、窓の最後）: no_values・5分後に再試行（後段の規則）",
      afterWindow.outcome === "no_values" && afterWindow.retrySec === 300,
      show(afterWindow),
    );
    const second = await go({ fetchText: f403, minutesToStart: 3 });
    expect(
      "403（発走3分前）: no_values・8分後に再試行",
      second.outcome === "no_values" && second.retrySec === 480,
    );
    const third = await go({ fetchText: f403, minutesToStart: -5 });
    expect(
      "403（発走の5分後）: 打ち切り（skipped_not_target・noData）",
      third.outcome === "skipped_not_target" &&
        third.noData === true &&
        third.rowsWritten === 0,
    );
    const past = await go({ fetchText: f403, minutesToStart: undefined });
    expect(
      "403（発走時刻が不明）: 打ち切り（待たない）",
      past.outcome === "skipped_not_target",
    );
  }
  // マップ外の会場（江戸川）は取得しない
  {
    const fetchImpl = createFakeFetch(
      routeOriten(() => ({ status: 200, body: THREE })),
    );
    const r = await go({
      raceId: "2026-09-21-03-01",
      race: {
        race_id: "2026-09-21-03-01",
        race_date: "2026-09-21",
        start_time: "10:00:00",
      },
      fetchText: fetchTextOf(fetchImpl),
    });
    expect(
      "公開マップ外の会場（江戸川）: 取得せず（リクエスト0）、打ち切り",
      r.outcome === "skipped_not_target" && fetchImpl.calls.length === 0,
    );
  }
}

export async function evaluateJobPart5(failed, expect, go) {
  // 未確認の会場（実ファイルを確認できていない）は、別扱い: 取得せず、スロットも期待件数の分母にも入れない
  {
    const map = {
      ...ORITEN_PUBLIC_MAP,
      19: { name: "下関", status: "unconfirmed", items: [] },
    };
    const fetchImpl = createFakeFetch(
      routeOriten(() => ({ status: 200, body: THREE })),
    );
    const r = await go({
      raceId: "2026-09-21-19-01",
      race: {
        race_id: "2026-09-21-19-01",
        race_date: "2026-09-21",
        start_time: "10:00:00",
      },
      map,
      fetchText: fetchTextOf(fetchImpl),
    });
    expect(
      "未確認の会場: 取得せず（リクエスト0）・期待件数0・対象会場の一覧に入れない",
      r.outcome === "skipped_not_target" &&
        fetchImpl.calls.length === 0 &&
        expectedValueRows("19", 6, map) === 0 &&
        !publicVenueCodes(map).includes("19"),
    );
  }
  // races に行が無い
  {
    const r = await go({ race: null });
    expect("races に行が無い: error", r.outcome === "error");
  }
  return failed;
}
