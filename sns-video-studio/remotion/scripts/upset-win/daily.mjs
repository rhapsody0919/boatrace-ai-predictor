/**
 * YouTube Shorts【人気薄の1着】（BOA-1284）の毎朝の作り手。hq の機械が毎朝 7:00 ごろに1回呼び、出力のフォルダを
 * 送る口（scripts/sns/push-upset-win-short.js）に渡す。選び・材料は機械（LLM なし）、文は model.js の差し込みの型。
 *
 * 使い方（cwd は sns-video-studio/remotion。Remotion の src/index.jsx を読む。ローカルの VOICEVOX engine が要る）:
 *   node scripts/upset-win/daily.mjs --out <dir> [--date YYYY-MM-DD] [--cache <file>] [--send-time HH:MM] [--race <race_id>] [--no-render]
 *     --date: 出す日（JST、既定は今日）。前日（date の前の日）の全レースから選ぶ
 *     --cache: 直近1年の日ごとの数のキャッシュ（既定 out/upset-win/day-counts.json）。hq は state の下に置く
 *     --send-time: 送る時刻（既定 07:15。送る口が 07:00〜07:50 だけを受ける）
 *     --race: 選びを飛ばしてこのレースで作る（見本・試験だけ。そのレースが選びの候補でなければ止める）
 *     --no-render: 声と mp4 を作らない（bundle.json の pages の無い版で、選びと文だけを確かめる）
 *   標準出力の最後の1行は JSON 1つ {status, race_id, reasons, files, video{sec}, candidates}
 *     status: "ok"（作った）・"none"（該当なし。0本の日。ファイルは作らない）・"failed"（止めた。reasons に理由）
 *   exit: 0 ok か none、1 止めた、2 使い方の誤り。ログは標準エラー
 *
 * 鍵: Supabase の匿名の読み取り（VITE_SUPABASE_URL・VITE_SUPABASE_ANON_KEY）だけ。--env-file を使わず .env.local からこの2つだけを読む
 *   （全貌の daily.mjs と同じ。送信の鍵は送る口だけが読む）
 * 出力のフォルダ: bundle.json・upset_win.mp4・sheet.png（3コマの一覧）・public/（声の wav）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchRiskRules } from "../../../../scripts/lib/riskRuleMatcher.js";
import { addDays, buildBundle, candidates, checkBundle, jstDateOf, pageSeconds, primaryOf, shapeDay, stillsOf, timeline } from "../../src/upsetWin/model.js";
import { fetchDayRows, loadDayCounts, metricDays } from "./materials.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REMOTION = resolve(HERE, "../..");
const ROOT = resolve(REMOTION, "../..");
export const VIDEO_NAME = "upset_win.mp4";

/** .env.local から匿名の読み取りの2つだけを入れる（ほかの鍵は読まない） */
function loadAnonEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function parseArgs(argv) {
  const opts = { out: null, date: null, cache: null, sendTime: "07:15", race: null, render: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--date") opts.date = argv[++i];
    else if (a === "--cache") opts.cache = argv[++i];
    else if (a === "--send-time") opts.sendTime = argv[++i];
    else if (a === "--race") opts.race = argv[++i];
    else if (a === "--no-render") opts.render = false;
    else throw new Error(`知らない引数: ${a}`);
  }
  if (!opts.out) throw new Error("--out が無い");
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error("--date が YYYY-MM-DD でない");
  if (!/^07:[0-4][0-9]$|^07:50$/.test(opts.sendTime)) throw new Error("--send-time は 07:00〜07:50");
  return opts;
}

const log = (s) => console.error(`[upset-win] ${s}`);

async function voice(bundle, pub) {
  // 声は全貌の f01 と同じ（VOICEVOX 青山龍星・ノーマル・speedScale 1.1）。読み込みは声を作るときだけ
  const { synthAll } = await import("../full-picture/f01-voice.mjs");
  const chapters = ["hook", "table", "result"].map((id) => ({ id, voice: bundle.voice[id], subs: [bundle.voice[id]] }));
  const { lines } = await synthAll(chapters, pub, null);
  const sec = Object.fromEntries(lines.map((l) => [l.chapter, l.sec]));
  const page = pageSeconds(sec);
  return Object.fromEntries(
    ["hook", "table", "result"].map((id) => [id, { file: lines.find((l) => l.chapter === id).file, voice_sec: sec[id], sec: page[id] }]),
  );
}

