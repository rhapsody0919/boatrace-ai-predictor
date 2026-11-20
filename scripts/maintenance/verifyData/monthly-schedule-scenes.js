/**
 * verify-monthly-schedule.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-monthly-schedule.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import * as parserMod from "../../lib/monthlyScheduleParser.js";
import { fakeClient } from "../../lib/fakeSupabaseClient.js";
import { runRaceSeriesJob } from "../../lib/raceSeriesJob.js";
import { isScheduledDate, SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let html, check, same, evaluate, withMutant;

const mutants = [
  [
    "見出しの日付と列の対応を1日ずらす",
    [
      [
        "addDays(monthStart, i - firstOfMonth)",
        "addDays(monthStart, i - firstOfMonth + 1)",
      ],
    ],
  ],
  [
    "節の終了列を1つ後ろにする（日数が1増える）",
    [
      ["col_end: col + span - 1,", "col_end: col + span,"],
      [
        "end_date: columnDates[col + span - 2] ?? null,",
        "end_date: columnDates[col + span - 1] ?? null,",
      ],
    ],
  ],
  [
    "左端に接する断片の開始日を確定扱いにする（端の断片を節として採用）",
    [
      [
        /const starts = g\.items\s*\.filter\(\(i\) => !i\.edge_left\)/,
        "const starts = g.items.filter(() => true)",
      ],
    ],
  ],
  [
    "右端に接する断片の終了日を確定扱いにする",
    [
      [
        /const ends = g\.items\s*\.filter\(\(i\) => !i\.edge_right\)/,
        "const ends = g.items.filter(() => true)",
      ],
    ],
  ],
  [
    "総日数から+1を落とす",
    [
      [
        "total_days: daysBetween(start_date, end_date) + 1,",
        "total_days: daysBetween(start_date, end_date),",
      ],
    ],
  ],
  [
    "一般（Ippan）のグレードを G3 にする",
    [
      [
        'Ippan: { grade: "ippan", kind: "ippan" },',
        'Ippan: { grade: "G3", kind: "ippan" },',
      ],
    ],
  ],
  [
    "ヴィーナス・ルーキー等のグレードを一般に決めつける",
    [
      [
        'Venus: { grade: null, kind: "venus" },',
        'Venus: { grade: "ippan", kind: "venus" },',
      ],
      [
        'Takumi: { grade: null, kind: "masters" },',
        'Takumi: { grade: "ippan", kind: "masters" },',
      ],
      [
        'Lady: { grade: null, kind: "lady" },',
        'Lady: { grade: "ippan", kind: "lady" },',
      ],
      [
        'Rookie: { grade: null, kind: "rookie" },',
        'Rookie: { grade: "ippan", kind: "rookie" },',
      ],
    ],
  ],
  [
    "会場コードを読まず、行の順に会場番号を振る",
    [
      [
        /const jcd = \/jcd=\(\\d\+\)\/\.exec\([\s\S]*?\)\?\.\[1\];/,
        "const jcd = String(venues.length + 1);",
      ],
    ],
  ],
];

function scene1() {
  {
    for (const r of evaluate(parserMod)) check(r.label, r.pass, r.detail);
    // 想定外の入力
    let threw = false;
    try {
      parserMod.parseMonthlySchedule(
        "<html><body>メンテナンス中</body></html>",
        "202609",
      );
    } catch {
      threw = true;
    }
    check(
      "表が無いHTML（構造の変更・メンテナンス画面）は握りつぶさず例外",
      threw,
    );
    const wrongYm = parserMod.parseMonthlySchedule(html("202609"), "202608");
    check(
      "要求した年月とページの年月が違えば anomalies に残る",
      wrongYm.anomalies.some((a) => /一致しません/.test(a.problem)),
    );
    check(
      "URL: race/monthlyschedule?ym=YYYYMM、年月の一覧",
      parserMod.buildMonthlyScheduleUrl("202609") ===
        "https://www.boatrace.jp/owpc/pc/race/monthlyschedule?ym=202609" &&
        same(parserMod.listYms("202611", "202702"), [
          "202611",
          "202612",
          "202701",
          "202702",
        ]),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（html・check・same・evaluate・withMutant） */
