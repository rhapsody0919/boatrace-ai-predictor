/**
 * GSC・GA4 の毎朝の取得（google-detail-collect.js）の窓の日付・GA4 の行の形・匿名化の推定が、hq の版と同じに出ることを守る。
 * API には繋がない（純関数だけ）。
 */
import {
  anonymizedFraction,
  flattenGa4Rows,
  windowsFor,
} from "./google-detail-collect.js";

const failures = [];
let checked = 0;
const check = (name, actual, expected) => {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`,
    );
  }
};
const opts = { timezone: "America/Los_Angeles", windowDays: 28, lagDays: 3 };

// JST 2026-11-26 07:47 は PT 2026-11-25 14:47。末日は PT の今日の3日前
const w = windowsFor(new Date("2026-11-25T22:47:00Z"), opts);
check("取得の日は PT の暦日", w.today, "2026-11-25");
check("現の窓（両端を含む28日、末日は3日前）", w.windows[0], {
  name: "current",
  startDate: "2026-10-26",
  endDate: "2026-11-22",
});
check("前の窓は現の窓の直前28日", w.windows[1], {
  name: "previous",
  startDate: "2026-09-28",
  endDate: "2026-10-25",
});
check(
  "PT の日付の境目（UTC で翌日でも PT ではまだ前の日）",
  windowsFor(new Date("2026-11-26T07:59:00Z"), opts).today,
  "2026-11-25",
);
let threw = false;
try {
  windowsFor(new Date(), { ...opts, lagDays: 2 });
} catch {
  threw = true;
}
check("lagDays が3未満なら止める（GSC の確定前の値を混ぜない）", threw, true);

check(
  "GA4 の行を次元と数にする",
  flattenGa4Rows(
    [
      {
        dimensionValues: [{ value: "/a" }, { value: "google" }],
        metricValues: [{ value: "12" }],
      },
    ],
    ["landingPage", "sessionSource"],
    ["sessions"],
  ),
  [{ landingPage: "/a", sessionSource: "google", sessions: 12 }],
);
check("GA4 の行が無ければ空", flattenGa4Rows(undefined, ["a"], ["b"]), []);

check(
  "匿名化の推定",
  anonymizedFraction([{ clicks: 30 }], [{ clicks: 40 }, { clicks: 10 }]),
  { queryClicks: 30, pageClicks: 50, fraction: 0.4 },
);
check(
  "ページのクリックが0なら推定しない",
  anonymizedFraction([], []).fraction,
  null,
);

if (failures.length > 0) {
  console.error("NG: GSC・GA4 の毎朝の取得");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: GSC・GA4 の毎朝の取得 ${checked}件`);