function render(out, bundleFile, pub) {
  const mp4 = join(out, VIDEO_NAME);
  execFileSync(
    "npx",
    ["remotion", "render", "src/index.jsx", "UpsetWinShort", mp4, "--codec=h264", "--crf=20", "--audio-bitrate=160k", `--props=${bundleFile}`, `--public-dir=${pub}`, "--log=error"],
    { cwd: REMOTION, stdio: ["ignore", "inherit", "inherit"] },
  );
  return mp4;
}

/** 3コマの一覧（各コマの動きが済んだ後のコマを横に並べる） */
function sheet(out, mp4, bundle) {
  const fr = stillsOf(bundle);
  const sel = fr.map((f) => `eq(n\\,${f})`).join("+");
  const file = join(out, "sheet.png");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", mp4, "-vf", `select='${sel}',scale=540:960,tile=${fr.length}x1`, "-frames:v", "1", "-vsync", "vfr", file]);
  return file;
}

export async function run(opts, { now = new Date() } = {}) {
  const date = opts.date ?? jstDateOf(now);
  const raceDate = addDays(date, -1);
  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const races = shapeDay(await fetchDayRows(raceDate));
  const list = candidates(races);
  const top = list.slice(0, 5).map((c) => ({ race_id: c.race.race_id, odds: c.odds, weaknesses: c.weaknesses }));
  log(`${raceDate}: ${races.length} レース、候補 ${list.length}`);
  let picked = list[0] ?? null;
  if (opts.race) {
    picked = list.find((c) => c.race.race_id === opts.race) ?? null;
    if (!picked) return { status: "failed", reasons: [`${opts.race} は ${raceDate} の選びの候補でない`], candidates: top };
  }
  if (!picked) return { status: "none", race_id: null, reasons: [], candidates: top };
  const race = picked.race;
  const primary = primaryOf(picked.weaknesses);
  const cache = resolve(opts.cache ?? join(REMOTION, "out/upset-win/day-counts.json"));
  const { days, fetched } = await loadDayCounts({ from: addDays(race.race_date, -364), to: race.race_date, cacheFile: cache, today: jstDateOf(now), log });
  log(`直近1年の日ごとの数: 読んだ日 ${fetched}（キャッシュ ${cache}）`);
  const bundle = buildBundle({ race, days: metricDays(days, primary), date, asOf: now.toISOString(), sendTime: opts.sendTime });
  bundle.video = VIDEO_NAME;
  const rules = JSON.parse(readFileSync(join(REMOTION, "risk-rules.json"), "utf8")).rules;
  const files = [];
  if (opts.render) {
    const pub = join(out, "public");
    mkdirSync(pub, { recursive: true });
    bundle.pages = await voice(bundle, pub);
  }
  const reasons = checkBundle(bundle, { rules, matchRiskRules }).filter((r) => opts.render || !r.startsWith("声の "));
  const bundleFile = join(out, "bundle.json");
  writeFileSync(bundleFile, `${JSON.stringify(bundle, null, 2)}\n`);
  files.push(bundleFile);
  if (reasons.length) return { status: "failed", race_id: race.race_id, reasons, files, candidates: top };
  let video = null;
  if (opts.render) {
    const mp4 = render(out, bundleFile, join(out, "public"));
    files.push(mp4, sheet(out, mp4, bundle));
    video = { sec: timeline(bundle).total / 30 };
  }
  return { status: "ok", race_id: race.race_id, reasons: [], files, video, candidates: top, title: bundle.youtube.title };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.log(JSON.stringify({ status: "failed", reasons: [`使い方: ${error.message}`] }));
    process.exit(2);
  }
  loadAnonEnv();
  const result = await run(opts).catch((error) => {
    console.error(error);
    return { status: "failed", reasons: [String(error?.message ?? error)] };
  });
  console.log(JSON.stringify(result));
  process.exit(result.status === "failed" ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