export function runMonthlyScheduleScenes1(env) {
  ({ html, check, same, evaluate, withMutant } = env);
  scene1();
}

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene2() {
  const ymOfUrl = (url) => /ym=(\d{6})/.exec(url)?.[1];
  const jobCtx = (pages, { mode = "live", client = fakeClient({}) } = {}) => {
    const urls = [];
    return {
      urls,
      client,
      ctx: {
        targetDate: "2026-09-14",
        mode,
        client,
        politeFetch: async (url) => {
          urls.push(url);
          const body = pages[ymOfUrl(url)];
          return body === undefined
            ? new Response("", { status: 404 })
            : new Response(body, { status: 200 });
        },
      },
    };
  };
  const OPTS = { expectedVenues: 9, sleepMs: 0 };
  const base = {
    202608: html("202608"),
    202609: html("202609"),
    202610: html("202610"),
  };
  for (const [date, scheduled] of [
    ["2026-09-14", true], ["2026-09-15", false],
    ["2026-09-01", true], ["2026-09-03", true], ["2026-09-04", false],
    ["2026-09-27", false], ["2026-09-28", true], ["2026-09-30", true],
    ["2026-10-28", false], ["2026-10-29", true], ["2026-10-31", true],
    ["2027-02-25", false], ["2027-02-26", true], ["2027-02-28", true],
    ["2028-02-26", false], ["2028-02-27", true], ["2028-02-29", true],
  ]) {
    const j = jobCtx(base);
    j.ctx.targetDate = date;
    // 9月は成功・書き込みも検査。他の月は取得数の境界検査に限定する。
    if (!date.startsWith("2026-09")) {
      j.ctx.politeFetch = async (url) => {
        j.urls.push(url);
        return new Response("", { status: 503 });
      };
    }
    const r = await runRaceSeriesJob(j.ctx, OPTS);
    check(`P5a: ${date} の予定判定とハンドラーの取得数が一致`,
      isScheduledDate(SCRAPE_JOBS.race_series, date) === scheduled &&
      j.urls.length === (scheduled ? 3 : 0) &&
      (!scheduled || !date.startsWith("2026-09") || r.rowsWritten > 0) &&
      (scheduled || (r.rowsWritten === 0 && r.outcome === undefined &&
        j.client.calls.upserts.length === 0)), JSON.stringify(r));
  }
  const j1 = jobCtx(base);
  const r1 = await runRaceSeriesJob(j1.ctx, OPTS);
  const rows = j1.client.tables.race_series ?? [];
  return { ymOfUrl, jobCtx, OPTS, base, j1, r1, rows };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene3({ ymOfUrl, jobCtx, OPTS, base, j1, r1, rows }) {
  check(
    "定期取得: 前月・当月・翌月（202608〜202610）の3ページを取り、開始日が当月・翌月（9月・10月）の節を書く",
    r1.outcome === undefined &&
      same(j1.urls.map(ymOfUrl), ["202608", "202609", "202610"]) &&
      rows.length > 0 &&
      rows.length === r1.rowsWritten &&
      rows.every(
        (r) => r.start_date >= "2026-09-01" && r.start_date <= "2026-10-31",
      ) &&
      rows.some((r) => r.start_date.startsWith("2026-10")),
    JSON.stringify({ outcome: r1.outcome, error: r1.error, n: rows.length }),
  );
  const r1b = await runRaceSeriesJob(
    jobCtx(base, { client: j1.client }).ctx,
    OPTS,
  );
  check(
    "定期取得: 再実行は変更の無い節を書かない（書き込み0件でも成功）",
    r1b.outcome === undefined &&
      r1b.rowsWritten === 0 &&
      r1b.rowsParsed === rows.length,
    JSON.stringify(r1b.body),
  );
  // 節名がまだ載っていない月（節の td にリンクが無い）。2026-10-02 の 202611 の実測と同じ形
  const untitled = base[202610].replace(
    /(<td[^>]*is-gradeColor[^>]*>)\s*<a[^>]*>[\s\S]*?<\/a>/g,
    "$1",
  );
  const j2 = jobCtx({ ...base, 202610: untitled });
  const r2 = await runRaceSeriesJob(j2.ctx, OPTS);
  const oct = (j2.client.tables.race_series ?? []).filter((r) =>
    r.start_date.startsWith("2026-10"),
  );
  check(
    "定期取得: 節名が未掲載の節（「節名のリンクがありません」の要確認）は許し、節名NULLで書く",
    r2.outcome === undefined &&
      r2.body.untitledSegments > 0 &&
      oct.length > 0 &&
      oct.some((r) => r.title === null),
    JSON.stringify({ outcome: r2.outcome, error: r2.error }),
  );
  // 節名が載った後の取得で、節名を書き直す
  const r2b = await runRaceSeriesJob(
    jobCtx(base, { client: j2.client }).ctx,
    OPTS,
  );
  check(
    "定期取得: 節名が載った後の取得で、節名NULLの節を書き直す",
    r2b.rowsWritten > 0 &&
      (j2.client.tables.race_series ?? []).every((r) => r.title !== null),
    JSON.stringify(r2b.body),
  );
  const unknown = base[202610].replace(
    "is-gradeColorIppan",
    "is-gradeColorXyz",
  );
  const failCases = [
    ["未知の色分け（構造の変更の疑い）", { ...base, 202610: unknown }, OPTS],
    [
      "翌月のページの取得に失敗（HTTP 404）",
      { 202608: base[202608], 202609: base[202609] },
      OPTS,
    ],
    ["会場数が想定と違う", base, { ...OPTS, expectedVenues: 24 }],
  ];
  return { jobCtx, OPTS, base, failCases };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
async function scene4({ jobCtx, OPTS, base, failCases }) {
  for (const [label, pages, opts] of failCases) {
    const j = jobCtx(pages);
    const r = await runRaceSeriesJob(j.ctx, opts);
    check(
      `定期取得: ${label}は、何も書かず error`,
      r.outcome === "error" &&
        (j.client.calls.upserts?.length ?? 0) === 0 &&
        !(j.client.tables.race_series?.length > 0),
      JSON.stringify({ outcome: r.outcome, error: r.error }),
    );
  }
  const shadowClient = fakeClient({});
  const r3 = await runRaceSeriesJob(
    jobCtx(base, { mode: "shadow", client: shadowClient }).ctx,
    OPTS,
  );
  check(
    "定期取得: shadow は取得・解析のみで、DBに触れない",
    r3.outcome === undefined &&
      r3.rowsParsed > 0 &&
      shadowClient.calls.selects.length === 0 &&
      shadowClient.calls.upserts.length === 0,
  );
}

async function scene5() {
  for (const [label, reps] of mutants) {
    const failed = await withMutant(
      "monthlyScheduleParser.js",
      reps,
      async (mod) => {
        try {
          return evaluate(mod).filter((r) => !r.pass);
        } catch (e) {
          return [{ label: `例外: ${e.message}` }];
        }
      },
    );
    check(
      `変異検証: ${label}`,
      failed.length > 0,
      "この変異を検知できない（検証が通ってしまう）",
    );
  }
  {
    const s1 = await scene2();
    const s2 = await scene3(s1);
    await scene4(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（html・check・same・evaluate・withMutant） */
export async function runMonthlyScheduleScenes2(env) {
  ({ html, check, same, evaluate, withMutant } = env);
  await scene5();
}
