/**
 * verify-data-health-site-feedback.js - data_health の ご意見ボックスの見張り（マイグレーション211・checks.js の site_feedback.*）。
 * PGlite に仮の表（site_feedback_hourly・site_feedback）と、関数の DDL（正本は functions.js、211 はその出力）を当てて確かめる。
 * 本番 DB には接続しない。
 *   (a) 受け付けが0件の日も、分母24の行を出す（「対象なし」にしない）
 *   (b) 1時間89件は上限に近くない、90件は近い（calm_hours が1減る）
 *   (c) JST の日で区切る（UTC 15:00 は JST の翌日 0 時）
 *   (d) 残っている行と時ごとの件数の和がそろう日は counted = kept、足し込みが止まった日は counted < kept、
 *       行を消した日は counted が kept で頭を抑えられる
 *   (e) 登録表: 上限の見張りは閾値100%・分母の下限1・前日だけ、足し込みの見張りは閾値100%・分母の下限1
 *   (f) 権限: anon・authenticated は EXECUTE できず、service_role は呼べる。SECURITY INVOKER
 *
 * 実行: node scripts/maintenance/verify-data-health-site-feedback.js
 */
import { PGlite } from "@electric-sql/pglite";
import { COUNT_CHECKS as DATA_HEALTH_CHECKS } from "../lib/dataHealth/checks.js";
import { SITE_FEEDBACK_BUSY_HOUR } from "../lib/dataHealth/tableSql.js";
import {
  functionByName,
  renderFunctionDdl,
} from "../lib/dataHealth/functions.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const db = new PGlite();
await db.exec(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE site_feedback_hourly (hour timestamptz PRIMARY KEY, received integer NOT NULL);
CREATE TABLE site_feedback (created_at timestamptz NOT NULL);
GRANT SELECT ON site_feedback_hourly, site_feedback TO service_role;
`);
// 当てるのは SQL の正本（functions.js）から作った DDL。211 のファイルが正本と同じことは verify-data-health-job.js が見る
await db.exec(renderFunctionDdl(functionByName("data_health_site_feedback")));

// JST の 11/20〜11/23 の4日。時ごとの件数は UTC の正時で持つ
const hourly = [
  // 11/20 JST: 受け付けなし
  // 11/21 JST: 89件の時間（JST 10時 = UTC 01時）。足し込みとそろう
  ["2026-11-21T01:00:00Z", 89],
  // 11/22 JST: 90件の時間が1つ（JST 0時 = UTC 11/21 15時）と、3件の時間
  ["2026-11-21T15:00:00Z", 90],
  ["2026-11-22T03:00:00Z", 3],
  // 11/23 JST: 5件（足し込みが止まって、行だけ7件ある日）
  ["2026-11-23T02:00:00Z", 5],
];
for (const [h, n] of hourly)
  await db.query(
    "INSERT INTO site_feedback_hourly (hour, received) VALUES ($1, $2)",
    [h, n],
  );
const rows = [
  ["2026-11-21T01:10:00Z", 89],
  // 11/22: 93件のうち3件を消した（残り90件、件数の和93は90で頭を抑える）
  ["2026-11-21T15:10:00Z", 87],
  ["2026-11-22T03:10:00Z", 3],
  ["2026-11-23T02:10:00Z", 7],
];
for (const [t, n] of rows)
  await db.query(
    "INSERT INTO site_feedback (created_at) SELECT $1::timestamptz FROM generate_series(1, $2)",
    [t, n],
  );

const call = async (role) => {
  await db.exec(`SET ROLE ${role}`);
  try {
    const r = await db.query(
      "SELECT data_health_site_feedback('2026-11-20', '2026-11-23') AS v",
    );
    return { rows: r.rows[0].v };
  } catch (e) {
    return { error: e };
  } finally {
    await db.exec("RESET ROLE");
  }
};
const { rows: out, error } = await call("service_role");
check("(f) service_role は関数を呼べる", !error, error?.message);
const byDay = Object.fromEntries((out ?? []).map((r) => [r.d, r]));
const day = (d) => byDay[d] ?? {};

check(
  "(a) 受け付けが0件の日も分母24の行を出す",
  day("2026-11-20").hours === 24 &&
    day("2026-11-20").calm_hours === 24 &&
    day("2026-11-20").kept === 0 &&
    day("2026-11-20").counted === 0,
  JSON.stringify(day("2026-11-20")),
);
check(
  `(b) 1時間${SITE_FEEDBACK_BUSY_HOUR - 1}件は上限に近くない`,
  day("2026-11-21").calm_hours === 24 && day("2026-11-21").max_received === 89,
  JSON.stringify(day("2026-11-21")),
);
check(
  `(b)(c) 1時間${SITE_FEEDBACK_BUSY_HOUR}件は近い。UTC 15時は JST の翌日0時に数える`,
  day("2026-11-22").calm_hours === 23 && day("2026-11-22").max_received === 90,
  JSON.stringify(day("2026-11-22")),
);
check(
  "(d) 件数の和がそろう日は counted = kept",
  day("2026-11-21").counted === 89 && day("2026-11-21").kept === 89,
  JSON.stringify(day("2026-11-21")),
);
check(
  "(d) 行を消した日は counted を kept で頭を抑える（足し込みの欠けにしない）",
  day("2026-11-22").kept === 90 && day("2026-11-22").counted === 90,
  JSON.stringify(day("2026-11-22")),
);
check(
  "(d) 足し込みが止まった日は counted < kept",
  day("2026-11-23").kept === 7 && day("2026-11-23").counted === 5,
  JSON.stringify(day("2026-11-23")),
);
check(
  "(a) 4日とも行がある（日を generate_series で作る）",
  (out ?? []).length === 4,
  JSON.stringify(out),
);

// (e) 登録表
const sat = DATA_HEALTH_CHECKS.find((c) => c.id === "site_feedback.saturation");
const cnt = DATA_HEALTH_CHECKS.find(
  (c) => c.id === "site_feedback.hourly_counting",
);
check(
  "(e) 上限の見張り: count・alert・calm_hours/hours・閾値100%・分母の下限1・前日だけ",
  sat?.classification === "count" &&
    sat.severity === "alert" &&
    sat.fn === "data_health_site_feedback" &&
    sat.numerator === "calm_hours" &&
    sat.denominator === "hours" &&
    sat.threshold === 1 &&
    sat.minDenominator === 1 &&
    sat.days === 1,
  JSON.stringify(sat),
);
check(
  "(e) 足し込みの見張り: count・alert・counted/kept・閾値100%・分母の下限1",
  cnt?.classification === "count" &&
    cnt.severity === "alert" &&
    cnt.fn === "data_health_site_feedback" &&
    cnt.numerator === "counted" &&
    cnt.denominator === "kept" &&
    cnt.threshold === 1 &&
    cnt.minDenominator === 1,
  JSON.stringify(cnt),
);

// (f) 権限
for (const role of ["anon", "authenticated"]) {
  const r = await call(role);
  check(
    `(f) ${role} は関数を呼べない`,
    r.error && /permission denied/.test(r.error.message),
    r.error?.message ?? "呼べてしまった",
  );
}
const def = await db.query(
  "SELECT prosecdef FROM pg_proc WHERE proname = 'data_health_site_feedback'",
);
check("(f) SECURITY INVOKER", def.rows[0]?.prosecdef === false);

await db.close();
if (failures > 0) {
  console.error(`\nverify-data-health-site-feedback: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-data-health-site-feedback: OK");
