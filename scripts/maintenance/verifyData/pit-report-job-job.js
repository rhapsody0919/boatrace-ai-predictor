/**
 * verify-pit-report-job.js の検査の続き（pit-report-job-job.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { FINAL_DAY, G1_RACE, NO_DATA, ONE_BOAT, PENDING, PENDING_REAL, R12, RACE_ID, freshClient, same, writes } from "./pit-report-job-fixtures.js";
import { PitReportHttpError } from "../../lib/pitReportJob.js";
import { archiveRawHtml } from "../../lib/rawHtmlArchive.js";
import { isFinalOutcome } from "../../lib/scrapeJobs/outcomes.js";

// ---------------------------------------------------------------------------
// (c) 取得ジョブ
// ---------------------------------------------------------------------------
/** 取得ジョブの評価（変異検証で、壊した版にも同じ評価をかける） */
export async function evaluateJob(processFn) {
  const { failed, expect, go } = await evaluateJobPart1(processFn);
  await evaluateJobPart2(expect, go);
  await evaluateJobPart3(expect, go);
  return await evaluateJobPart4(failed, expect, go);
}

export async function evaluateJobPart1(processFn) {
  const failed = [];
  const expect = (label, pass) => {
    if (!pass) failed.push(label);
  };
  const go = (over) =>
    processFn({
      raceId: RACE_ID,
      race: G1_RACE,
      mode: "live",
      fetchHtml: async () => R12,
      client: freshClient(),
      ...over,
    });

  // 公開後にコメントが増えていく（BOA-611。2026-10-01 児島7R: 11:54 の検知は1艇、13:22 は6艇）
  {
    const client = freshClient();
    const first = await go({
      client,
      fetchHtml: async () => ONE_BOAT,
      minutesToStart: 90,
    });
    expect(
      "BOA-611: 1艇だけ公開（発走90分前）: 書いたうえで partial（再試行）。間隔は発走前の10分",
      first.outcome === "partial" &&
        first.retrySec === 600 &&
        client.state.race_pit_comments.length === 1 &&
        client.state.race_pit_reports[0]?.comment_count === 1 &&
        !isFinalOutcome(first.outcome),
    );
    const same1 = await go({
      client,
      fetchHtml: async () => ONE_BOAT,
      minutesToStart: 20,
    });
    expect(
      "BOA-611: 同じ1艇のまま（発走20分前）: 書かずに partial を続ける。間隔は直前の5分",
      same1.outcome === "partial" &&
        same1.rowsWritten === 0 &&
        same1.retrySec === 300,
    );
    const full = await go({ client, minutesToStart: 15 });
    expect(
      "BOA-611: 6艇そろった再取得: 追加の5艇とレース単位の行を書き直し、ok で完了",
      full.outcome === "ok" &&
        client.state.race_pit_comments.length === 6 &&
        client.state.race_pit_reports.length === 1 &&
        client.state.race_pit_reports[0].comment_count === 6,
    );
  }
  {
    const client = freshClient();
    const late = await go({
      client,
      fetchHtml: async () => ONE_BOAT,
      minutesToStart: -5,
    });
    expect(
      "BOA-611: 発走後は1艇のままでも ok で閉じる（再試行を続けて期限切れの監視を鳴らさない）",
      late.outcome === "ok" && client.state.race_pit_comments.length === 1,
    );
    const unknown = await go({
      client: freshClient(),
      fetchHtml: async () => ONE_BOAT,
    });
    expect(
      "BOA-611: 発走時刻が分からないときも ok で閉じる",
      unknown.outcome === "ok",
    );
  }
  return { failed, expect, go };
}

