#!/usr/bin/env node
/**
 * 推移の図の指標ごとの尺度（src/pure/trendMetricScale.js）の検査。DB 接続は不要。
 *
 * 守ること（オーナー 2026-11-24〜26 の推移の線の決まりと、図の今の見え方）:
 *   - 率（2連対率・3連対率）は 5 単位で端を丸め、目盛りは 10、上ほど高い、値は小数1桁と %
 *   - 平均ST は 0.01 単位で端を丸め、目盛りは 0.02、小さいほど上（invert）、値は小数2桁で単位なし、軸の頭は「秒」の訳
 *   - 尺度の無い指標は黙って既定を使わず、理由のある失敗にする
 */
import {
  TREND_SCALES,
  trendScaleOf,
  formatTrendValue,
} from "../../src/pure/trendMetricScale.js";

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

for (const m of ["top2Rate", "top3Rate"]) {
  const s = trendScaleOf(m);
  check(
    `${m} の丸めと目盛り`,
    s.step === 5 && s.tickStep === 10,
    JSON.stringify(s),
  );
  check(`${m} は上ほど高い`, s.invert === false);
  check(
    `${m} の値`,
    formatTrendValue(46.66, s) === "46.7%",
    formatTrendValue(46.66, s),
  );
  check(`${m} の目盛りの桁`, (50).toFixed(s.tickDigits) === "50");
  check(`${m} の軸の頭は %`, s.unitKey === null && s.unit === "%");
}

const st = trendScaleOf("avgSt");
check(
  "平均ST の丸めと目盛り",
  st.step === 0.01 && st.tickStep === 0.02,
  JSON.stringify(st),
);
check("平均ST は小さいほど上", st.invert === true);
check(
  "平均ST の値",
  formatTrendValue(0.1534, st) === "0.15",
  formatTrendValue(0.1534, st),
);
check("平均ST の目盛りの桁", (0.14).toFixed(st.tickDigits) === "0.14");
check("平均ST の軸の頭は秒の訳", st.unitKey === "basicInfo.trend.unitSec");

let threw = "";
try {
  trendScaleOf("winRate");
} catch (e) {
  threw = e.message;
}
check("尺度の無い指標は失敗", threw.includes("winRate"), threw);
check(
  "表は変えられない",
  Object.isFrozen(TREND_SCALES) && Object.isFrozen(TREND_SCALES.avgSt),
);

if (failures.length > 0) {
  console.error(`verify-trend-metric-scale: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-trend-metric-scale: OK");
