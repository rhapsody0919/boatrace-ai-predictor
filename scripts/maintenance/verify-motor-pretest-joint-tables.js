// 併催の節の前検のページ（表が開催ごとに2つ）で、全ての表の選手を読み、前検順位を表ごとに付けること（motorPretestParser、G3 の点検 V-62）
/**
 * 本番の常滑 2026-11-24〜29（SG チャレンジカップ／G2 レディースCC）は、公式の race/rankingmotor の表が
 * 「チャレンジカップ」34人と「レディースチャレンジカップ」21人の2つ。パーサーは最初の表だけを読み、女子21人の
 * 級別・前検タイムが入らなかった（節のページの女子の級が空）。
 * 見本（scripts/lib/__fixtures__/motorPretest/rankingmotor_08_20261124_joint.html）は公式のページの各表を4行に減らした物。
 * 取得はしない・DB に繋がない。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMotorPretestHtml } from "../lib/motorPretestParser.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const html = fs.readFileSync(
  path.join(
    ROOT,
    "scripts/lib/__fixtures__/motorPretest",
    "rankingmotor_08_20261124_joint.html",
  ),
  "utf8",
);

// 1. 2つの表の全員を読む（男子4人＋女子4人）
const r = parseMotorPretestHtml(html);
assert.equal(r.status, "ok", `解析できない: ${r.anomalies.join(",")}`);
assert.deepEqual([r.venueCode, r.date], [8, "2026-11-24"]);
assert.equal(
  r.rows.length,
  8,
  "2つめの表（レディースチャレンジカップ）の選手を読まない",
);
const byId = new Map(r.rows.map((x) => [x.racer_id, x]));
// 女子（2つめの表）の級別・前検タイム
assert.deepEqual(
  [5045, 4885, 4387, 5193].map((id) => [
    byId.get(id)?.racer_class,
    byId.get(id)?.pretest_time,
  ]),
  [
    ["A2", 6.48],
    ["A2", 6.51],
    ["A1", 6.38],
    ["A1", 6.49],
  ],
);

// 2. 前検順位は表ごと（開催の違う選手と比べない）。男子 6.43・6.49・6.50・6.53、女子 6.38・6.48・6.49・6.51
assert.deepEqual(
  [4848, 4166, 4337, 4503].map((id) => byId.get(id).pretest_rank),
  [1, 2, 3, 4],
  "男子の表の中の順位でない",
);
assert.deepEqual(
  [4387, 5045, 5193, 4885].map((id) => byId.get(id).pretest_rank),
  [1, 2, 3, 4],
  "女子の表の中の順位でない（男子と混ぜた）",
);

// 3. 2つめの表の見出しが1つめと違えば、黙って読まず unrecognized にする
const broken = html.replace(
  /(<table[\s\S]*?<\/table>[\s\S]*?<table[\s\S]*?)前検タイム/,
  "$1前検",
);
assert.notEqual(broken, html, "見本の2つめの表に「前検タイム」が無い");
const b = parseMotorPretestHtml(broken);
assert.equal(b.status, "unrecognized");
assert.ok(
  b.anomalies.includes("table_header:2"),
  `異常の字が違う: ${b.anomalies.join(",")}`,
);

console.log("verify-motor-pretest-joint-tables: OK");
