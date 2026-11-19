/**
 * verify-scraped-timestamps.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-scraped-timestamps.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { isColumnMissingError } from "../../lib/optionalColumns.js";
import { upsertChangedRows } from "../../lib/unchangedRows.js";
import { collectScrapedTimestamps } from "../../analysis/data-health-report.js";

let check, NOW, RACE, exhibitionRow, dbRows, fakeClient, exhibitionOptions, runReport;

async function scene1() {
  {
    // 展示の列は、グループ単位で除く。059だけ未適用なら、056の列(tilt等)とupdated_atは書き続ける
    const groups = {
      "マイグレーション056（BOA-221）": [
        "tilt",
        "propeller_change",
        "parts_changed",
        "adjustment_weight",
      ],
      "マイグレーション059（BOA-289）": [
        "today_weight",
        "prev_race_no",
        "prev_entry_course",
        "prev_start_timing",
        "prev_finish_rank",
      ],
    };
    const run = async (missingColumns) => {
      const client = fakeClient({ missingColumns });
      const r = await upsertChangedRows(
        client,
        "exhibition_data",
        dbRows(exhibitionRow),
        {
          ...exhibitionOptions,
          optionalColumnGroups: groups,
        },
      );
      return { client, r, last: client.calls.upserts.at(-1)?.batch[0] ?? {} };
    };
    {
      const { r, last } = await run(["today_weight"]);
      check(
        "059だけ未適用: 059の列だけ除き、056の列とupdated_atは書き続ける",
        r.error === null &&
          !("today_weight" in last) &&
          !("prev_finish_rank" in last) &&
          "tilt" in last &&
          "adjustment_weight" in last &&
          last.updated_at === NOW.toISOString(),
        JSON.stringify(Object.keys(last)),
      );
    }
    {
      const { r, last } = await run(["tilt", "today_weight"]);
      check(
        "056・059とも未適用: 両グループを除き、updated_atは書き続ける",
        r.error === null &&
          !("tilt" in last) &&
          !("today_weight" in last) &&
          last.updated_at === NOW.toISOString() &&
          "exhibition_time" in last,
        JSON.stringify(Object.keys(last)),
      );
    }
    {
      const { r, last } = await run(["tilt", "today_weight", "updated_at"]);
      check(
        "056・059・071とも未適用: 全て除いて、従来の列だけで書き込める",
        r.error === null &&
          !("tilt" in last) &&
          !("today_weight" in last) &&
          !("updated_at" in last) &&
          "exhibition_time" in last &&
          r.written === 6,
        JSON.stringify(Object.keys(last)),
      );
    }
  }
}

async function scene2() {
  {
    // 列不在と無関係なエラー（権限・接続等）は、列を落として再試行せずエラーにする
    const client = fakeClient({
      writeError: {
        code: "42501",
        message: "permission denied for table race_entries",
      },
    });
    const r = await upsertChangedRows(
      client,
      "race_entries",
      dbRows(exhibitionRow),
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        stampUpdatedAt: true,
        now: NOW,
      },
    );
    check(
      "列不在と無関係なエラーは再試行せず、エラーを返す",
      client.calls.upserts.length === 1 && r.error !== null && r.written === 0,
    );
  }
  {
    // 別の列の不在は、updated_atの不在と取り違えない
    const client = fakeClient({ missingColumns: ["foo_column"] });
    const rows = dbRows((b) => ({
      race_id: RACE,
      boat_number: b,
      foo_column: 1,
    }));
    const r = await upsertChangedRows(client, "race_entries", rows, {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      stampUpdatedAt: true,
      now: NOW,
    });
    check(
      "updated_at以外の列の不在では、updated_atを除いて再試行しない（エラーを返す）",
      client.calls.upserts.length === 1 && r.error !== null,
    );
  }
}

async function scene3() {
  {
    check(
      "isColumnMissingError: エラーコード(PGRST204/42703)＋列名の両方がそろったときだけ真",
      isColumnMissingError(
        {
          code: "PGRST204",
          message:
            "Could not find the 'updated_at' column of 'race_entries' in the schema cache",
        },
        ["updated_at"],
      ) === true &&
        isColumnMissingError(
          {
            code: "42703",
            message: 'column "updated_at" of relation "x" does not exist',
          },
          ["updated_at"],
        ) === true,
    );
    check(
      "isColumnMissingError: 列名が別（部分一致）なら偽",
      isColumnMissingError(
        {
          code: "PGRST204",
          message:
            "Could not find the 'prev_updated_at' column of 'x' in the schema cache",
        },
        ["updated_at"],
      ) === false,
    );
    // 【2026-09-27の実害】メッセージだけで判定していたため、列の不在と無関係なエラーを拾い、
    // そのグループの列を実行の最後まで落とし続けた。コードを必須にして塞ぐ
    check(
      "isColumnMissingError: コードが無ければ偽（メッセージだけでは列の不在と断定しない）",
      isColumnMissingError(
        "Could not find the 'updated_at' column of 'race_entries' in the schema cache",
        ["updated_at"],
      ) === false &&
        isColumnMissingError(
          {
            message: "schema cache reload in progress for updated_at",
          },
          ["updated_at"],
        ) === false,
    );
    check(
      "isColumnMissingError: 列の不在を示さないコードなら偽（メッセージが紛らわしくても）",
      isColumnMissingError(
        {
          code: "PGRST301",
          message: "relation updated_at does not exist in the schema cache",
        },
        ["updated_at"],
      ) === false,
    );
    check(
      "isColumnMissingError: その他のエラー・nullは偽",
      isColumnMissingError(
        {
          code: "23505",
          message: "duplicate key value violates unique constraint",
        },
        ["updated_at"],
      ) === false && isColumnMissingError(null, ["updated_at"]) === false,
    );
  }
  // ---------------------------------------------------------------------------
  // (c) data-health-report
  // ---------------------------------------------------------------------------
  {
    // 列が無い（未適用）: クエリを発行せず、全テーブルが「計測不能」
    let fetched = 0;
    const result = await collectScrapedTimestamps({
      timingColumns: [
        { table_name: "race_conditions", column_name: "created_at" },
      ],
      windowStart: "2026-09-13",
      endDate: "2026-09-19",
      fetch: async () => {
        fetched++;
        return {};
      },
    });
    check(
      "collectScrapedTimestamps: 未適用ならクエリを発行せず、3テーブルとも計測不能",
      fetched === 0 &&
        result.error === null &&
        result.tables.length === 3 &&
        result.tables.every((t) => t.applied === false),
    );
  }
}

async function scene4() {
  {
    // 一部のテーブルだけ適用済み: 適用済みのテーブルだけ計測する
    const queries = [];
    const result = await collectScrapedTimestamps({
      timingColumns: ["created_at", "updated_at"].map((column_name) => ({
        table_name: "race_entries",
        column_name,
      })),
      windowStart: "2026-09-13",
      endDate: "2026-09-19",
      fetch: async (q) => {
        queries.push(...Object.keys(q));
        return {
          scraped_race_entries: [
            {
              races_in_period: "100",
              races_with_rows: "100",
              races_with_created_at: "50",
              saved_after_start: "0",
              lead_min_p10: "55.2",
              lead_min_p50: "60.1",
              lead_min_p90: "63.0",
              hit_60: "30",
            },
          ],
        };
      },
    });
    const entries = result.tables.find((t) => t.table === "race_entries");
    check(
      "collectScrapedTimestamps: 適用済みのテーブルだけ計測し、分母はcreated_at非NULLのレース",
      queries.join() === "scraped_race_entries" &&
        entries.applied === true &&
        entries.racesWithCreatedAt === 50 &&
        entries.savedBy[0].rate === 0.6 &&
        entries.leadMinutes.p50 === 60.1 &&
        result.tables.find((t) => t.table === "exhibition_data").applied ===
          false,
      JSON.stringify(entries),
    );
  }
  {
    // 計測に失敗しても例外にしない（他の指標を止めない）
    const result = await collectScrapedTimestamps({
      timingColumns: ["created_at", "updated_at"].map((column_name) => ({
        table_name: "exhibition_data",
        column_name,
      })),
      windowStart: "2026-09-13",
      endDate: "2026-09-19",
      fetch: async () => {
        throw new Error("SQL実行に失敗 (HTTP 500): statement timeout");
      },
    });
    check(
      "collectScrapedTimestamps: 計測に失敗してもレポートを止めず、エラーを結果に残す",
      typeof result.error === "string" &&
        result.error.includes("statement timeout") &&
        result.tables.every((t) => t.applied === false),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・NOW・RACE・exhibitionRow・dbRows・fakeClient・exhibitionOptions・runReport） */
