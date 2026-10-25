// BOA-1096: 全貌の冒頭の答えの段の分布（読み取りのみ、公開 API）
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { selectRaces } from "../../../sns-video-studio/remotion/scripts/full-picture/daily.mjs";
const BASE = "https://www.boat-ai.jp";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [from, to] = process.argv.slice(2);
const out = process.argv[4] ?? "races.json";
const db = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const win1 = (c) => Object.entries(c?.tri ?? {}).filter(([k]) => k.startsWith("1-")).reduce((s, [, v]) => s + v, 0);
async function get(path) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + path);
    if (r.ok || r.status === 404) return r.json().catch(() => ({ status: `http_${r.status}` }));
    await sleep(2000);
  }
  return { status: "error" };
}
for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
  const date = d.toISOString().slice(0, 10);
  const p = await get(`/api/predictions/${date}`);
  const races = p.races ?? [];
  const sel = new Set(selectRaces(races, date, 4).map((r) => r.race_id));
  const targets = races.filter((r) => sel.has(r.raceId) || (process.argv[5] ? process.argv[5].split(",").map(Number).includes(r.raceNumber) : r.raceNumber === 12));
  for (const r of targets) {
    if (db[r.raceId]?.status && db[r.raceId].status !== "error") { db[r.raceId].selected = sel.has(r.raceId); continue; }
    const s = await get(`/api/analogy/scenario/${r.raceId}?stage=racecard`);
    const sc = s.scenario;
    const forms = sc?.cells?.waku?.forms;
    db[r.raceId] = {
      date, raceId: r.raceId, venue: r.venue, raceNumber: r.raceNumber, startTime: r.startTime, raceStage: r.raceStage, cancel: r.cancellationStatus,
      selected: sel.has(r.raceId), status: s.status, scope: s.scope ?? null, vc_fell_back: s.vc_fell_back ?? null, period: sc?.period ?? null,
      course_st: s.course_st ? { course: s.course_st.course, course_n: s.course_st.course_n, course_filled: s.course_st.course_filled } : null,
      forms: forms ? Object.fromEntries(Object.entries(forms).map(([k, c]) => [k, { n: c.n, k: win1(c), b1_win: c.b1_win ?? null }])) : null,
      rank1: r.result?.rank1 ?? null, finished: r.result?.finished ?? null,
    };
    await sleep(500);
  }
  writeFileSync(out, JSON.stringify(db));
  console.log(date, races.length, sel.size, targets.length);
  await sleep(500);
}
