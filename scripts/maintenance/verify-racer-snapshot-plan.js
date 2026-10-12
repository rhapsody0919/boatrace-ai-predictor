/**
 * verify-racer-snapshot-plan.js - 選手ページのスナップショットを作る範囲（scripts/lib/racerSnapshotPlan.js、BOA-848）の検証。
 *
 * - 本番のビルドだけで sitemap の全員を作る。Preview・手元では作らない（本番 DB に数千のリクエストを送らない）
 * - RACER_SNAPSHOT_LIMIT があれば本番以外でもその人数だけ作る。本番では無視する
 * - sitemap に載る選手（isRacerIndexable の集合）だけ。選手以外の URL・番号の形が違う URL は拾わない
 */
import { planRacerSnapshots } from "../lib/racerSnapshotPlan.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const loc = (p) => `<url><loc>https://www.boat-ai.jp${p}</loc></url>`;
const sitemapXml = [
  loc("/"),
  loc("/racers"),
  loc("/racer/3256"),
  loc("/racer/3257"),
  loc("/racer/3304"),
  loc("/racer/3256"),
  loc("/blog/some-article"),
  loc("/racer/123"),
  loc("/en/racer/3999"),
].join("\n");

{
  const { ids } = planRacerSnapshots({ vercelEnv: "production", sitemapXml });
  check(
    "本番: sitemap の選手だけ、重複なしで全員",
    JSON.stringify(ids) === JSON.stringify(["3256", "3257", "3304"]),
    JSON.stringify(ids),
  );
}
{
  const { ids, reason } = planRacerSnapshots({
    vercelEnv: "production",
    limit: "1",
    sitemapXml,
  });
  check("本番: RACER_SNAPSHOT_LIMIT は無視して全員", ids.length === 3);
  check("本番: 無視したことを理由に出す", reason.includes("無視"));
}
for (const vercelEnv of ["preview", "development", undefined]) {
  const { ids } = planRacerSnapshots({ vercelEnv, sitemapXml });
  check(`${vercelEnv ?? "VERCEL_ENV なし"}: 作らない`, ids.length === 0);
  const empty = planRacerSnapshots({ vercelEnv, limit: "", sitemapXml });
  check(
    `${vercelEnv ?? "VERCEL_ENV なし"}: 空の RACER_SNAPSHOT_LIMIT では作らない`,
    empty.ids.length === 0,
  );
}
{
  const { ids } = planRacerSnapshots({
    vercelEnv: "preview",
    limit: "2",
    sitemapXml,
  });
  check(
    "Preview: RACER_SNAPSHOT_LIMIT=2 なら先頭2人",
    JSON.stringify(ids) === JSON.stringify(["3256", "3257"]),
    JSON.stringify(ids),
  );
}
{
  const { ids } = planRacerSnapshots({
    vercelEnv: "preview",
    limit: "50",
    sitemapXml,
  });
  check("Preview: 人数より大きい指定なら全員", ids.length === 3);
}
for (const limit of ["0", "-1", "abc", "2.5"]) {
  const { ids, reason } = planRacerSnapshots({
    vercelEnv: "preview",
    limit,
    sitemapXml,
  });
  check(
    `Preview: RACER_SNAPSHOT_LIMIT=${limit} は作らず、理由を出す`,
    ids.length === 0 && reason.includes("正の整数ではない"),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