export async function evaluateJobPart2(expect, go) {
  // shadow: 取得・解析のみ。DBにもStorageにも触れない
  {
    const client = freshClient();
    const r = await go({ mode: "shadow", client });
    expect(
      "shadow: 何も書かず、resultDigest を返す",
      r.outcome === "ok" &&
        r.rowsWritten === 0 &&
        typeof r.resultDigest === "string" &&
        r.resultDigest.length === 64 &&
        client.calls.length === 0 &&
        client.uploads.length === 0,
    );
  }
  // live: 書く。順序は 艇ごと → レース単位
  await evaluateJobLiveWrite(expect, go);
  // 未適用のDB
  {
    const client = freshClient({
      missingTables: ["race_pit_reports", "race_pit_comments"],
    });
    const r = await go({ client });
    expect(
      "085が未適用のDB: 書かず error（成功にしない。理由を残す）",
      r.outcome === "error" &&
        /085/.test(r.error) &&
        writes(client).length === 0 &&
        client.uploads.length === 0,
    );
    const shadow = await go({ client, mode: "shadow" });
    expect(
      "085が未適用でも shadow は動く（取得・解析のみ）",
      shadow.outcome === "ok",
    );
  }
  // 登録番号の不一致
  {
    const client = freshClient();
    client.state.race_entries[1].racer_id = 1234;
    const r = await go({ client });
    expect(
      "出走表の登録番号と不一致: 書かず error",
      r.outcome === "error" &&
        /2号艇/.test(r.error) &&
        writes(client).length === 0,
    );
  }
  // 対象外のレース（G3・一般戦・G1の6R以前）は、取得しない
  {
    let fetched = 0;
    const client = freshClient();
    for (const race of [
      { race_grade: "G3", race_number: 12 },
      { race_grade: "ippan", race_number: 12 },
      { race_grade: "G1", race_number: 6 },
    ]) {
      const r = await go({
        client,
        race,
        fetchHtml: async () => (fetched++, R12),
      });
      expect(
        `対象外(${race.race_grade} ${race.race_number}R): 取得せず skipped_not_target`,
        r.outcome === "skipped_not_target" && r.rowsWritten === 0,
      );
    }
    expect("対象外のレースでは、取得（HTTP）を1回もしない", fetched === 0);
  }
}

export async function evaluateJobPart3(expect, go) {
  // ページ側が対象外と答えた場合（最終日のG1 7R）
  {
    const client = freshClient();
    const r = await go({
      client,
      raceId: "2026-09-21-05-07",
      race: { race_grade: "G1", race_number: 7 },
      fetchHtml: async () => FINAL_DAY,
    });
    expect(
      "ページが対象外（最終日）: skipped_not_target・not_target の行を1件（範囲つき）",
      r.outcome === "skipped_not_target" &&
        client.state.race_pit_reports.length === 1 &&
        client.state.race_pit_reports[0].status === "not_target" &&
        client.state.race_pit_reports[0].target_from === 12 &&
        client.state.race_pit_comments.length === 0 &&
        client.uploads.length === 0,
    );
  }
  // 未公開・データなし・想定外
  {
    const client = freshClient();
    const pending = await go({ client, fetchHtml: async () => PENDING });
    expect(
      "未公開(対象レースで表が空): no_values・何も書かない",
      pending.outcome === "no_values" &&
        writes(client).length === 0 &&
        client.uploads.length === 0,
    );
    const pendingReal = await go({
      client,
      fetchHtml: async () => PENDING_REAL,
    });
    expect(
      "未公開の実ページ（表はあるがコメント欄が空）: no_values・何も書かない（rowsParsed なし）",
      pendingReal.outcome === "no_values" &&
        writes(client).length === 0 &&
        pendingReal.rowsParsed === undefined,
    );
    const nodata = await go({ client, fetchHtml: async () => NO_DATA });
    expect(
      "データなし: no_values・何も書かない",
      nodata.outcome === "no_values" && writes(client).length === 0,
    );
    const junk = await go({
      client,
      fetchHtml: async () => "<html><body>x</body></html>",
    });
    expect(
      "想定外の構造: error（parse_anomaly）",
      junk.outcome === "error" && /parse_anomaly/.test(junk.error),
    );
    expect(
      "races に行が無い: error",
      (await go({ client, race: null })).outcome === "error",
    );
  }
  // 取得の失敗は例外のまま（共通ラッパが error として記録する）
  {
    let threw = false;
    try {
      await go({
        fetchHtml: async () => {
          throw new PitReportHttpError("u", 500);
        },
      });
    } catch {
      threw = true;
    }
    expect("取得の失敗（HTTP 500）は握りつぶさず例外", threw);
  }
  // 書き込みの失敗
  {
    const client = freshClient({
      failOps: { "race_pit_comments:upsert": "boom" },
    });
    const r = await go({ client });
    expect(
      "艇ごとの書き込みに失敗したら、レース単位の行を書かず error（次の取得が書き直す）",
      r.outcome === "error" &&
        /boom/.test(r.error) &&
        client.state.race_pit_reports.length === 0,
    );
  }
}