export async function runScrapedTimestampsScenes1(env) {
  ({ check, NOW, RACE, exhibitionRow, dbRows, fakeClient, exhibitionOptions, runReport } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
}

async function scene5() {
  {
    const { markdown, json, sqlLog } = await runReport({
      timingColumns: [],
      scrapedRows: {},
    });
    check(
      "data-health-report: 未適用でも失敗せず、「未適用のため計測不能」と出す",
      markdown.includes("3-2. 取得時刻（created_at）の分布") &&
        markdown.includes("未適用のため計測不能") &&
        json.scrapedTimestamps.tables.every((t) => t.applied === false),
    );
    check(
      "data-health-report: 未適用なら、created_atを参照するクエリを発行しない（列が無いSQLエラーにならない）",
      !sqlLog.some((q) => q.includes("first_created_at")),
    );
    check(
      "data-health-report: 未適用の3テーブルは、従来どおりタイミング計測不能のアラートに出る",
      ["exhibition_data", "race_entries", "race_start_timings"].every((t) =>
        json.alerts.some(
          (a) => a.kind === "timing_unmeasurable" && a.item.includes(t),
        ),
      ),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・NOW・RACE・exhibitionRow・dbRows・fakeClient・exhibitionOptions・runReport） */
export async function runScrapedTimestampsScenes2(env) {
  ({ check, NOW, RACE, exhibitionRow, dbRows, fakeClient, exhibitionOptions, runReport } = env);
  await scene5();
}
