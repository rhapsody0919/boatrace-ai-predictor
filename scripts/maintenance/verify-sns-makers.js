/**
 * SNS の作り手を CI で通しで試す（ADR-0105、2026-11-05）。.github/workflows/sns-makers.yml が PR ごとに回す。
 *
 * 2026-11-04 の #2236 は、人気薄の1着の import が src/config/languages.js → blogPosts*.js の import.meta.glob に届き、
 * Remotion の束が Getting composition で落ちて全部の動画が止まった。束を作り、作り手が作る props で1コマずつ描いて、
 * 束・描画の壊れを PR で止める。外部（本番 DB・YouTube・X・VOICEVOX・LLM）には一切つながない。
 *
 * 流すもの（材料はリポジトリの固定の見本だけ）:
 *   - 人気薄の1着: src/upsetWin/samples の本番の束 → 型の検査と送る口の受け取りの検査（checkUpsetBundle）→ UpsetWinShort の3コマ
 *   - 節の機力 Shorts: src/setsuKiryoku/samples の4型 → 送る口の受け取りの検査（checkShortBundle）→ SetsuKiryokuShort の中ほどの1コマ
 *   - 全貌（今の型）: scripts/full-picture/fixtures の写し → run-full.mjs --text template --no-video（材料の契約・場面・文・入口版・本文の検査と props）
 *     → FullPicture の完全版と入口版の先頭・中ほど・最後
 *   - 全貌 f01: 同じ写しに名前と級・日目を埋めた材料 → f01Script・f01RacerCheck・f01TitleThumbCheck・f01Timeline（声は仮の長さ、撮影は仮の画像）
 *     → F01Landscape の各章の中ほどと F01Thumb
 * 声の wav・撮った画面は、束を作る前に一時の public に仮の物を置く（本番は --public-dir を替えて描く）。
 * 外すもの: 声の生成・実画面の撮影・mp4 の書き出し（ADR-0105「外すもの」）。
 *
 * remotion の依存（sns-video-studio/remotion で npm ci）と、Remotion の Chromium（npx remotion browser ensure）が要るので
 * verify:ci ではなく sns-makers.yml で回す（台帳は manual）。
 * 実行: (cd sns-video-studio/remotion && npm ci && npx remotion browser ensure) && node scripts/maintenance/verify-sns-makers.js [--keep <dir>]
 *   --keep: 描いた PNG と props を残す先（既定は一時のディレクトリに書いて消す）
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const REMOTION = join(ROOT, "sns-video-studio/remotion");
const FX = join(REMOTION, "scripts/full-picture/fixtures");
const FIXTURE = "2026-10-19-19-10";
const SETSU_VARIANTS = ["border", "final_gap", "motor_gap", "motor_up"];
const UPSET_SAMPLE = "2026-11-03-17-10";

const fail = (msg) => {
  console.error(`verify-sns-makers: ${msg}`);
  process.exit(1);
};
if (
  !existsSync(join(REMOTION, "node_modules/@remotion/bundler")) ||
  !existsSync(join(REMOTION, "node_modules/@remotion/renderer"))
)
  fail(
    "sns-video-studio/remotion/node_modules に @remotion/bundler・@remotion/renderer が無い。先に sns-video-studio/remotion で npm ci を実行する",
  );

// root に @remotion/* は無い。remotion の node_modules から読む
const requireRemotion = createRequire(join(REMOTION, "package.json"));
const { bundle } = requireRemotion("@remotion/bundler");
const { openBrowser, renderStill, selectComposition } =
  requireRemotion("@remotion/renderer");

const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const keepArg = process.argv.indexOf("--keep");
// 後で cwd を remotion に替えるので、--keep の相対のパスは起動した場所で絶対に直す
const work =
  keepArg >= 0
    ? process.argv[keepArg + 1] && resolve(process.argv[keepArg + 1])
    : mkdtempSync(join(tmpdir(), "verify-sns-makers-"));
if (!work) fail("--keep の後にディレクトリが無い");
mkdirSync(work, { recursive: true });
const failures = [];
const t0 = Date.now();
const lap = (label) =>
  console.log(`  ${label}（${((Date.now() - t0) / 1000).toFixed(0)}秒）`);

const rules = json(join(REMOTION, "risk-rules.json")).rules;

// ---------- 材料 → props（作り手の通る所。描く前の検査を含む） ----------
/** @type {{ id: string, label: string, props: object, frames: (total: number) => number[] }[]} */
const jobs = [];
/** 一時の public に置く仮のファイル（名前 → 中身の種類） */
const stubs = new Map();

