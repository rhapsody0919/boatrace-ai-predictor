#!/usr/bin/env node
/**
 * 暦日の formatDate・splitJstDate が src/pure/jstDate.js の1つだけで、実行環境のタイムゾーンに依らず、曜日の並びが src/constants の WEEKDAYS と同じこと。
 *
 * middleware・api は src/pure・定数・訳だけを読める（dependency-rules.cjs の node-to-src）ので、生の HTML の head の title が使う
 * formatDate を src/pure に移した。src/pure は定数を読めないので曜日の字を自分で持つ。src/ の本文は読まず、import して呼んだ値で見る。
 */
import assert from "node:assert/strict";
import { WEEKDAYS } from "../../src/constants/index.js";
import * as jstDate from "../../src/pure/jstDate.js";
import * as formatters from "../../src/utils/formatters.js";

assert.equal(formatters.formatDate, jstDate.formatDate, "src/utils の口が src/pure と別の関数");
const before = process.env.TZ;
try {
  for (const tz of ["UTC", "Pacific/Honolulu", "Asia/Tokyo"]) {
    process.env.TZ = tz;
    // 2026-11-22 は日曜。7日ぶん曜日の字が WEEKDAYS の順に出る
    const days = [22, 23, 24, 25, 26, 27, 28].map((d) => jstDate.splitJstDate(`2026-11-${d}`).weekday);
    assert.deepEqual(days, WEEKDAYS, tz);
    assert.equal(jstDate.formatDate("2026-01-01"), "2026年1月1日(木)", tz);
    assert.equal(formatters.formatDateShort("2026-12-20"), "12/20(日)", tz);
  }
} finally {
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
}
console.log("verify-jst-date-format-pure: OK");
