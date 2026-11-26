/**
 * 更新のお知らせの古さ（7日以上で stale）を session-start-check が正しく出すことを守る。
 * 対象: scripts/maintenance/content-ops-checks/check-site-updates-freshness.js
 * 時刻は固定の値を渡し、今の時刻に依らない。
 */
import {
  checkSiteUpdatesFreshness,
  judgeSiteUpdatesFreshness,
  latestUpdateDate,
} from "./content-ops-checks/check-site-updates-freshness.js";
import { SITE_UPDATES } from "../../src/data/siteUpdates.js";

const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`);
  }
};

const sample = `export const SITE_UPDATES = [
  { id: "b", date: "2026-11-22", kind: "feature" },
  { id: "a", date: "2026-11-20", kind: "minor" },
];
export const SITE_MAKING = [{ id: "x", date: "2026-12-31" }];`;
check("SITE_UPDATES の最新を取る（SITE_MAKING は見ない）", latestUpdateDate(sample), "2026-11-22");
check(
  "並びが崩れても最大を取る",
  latestUpdateDate('export const SITE_UPDATES = [{ date: "2026-11-01" }, { date: "2026-11-09" }];'),
  "2026-11-09",
);
check("SITE_UPDATES が無ければ null", latestUpdateDate("export const X = [];"), null);

// JST 2026-11-28 23:59 と 11-29 00:00 の境目（UTC で前日）
const at = (iso) => new Date(iso);
check("6日は古くない", judgeSiteUpdatesFreshness("2026-11-22", at("2026-11-28T14:59:00Z")).stale, false);
check("7日で古い（JST の暦日で数える）", judgeSiteUpdatesFreshness("2026-11-22", at("2026-11-28T15:00:00Z")).stale, true);
check("古いときは手順を出す", typeof judgeSiteUpdatesFreshness("2026-11-01", at("2026-11-28T15:00:00Z")).command, "string");
check("新しいときは手順を出さない", judgeSiteUpdatesFreshness("2026-11-28", at("2026-11-28T15:00:00Z")).command, undefined);
check("日付が無ければ判定しない", judgeSiteUpdatesFreshness(null).stale, null);

// 実物のデータも読める（日付は動くので形だけ）
const real = await checkSiteUpdatesFreshness(at("2026-11-26T03:00:00Z"));
check("実物のデータから日付を読める", /^\d{4}-\d{2}-\d{2}$/.test(real.latestDate ?? ""), true);
check(
  "実物の最新はデータの date の最大",
  real.latestDate,
  SITE_UPDATES.map((u) => u.date).sort().at(-1),
);

if (failures.length) {
  console.error("NG: 更新のお知らせの古さの判定");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("OK: 更新のお知らせの古さの判定");