export async function evaluateJobPart4(failed, expect, go) {
  // 保管の失敗は取得を止めない
  {
    const client = freshClient({ storageError: "Bucket not found" });
    const r = await go({ client, archive: (c, p) => archiveRawHtml(c, p) });
    expect(
      "生HTMLの保管に失敗しても書き込みは成功（保管パスはNULL）",
      r.outcome === "ok" &&
        client.state.race_pit_reports[0].raw_storage_path === null &&
        client.state.race_pit_comments.length === 6,
    );
  }
  return failed;
}

export async function evaluateJobLiveWrite(expect, go) {
  const { client } = await evaluateJobLiveWritePart1(expect, go);
  await evaluateJobLiveWritePart2(expect, go, client);
}

export async function evaluateJobLiveWritePart1(expect, go) {
  const client = freshClient();
  const r = await go({ client });
  expect(
    "live: ok。艇ごと6行＋レース単位1行を書く",
    r.outcome === "ok" &&
      r.rowsWritten === 7 &&
      client.state.race_pit_comments.length === 6 &&
      client.state.race_pit_reports.length === 1 &&
      r.rowsParsed === 6 &&
      r.rowsExpected === 1,
  );
  const order = writes(client)
    .filter((c) => c.op === "upsert")
    .map((c) => c.table);
  expect(
    "書く順序: race_pit_comments → race_pit_reports（レース単位の行が「完了」の目印）",
    same(order, ["race_pit_comments", "race_pit_reports"]),
  );
  const rep = client.state.race_pit_reports[0];
  expect(
    "レース単位の行: status・ハッシュ・保管パス・更新時刻",
    rep.status === "published" &&
      rep.comment_count === 6 &&
      rep.content_hash === r.resultDigest &&
      /^raw\/pitreport\/2026-09-18\/2026-09-18-05-12\/[0-9a-f]{16}\.html\.gz$/.test(
        rep.raw_storage_path,
      ) &&
      typeof rep.updated_at === "string",
  );
  expect(
    "生HTMLを1件、gzipして保管する",
    client.uploads.length === 1 &&
      client.uploads[0].path === rep.raw_storage_path &&
      client.uploads[0].opts.contentType === "application/gzip",
  );
  expect(
    "コメント本文は公式の表記のまま保存される（自信度の末尾なし）",
    client.state.race_pit_comments[0].comment_text ===
      "整備をしたけど、前半レースは良くなかった。急いでリングを外します。" &&
      client.state.race_pit_comments[0].confidence_stars === 1,
  );
  return { client };
}

export async function evaluateJobLiveWritePart2(expect, go, client) {
  // 同じ内容の再取得は、何も書かない・保管もしない
  const before = client.calls.length;
  const again = await go({ client });
  expect(
    "同じ内容の再取得: 書き込み0件・保管なし（変更の無い行は書かない）",
    again.outcome === "ok" &&
      again.rowsWritten === 0 &&
      writes(client).length === 2 &&
      client.uploads.length === 1 &&
      client.calls.length > before,
  );
  // 内容が変わったら書き直す
  const edited = R12.replace(
    "急いでリングを外します。",
    "急いでリングを交換します。",
  );
  const changed = await go({ client, fetchHtml: async () => edited });
  expect(
    "内容が変わった再取得: 変更のある行だけ書き直し、生HTMLも新しく保管する",
    changed.outcome === "ok" &&
      changed.rowsWritten === 2 &&
      client.state.race_pit_comments[0].comment_text.includes("交換") &&
      client.uploads.length === 2 &&
      client.state.race_pit_reports[0].content_hash === changed.resultDigest,
  );
  // 更新で艇が減った場合は、残らない
  const fewer = R12.replace(
    /<tbody>\s*<tr>\s*<td class="is-boatColor6"[\s\S]*?<\/tbody>/,
    "",
  );
  const fewerResult = await go({ client, fetchHtml: async () => fewer });
  // 艇の行が5件は想定外（anomalies）のため書かない
  expect(
    "艇の行が6件でない（想定外）は書かず error",
    fewerResult.outcome === "error" &&
      /parse_anomaly/.test(fewerResult.error) &&
      client.state.race_pit_comments.length === 6,
  );
}