// 人気薄の1着
{
  const { checkBundle, stillsOf } = await mod(
    "sns-video-studio/remotion/src/upsetWin/model.js",
  );
  const { checkUpsetBundle } = await mod("scripts/sns/push-upset-win-short.js");
  const { matchRiskRules } = await mod("scripts/lib/riskRuleMatcher.js");
  const b = json(join(REMOTION, `src/upsetWin/samples/${UPSET_SAMPLE}.json`));
  const why = [
    ...checkBundle(b, { rules, matchRiskRules }),
    ...checkUpsetBundle(b, rules),
  ];
  if (why.length)
    failures.push(`人気薄の1着の見本が検査に落ちる: ${why.join(" / ")}`);
  for (const p of Object.values(b.pages ?? {})) stubs.set(p.file, "wav");
  jobs.push({
    id: "UpsetWinShort",
    label: "人気薄の1着",
    props: b,
    frames: () => stillsOf(b),
  });
}

// 節の機力 Shorts（4型）
{
  const { checkShortBundle } = await mod(
    "scripts/sns/push-setsu-kiryoku-short.js",
  );
  for (const v of SETSU_VARIANTS) {
    const b = json(join(REMOTION, `src/setsuKiryoku/samples/${v}.json`));
    const why = checkShortBundle(b, rules);
    if (why.length)
      failures.push(
        `節の機力（${v}）の見本が送る口の検査に落ちる: ${why.join(" / ")}`,
      );
    jobs.push({
      id: "SetsuKiryokuShort",
      label: `節の機力 ${v}`,
      props: b,
      frames: (total) => [Math.floor(total / 2)],
    });
  }
}

// 全貌（今の型）: run-full.mjs を本物のまま、描かずに props まで
const materials = JSON.parse(
  gunzipSync(readFileSync(join(FX, `${FIXTURE}.json.gz`))).toString("utf8"),
);
{
  const input = join(work, "full-picture-materials.json");
  writeFileSync(input, JSON.stringify(materials));
  const out = join(work, "full-picture");
  const run = spawnSync(
    process.execPath,
    [
      "scripts/full-picture/run-full.mjs",
      input,
      out,
      "--text",
      "template",
      "--no-video",
    ],
    {
      cwd: REMOTION,
      encoding: "utf8",
      timeout: 5 * 60 * 1000,
    },
  );
  if (run.status !== 0)
    failures.push(
      `run-full.mjs が終了コード ${run.status} で落ちた: ${`${run.stderr ?? ""}${run.error?.message ?? ""}`.slice(-2000)}`,
    );
  else {
    const ends = (total) => [0, Math.floor(total / 2), total - 1];
    for (const [file, label] of [
      ["template/props-full-picture.json", "全貌 完全版"],
      ["entry/props-entry.json", "全貌 入口版"],
    ]) {
      const p = join(out, file);
      if (!existsSync(p))
        failures.push(`run-full.mjs --no-video が ${file} を書かない`);
      else
        jobs.push({ id: "FullPicture", label, props: json(p), frames: ends });
    }
  }
}

// 全貌 f01（横 16:9＋声）。写しは build が読んだ所だけなので、名前と級・日目を verify-full-picture-scene2.js の f01Fixture と同じく埋める
{
  const f01 = await mod(
    "sns-video-studio/remotion/scripts/full-picture/f01.mjs",
  );
  const { PLAN, f01Timeline } = await mod(
    "sns-video-studio/remotion/scripts/full-picture/f01-build.mjs",
  );
  const { racersOf } = await mod(
    "sns-video-studio/remotion/src/fullPicture/f01Right.js",
  );
  const { withF01Fields } = await mod(
    "sns-video-studio/remotion/scripts/full-picture/f01-fixture.mjs",
  );
  // 長い名前（6字）を入れて、右の列とサムネの収まりも描く
  const m = withF01Fields(materials, [
    "大久保信一郎",
    "齋藤勇",
    "西村",
    "山田",
    "佐藤",
    "鈴木",
  ]);
  const s = f01.f01Script(m);
  if (!s.ok) failures.push(`f01Script が作らない: ${s.kind} ${s.reason}`);
  else {
    const why = [
      ...f01.f01RacerCheck(s, racersOf(m).racers),
      ...f01.f01TitleThumbCheck(s),
    ];
    if (why.length) failures.push(`f01 の検査に落ちる: ${why.join(" / ")}`);
    // 声は1行2秒の仮の行（synthAll と同じ形）、撮った画面は PLAN の名前ごとに仮の画像1枚
    const lines = s.chapters.flatMap((c) =>
      (c.subs.length ? c.subs : f01.splitSubs(c.voice)).map((sub, i) => ({
        chapter: c.id,
        i,
        sub,
        file: `voice-${c.id}-${i}.wav`,
        sec: 2,
      })),
    );
    for (const l of lines) stubs.set(l.file, "wav");
    const shots = Object.fromEntries(
      Object.values(PLAN)
        .flat()
        .map((p) => [
          p.k,
          {
            file: `${p.k}.png`,
            clip: { x: 0, y: 0, w: 1100, h: 820 },
            scale: 0.9,
            minFontPx: 30,
            // 次に押す所（f01-capture.mjs の cursor / cursorFrom と同じ箱の形）
            cursor: { x: 400, y: 300, w: 120, h: 60 },
            cursorFrom: { x: 400, y: 300, w: 120, h: 60 },
          },
        ]),
    );
    for (const sh of Object.values(shots)) stubs.set(sh.file, "png");
    const { props } = f01Timeline(s, { lines, kana: {} }, shots);
    jobs.push({
      id: "F01Landscape",
      label: "全貌 f01",
      props,
      frames: () => props.chapters.map((c) => c.from + Math.floor(c.len / 2)),
    });
    jobs.push({
      id: "F01Thumb",
      label: "全貌 f01 サムネ",
      props: s.thumb,
      frames: () => [0],
    });
  }
}
lap(`材料と検査（描く ${jobs.length} 件）`);

