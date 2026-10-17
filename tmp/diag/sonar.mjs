// 一時的な診断（マージしない）: 本番と同じ @sparticuz/chromium で /today と龍神ソナーの図4枚を撮る
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createChromiumHeadless } from "../../api/_lib/snsHeadless.js";
import { SCREEN_MARKERS as markers } from "../../scripts/lib/snsScreenMarkers.js";
process.env.VERCEL = "1";
const rss = () => {
  try { return execSync("ps -eo rss,comm | awk '{s+=$1} END {print s/1024 \" MB\"}'").toString().trim(); } catch { return "?"; }
};
const mem = () => { try { return execSync("cat /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.current 2>/dev/null").toString().replace(/\n/g, " "); } catch { return "?"; } };
const races = (process.env.RACES || "2026-10-17-04-07,2026-10-17-10-04,2026-10-17-04-01,2026-10-17-04-04").split(",");
const dsf = Number(process.env.DSF || 3);
const h = createChromiumHeadless({ maxInspections: 12 });
const t0 = Date.now();
try {
  const p = await h.inspect({ url: "https://www.boat-ai.jp/today", context: { storageState: null }, requiredSelectors: markers.today });
  console.log("today", p.visibleSelectors, rss(), mem(), Date.now() - t0);
} catch (e) { console.log("today error", e.message.split("\n")[0]); }
for (const id of races) {
  try {
    const s = await h.screenshot({ url: `https://www.boat-ai.jp/race/${id}?tab=sonar`, requiredSelectors: markers["race-sonar"], viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf, element: ".af-hep .af-dark", label: id });
    writeFileSync(`tmp/diag/${id}.png`, s.png);
    console.log("shot", id, s.png.byteLength, rss(), mem(), Date.now() - t0);
  } catch (e) { console.log("shot error", id, e.message.slice(0, 300), rss(), mem()); }
}
await h.close().catch((e) => console.log("close error", e.message));
console.log("done", rss(), mem());
