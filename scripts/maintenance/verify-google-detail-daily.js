/**
 * google-detail-collect.js の日別（gsc_daily.json・gsc_page_daily.json）が、growth_gsc_daily・growth_gsc_page_daily と同じ行の形で、
 * 直近 dailyDays 日（末日は窓と同じ lagDays 日前・PT の暦日）を全部取れたときだけ出ることを守る。API は偽物で、本物には繋がない。
 */
import { collectDaily, dailyDatesFor, windowsFor } from "./google-detail-collect.js";

const failures = [];
let checked = 0;
const check = (name, actual, expected) => {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`);
  }
};

const cfg = { siteUrl: "sc-domain:example.test", timezone: "America/Los_Angeles", lagDays: 3, dailyDays: 3 };
const now = new Date("2026-11-25T22:47:00Z"); // PT 2026-11-25

// 日付: 末日は windowsFor の現の窓の末日と同じ
const dates = dailyDatesFor(now, cfg);
check("日付は古い順の dailyDays 日", dates, ["2026-11-20", "2026-11-21", "2026-11-22"]);
check("末日は窓の末日と同じ", dates.at(-1), windowsFor(now, { ...cfg, windowDays: 28 }).windows[0].endDate);
check("60日の指定は60日", dailyDatesFor(now, { ...cfg, dailyDays: 60 }).length, 60);
let threw = "";
try {
  dailyDatesFor(now, { ...cfg, dailyDays: 0 });
} catch (e) {
  threw = e.message;
}
check("dailyDays が0は誤り", threw, "dailyDays は正の整数");

// 偽の API: 日ごとに query×page 2行・page 1行。呼び出しを記録する
function fakeSc({ failOn } = {}) {
  const calls = [];
  return {
    calls,
    searchanalytics: {
      async query({ siteUrl, requestBody: b }) {
        calls.push({ siteUrl, dims: b.dimensions.join(","), start: b.startDate, end: b.endDate });
        if (failOn === b.startDate) throw Object.assign(new Error("boom"), { response: { status: 500 } });
        const qp = b.dimensions.length === 3;
        const rows = Array.from({ length: qp ? 2 : 1 }, (_, i) => ({
          keys: qp ? [b.startDate, `q${i}`, `https://example.test/p${i}`] : [b.startDate, "https://example.test/p0"],
          clicks: i + 1,
          impressions: 10 + i,
          position: 3.5,
        }));
        return { data: { rows } };
      },
    },
  };
}

const sc = fakeSc();
const out = await collectDaily(sc, cfg, now);
check("2ファイル", out.map(([n]) => n), ["gsc_daily", "gsc_page_daily"]);
const [daily, pageDaily] = out.map(([, d]) => d);
check("gsc_daily の件数は 日数×2", daily.rows.length, 6);
check("gsc_daily の行の形（列と順）", Object.keys(daily.rows[0]), ["date", "query", "page", "clicks", "impressions", "position"]);
check("gsc_daily の先頭の値", daily.rows[0], { date: "2026-11-20", query: "q0", page: "https://example.test/p0", clicks: 1, impressions: 10, position: 3.5 });
check("gsc_page_daily の件数は 日数", pageDaily.rows.length, 3);
check("gsc_page_daily の行の形（position・fetched_at を含めない）", Object.keys(pageDaily.rows[0]), ["date", "page", "clicks", "impressions"]);
check("meta の範囲", [daily.meta.from, daily.meta.to, daily.meta.days], ["2026-11-20", "2026-11-22", 3]);
check("上限に当たった日は無い", daily.meta.capped_dates, []);
check("サイトを渡している", sc.calls.every((c) => c.siteUrl === cfg.siteUrl), true);
check("1日ずつ取る", sc.calls.filter((c) => c.dims === "date,query,page").map((c) => [c.start, c.end]), dates.map((d) => [d, d]));

// ページ送り: 25000行で満杯なら次の startRow を取る
const paged = {
  starts: [],
  searchanalytics: {
    async query({ requestBody: b }) {
      if (b.dimensions.length === 2) return { data: { rows: [{ keys: [b.startDate, "https://example.test/p"], clicks: 0, impressions: 1 }] } };
      paged.starts.push(b.startRow);
      const n = b.startRow === 0 ? 25000 : 1;
      const rows = Array.from({ length: n }, (_, i) => ({ keys: [b.startDate, `q${b.startRow}-${i}`, "https://example.test/p"], clicks: 0, impressions: 1, position: 1 }));
      return { data: { rows } };
    },
  },
};
const one = await collectDaily(paged, { ...cfg, dailyDays: 1 }, now);
check("満杯なら次のページを取る", paged.starts, [0, 25000]);
check("ページをまたいだ行を全部持つ", one[0][1].rows.length, 25001);

// 1日でも落ちたら投げる（途中までの結果を返さない）
let failed = "";
try {
  await collectDaily(fakeSc({ failOn: "2026-11-21" }), cfg, now);
} catch (e) {
  failed = e.message;
}
check("落ちた日があれば全体が失敗", /^GSC 2026-11-21 date×query×page: API 500/.test(failed), true);

// keys の形が違えば投げる
const bad = { searchanalytics: { async query() { return { data: { rows: [{ keys: ["x"], clicks: 1 }] } }; } } };
let badMsg = "";
try {
  await collectDaily(bad, { ...cfg, dailyDays: 1 }, now);
} catch (e) {
  badMsg = e.message;
}
check("keys が違えば失敗", /keys が/.test(badMsg), true);

if (failures.length) {
  console.error(`verify-google-detail-daily: ${failures.length}/${checked} 件が失敗\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`verify-google-detail-daily: ${checked} 件 OK`);