// ---------- 一時の public（本番の public ＋ 仮の声・画面）と束 ----------
const pub = join(work, "public");
cpSync(join(REMOTION, "public"), pub, { recursive: true });
/** 無音の wav（16bit・モノラル・24kHz・1秒） */
const silentWav = () => {
  const rate = 24000;
  const data = Buffer.alloc(rate * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};
const png = readFileSync(join(REMOTION, "public/about-hero-desktop-home.png"));
for (const [name, kind] of stubs)
  writeFileSync(join(pub, name), kind === "wav" ? silentWav() : png);

// 束と Chromium は CLI（hq の daily・verify-remotion-compositions.js）と同じく remotion を cwd にする。
// rootDir（.env・webpack の cache）と Chromium の置き場所（node_modules/.remotion）が cwd で決まるため
process.chdir(REMOTION);
const serveUrl = await bundle({
  entryPoint: join(REMOTION, "src/index.jsx"),
  publicDir: pub,
  onProgress: () => {},
});
lap("束を作った");

// ---------- 描く ----------
const browser = await openBrowser("chrome");
const stillsDir = join(work, "stills");
mkdirSync(stillsDir, { recursive: true });
let drawn = 0;
try {
  for (const job of jobs) {
    let composition;
    try {
      composition = await selectComposition({
        serveUrl,
        id: job.id,
        inputProps: job.props,
        puppeteerInstance: browser,
        logLevel: "error",
      });
    } catch (error) {
      failures.push(
        `${job.label}（${job.id}）の composition を作れない: ${String(error?.message ?? error).split("\n")[0]}`,
      );
      continue;
    }
    const frames = [
      ...new Set(job.frames(composition.durationInFrames)),
    ].filter((f) => f >= 0 && f < composition.durationInFrames);
    if (frames.length === 0)
      failures.push(
        `${job.label}（${job.id}）の描くコマが無い（尺 ${composition.durationInFrames}）`,
      );
    for (const frame of frames) {
      const output = join(
        stillsDir,
        `${job.id}-${job.label.replace(/\s+/g, "_")}-${frame}.png`,
      );
      try {
        await renderStill({
          composition,
          serveUrl,
          output,
          frame,
          inputProps: job.props,
          puppeteerInstance: browser,
          imageFormat: "png",
          logLevel: "error",
        });
        if (!existsSync(output) || statSync(output).size === 0)
          failures.push(`${job.label} の ${frame} コマ目の PNG が空`);
        else drawn++;
      } catch (error) {
        failures.push(
          `${job.label}（${job.id}）の ${frame} コマ目を描けない: ${String(error?.message ?? error).split("\n")[0]}`,
        );
      }
    }
  }
} finally {
  await browser.close({ silent: true });
  if (keepArg < 0) rmSync(work, { recursive: true, force: true });
}
lap(`描いた ${drawn} コマ`);

if (failures.length > 0) {
  console.error("verify-sns-makers: 失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `verify-sns-makers: OK（${jobs.length} 件の props、${drawn} コマを描いた${keepArg >= 0 ? `。出力は ${stillsDir}` : ""}）`,
);
