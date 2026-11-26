/**
 * verify-site-feedback-received.js - セッション開始時チェックの siteFeedback（ご意見ボックスの新着の件数）。
 *   (a) 直近24時間（今の時を含む）・7日の和、最も多かった時間を JST で出す。件数0なら最も多かった時間は無し
 *   (b) 読む表は site_feedback_hourly だけで、本文の表 site_feedback は読まない（列は hour・received、7日の窓）
 *   (c) 読めないときは 0 件にせず error で返す（鍵が無い・表が無い・通信の失敗）
 * 本番 DB には接続しない（偽のクライアントで確かめる）。
 *
 * 実行: node scripts/maintenance/verify-site-feedback-received.js
 */
import {
  checkSiteFeedbackReceived,
  summarizeSiteFeedbackHourly,
} from "./content-ops-checks/check-site-feedback-received.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

// 今は 11/26 12:30 UTC（JST 21:30）
const NOW = new Date("2026-11-26T12:30:00Z");
const ROWS = [
  { hour: "2026-11-20T03:00:00Z", received: 4 },
  { hour: "2026-11-25T12:00:00Z", received: 2 }, // 24時間ちょうど前の時（窓の外）
  { hour: "2026-11-25T13:00:00Z", received: 3 }, // 窓の内
  { hour: "2026-11-26T12:00:00Z", received: 1 }, // 今の時
];

// (a)
{
  const s = summarizeSiteFeedbackHourly(ROWS, NOW);
  check(
    "(a) 直近24時間は今の時を含み、24時間前の時を含まない",
    s.last24h === 4,
    JSON.stringify(s),
  );
  check("(a) 7日の和", s.last7d === 10, JSON.stringify(s));
  check(
    "(a) 最も多かった時間を JST で出す（UTC 03時 = JST 12時）",
    s.busiest?.hourJst === "11/20 12時" && s.busiest.received === 4,
    JSON.stringify(s.busiest),
  );
  const empty = summarizeSiteFeedbackHourly([], NOW);
  check(
    "(a) 件数0なら和は0で、最も多かった時間は無し",
    empty.last24h === 0 && empty.last7d === 0 && empty.busiest === null,
    JSON.stringify(empty),
  );
}

// 偽のクライアント。呼ばれた表・列・条件を記録する
const fakeClient = (result) => {
  const calls = [];
  const q = {
    select(cols) {
      calls.push(["select", cols]);
      return q;
    },
    gte(col, v) {
      calls.push(["gte", col, v]);
      return q;
    },
    order(col) {
      calls.push(["order", col]);
      return Promise.resolve(result);
    },
  };
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      return q;
    },
  };
};

// (b)
{
  const client = fakeClient({ data: ROWS, error: null });
  const r = await checkSiteFeedbackReceived({ client, now: NOW });
  const tables = client.calls.filter((c) => c[0] === "from").map((c) => c[1]);
  check(
    "(b) 読む表は site_feedback_hourly だけ（本文の site_feedback を読まない）",
    JSON.stringify(tables) === JSON.stringify(["site_feedback_hourly"]),
    JSON.stringify(tables),
  );
  check(
    "(b) 列は hour・received だけ",
    client.calls.some((c) => c[0] === "select" && c[1] === "hour,received"),
    JSON.stringify(client.calls),
  );
  check(
    "(b) 窓は7日前から",
    client.calls.some(
      (c) =>
        c[0] === "gte" &&
        c[1] === "hour" &&
        c[2] === "2026-11-19T12:30:00.000Z",
    ),
    JSON.stringify(client.calls),
  );
  check(
    "(b) 読めたら和を返す",
    r.last24h === 4 && r.last7d === 10 && !r.error,
    JSON.stringify(r),
  );
}

// (c)
{
  const noKey = await checkSiteFeedbackReceived({ client: null, now: NOW });
  check(
    "(c) 鍵が無いときは error（0件にしない）",
    typeof noKey.error === "string" && noKey.last24h === undefined,
    JSON.stringify(noKey),
  );
  const missing = await checkSiteFeedbackReceived({
    client: fakeClient({
      data: null,
      error: { code: "PGRST205", message: "relation not found" },
    }),
    now: NOW,
  });
  check(
    "(c) 表が無いときは error（0件にしない）",
    /relation not found/.test(missing.error ?? "") &&
      missing.last24h === undefined,
    JSON.stringify(missing),
  );
}

if (failures > 0) {
  console.error(`\nverify-site-feedback-received: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback-received: OK");
