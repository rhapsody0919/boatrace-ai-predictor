/**
 * 型 f01 の左に置く龍神の画面を撮る（docs/design/f01-stable-capture/、オーナー 2026-11-04「推奨通りで良い」）。
 * 本番のサイトは撮らない。龍神のサイトの撮影用の頁（src/snsCapture/F01Capture.jsx、/sns-capture/f01/{part}）を
 * ローカルの dev サーバー（ビルドの旗 VITE_SNS_CAPTURE=1）で開き、材料 JSON を頁に渡して、本番と同じ部品を固定の幅の箱に描かせる。
 * 状態（押す前・押した後・選んだ艇・軸）は URL の引数で決めるので、押す・待つ・送る（スクロール）・Cookie・帯の処理は無い。
 * 頁が描き終えた印（data-f01-ready）を待ち、箱を1回撮るだけ。GOLD の枠・カーソルの箱・照合の文字・字の最小の大きさは頁が data-f01-meta で返す。
 * ネットへの読み取りはしない（dev サーバーの外と /api/ への読み取りは止める）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright";
import { VIEWPORTS, F01_PARTS } from "../../../../src/snsCapture/f01Parts.js";

/** 龍神のサイトのリポジトリの根（dev サーバーを立てる所） */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
/** 拡大の上限も同じ倍率（撮った画素を引き伸ばさない） */
export const DPR = 3;
/** 左の枠（1920x1080 の中、F01.jsx の LEFT と同じ）。外の余白48・右の列との溝56 */
export const LEFT_BOX = { x: 48, y: 32, w: 1136, h: 838 };
/** 頁が描き終えるまでの上限（ms）。待つ秒数の決め打ちではなく、描き終えた印が来なければ止める上限 */
const READY_TIMEOUT = 30000;

/**
 * 撮る画面の時点（ソナーの「時点」）。材料の時点にそろえる。facts の応答は出走表の段でも status が exhibition_ready で、
 * 本番の画面は既定で展示後に切り替わり、値の無い展示タイムの軸を足して「6項目中」と出た（2026-10-30 15場9R・11-01 4場10R の c12）。
 * 撮影用の頁には URL の引数 stage で渡す
 * @param {{stage?: string}} m 材料 JSON
 * @returns {"racecard"|"exhibition"}
 */
export const pageStageOf = (m) => (m.stage === "exhibition" ? "exhibition" : "racecard");

const freePort = () =>
  new Promise((ok, ng) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", ng);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => ok(port));
    });
  });

/**
 * 撮影用の頁を出す dev サーバーを立てる（F01_CAPTURE_URL があれば、立ててあるサーバーを使う）。
 * /api の転送は切る（API_PROXY_TARGET=""。頁は API を読まない）
 * @returns {Promise<{url: string, stop: () => void}>}
 */
export async function startCaptureServer() {
  const given = process.env.F01_CAPTURE_URL;
  if (given) {
    // 手元で立てた撮影用のサーバーだけ（本番の URL を渡すと頁が無く、描き終えた印を待って止まる）
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(given)) throw new Error(`F01_CAPTURE_URL はローカルの dev サーバーだけ（${given}）`);
    return { url: given.replace(/\/$/, ""), stop: () => {} };
  }
  // 空いた port を探してから vite が掴むまでの間に、別の f01（並べて作る日）が同じ port を取ることがある。そのときは port を変えて3回まで
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      return await launchVite(await freePort());
    } catch (e) {
      last = e;
      if (!/already in use|EADDRINUSE/.test(String(e?.message))) throw e;
    }
  }
  throw last;
}

/** port で vite を立て、頁が返るまで待つ。立ち上がらなければ子と依存の前処理の置き場を片づけて止める */
async function launchVite(port) {
  const vite = join(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
  const cacheDir = mkdtempSync(join(tmpdir(), "f01-vite-"));
  const config = join(dirname(fileURLToPath(import.meta.url)), "vite-capture.config.mjs");
  const child = spawn(process.execPath, [vite, "--config", config, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_SNS_CAPTURE: "1", API_PROXY_TARGET: "", F01_VITE_CACHE_DIR: cacheDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  const collect = (d) => {
    log = (log + d).slice(-4000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const url = `http://127.0.0.1:${port}`;
  // 親が例外・SIGINT で止まっても子（vite）を残さない
  const kill = () => {
    if (child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("exit", kill);
  const stop = () => {
    kill();
    process.removeListener("exit", kill);
    rmSync(cacheDir, { recursive: true, force: true });
  };
  const until = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null) {
      stop();
      throw new Error(`撮影用の dev サーバーが止まった（${child.exitCode}）: ${log}`);
    }
    try {
      const r = await fetch(`${url}/sns-capture/f01/radar`);
      if (r.ok) break;
    } catch {
      // まだ立ち上がっていない（接続を断られる）ときは待つ。上限を過ぎたら下で止める
    }
    if (Date.now() > until) {
      stop();
      throw new Error(`撮影用の dev サーバーが60秒で立ち上がらない: ${log}`);
    }
    await new Promise((ok) => setTimeout(ok, 300));
  }
  return { url, stop };
}

/**
 * 撮る物の一覧（名前 → 部品・URL の引数・付ける物）。名前と章の並べ方は f01-build.mjs の PLAN。
 * 同じ部品（押す前・押した後、④と締めの軸のボタン）は group を同じにする（f01-build.mjs が同じ倍率でそろえる）
 * @param {object} m 材料 JSON @param {{chapters: object[]}} s f01Script の結果
 */
export function capturePlan(m, s) {
  const at = (c) => s.chapters.find((x) => x.id === c);
  const stage = pageStageOf(m);
  const out = [];
  const add = (name, part, q, extra = {}) => out.push({ name, part, q: { stage, ...q }, ...extra });
  // ①は図 → 艇の行。⑤は艇の行に GOLD の枠
  if (at("c1")) {
    add("c1", "radar", {}, { testid: "差がつく材料（図）" });
    add("c12", "rows", {}, { testid: "差がつく材料（艇の行）", group: "rows" });
  }
  const c5 = at("c5");
  if (c5) add("c5", "rows", {}, { testid: "差がつく材料（艇の行）", group: "rows", gold: { boats: c5.shot.gold } });
  // ②は1着の棒 → 着順の流れ（押す前、カーソル）→ 押した後
  const c2 = at("c2");
  if (c2) {
    add("c2", "winBars", {}, { testid: "類似レースの1着の棒" });
    if (c2.shot.cut2) {
      add("c2-pre", "flow", { tab: "similar", point: c2.shot.firstBoat }, { group: "flow-similar", cursorOf: true });
      add("c22", "flow", { tab: "similar", first: c2.shot.firstBoat }, { testid: "着順の流れ", group: "flow-similar", cursorFrom: "c2-pre" });
    }
  }
  // ③は形の札1枚（GOLD の枠）→ 着順の流れ（押す前、カーソル）→ 押した後（11/2 18-10 の形。オーナー 11/4）
  const c3 = at("c3");
  if (c3) {
    add("c3", "pattern", { formName: c3.shot.form }, { testid: "スタートの形", gold: { card: true } });
    add("c3-pre", "flow", { tab: "scenario", formName: c3.shot.form, point: c3.shot.firstBoat }, { group: "flow-scenario", cursorOf: true });
    add("c32", "flow", { tab: "scenario", formName: c3.shot.form, first: c3.shot.firstBoat }, { testid: "着順の流れ（展開）", group: "flow-scenario", cursorFrom: "c3-pre" });
  }
  // ④は思考アシスト＞相手。上＝軸のボタン・見出し・結論の1行、下＝2着の棒。軸1号艇 → 軸 axis2。締めは軸 axis2 の画面で、まだ押していない軸に GOLD
  const c4 = at("c4");
  if (c4) {
    add("c4", "followTop", { axis: c4.shot.axis }, { testid: "相手（軸1号艇）", group: "follow-top" });
    add("c4b", "followTable", { axis: c4.shot.axis }, { testid: "相手の2着の棒（軸1号艇）", group: "follow-table" });
    add("c42", "followTop", { axis: c4.shot.axis2 }, { testid: `相手（軸${c4.shot.axis2}号艇）`, group: "follow-top", axisFrom: { shot: "c4", boat: c4.shot.axis2 } });
    add("c42b", "followTable", { axis: c4.shot.axis2 }, { testid: `相手の2着の棒（軸${c4.shot.axis2}号艇）`, group: "follow-table" });
  }
  const close = at("close");
  if (close) add("close", "followTop", { axis: close.shot.axis }, { testid: "相手（押していない軸）", group: "follow-top", gold: { boats: [close.shot.goldAxis] } });
  return out;
}

/** 撮った物の倍率（左の枠に収まる最大。撮った画素を引き伸ばさない DPR まで） */
const scaleOf = (w, h) => Math.min(LEFT_BOX.h / h, LEFT_BOX.w / w, DPR);

/**
 * @param {object} m 材料 JSON
 * @param {{chapters: object[]}} s f01Script の結果
 * @param {string} outDir 撮った画像を置くフォルダ（public-dir）
 * @returns {Promise<Record<string, object>>} 撮った物の名前 → 撮った物（file・clip・scale・text・minFontPx・small・group・goldBoxes・cursor・cursorFrom・testid）
 */
export async function captureAll(m, s, outDir) {
  const plan = capturePlan(m, s);
  const server = await startCaptureServer();
  let browser = null;
  const origin = new URL(server.url).origin;
  const contexts = {};
  const pageOf = async (view) => {
    if (contexts[view]) return contexts[view];
    const ctx = await browser.newContext({
      viewport: VIEWPORTS[view],
      deviceScaleFactor: DPR,
      locale: "ja-JP",
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    // ネットへの読み取りはしない: dev サーバーの外と /api/ は止める（頁は読まない。読もうとしたら撮影を止める）
    const blocked = [];
    await ctx.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.origin === origin && !u.pathname.startsWith("/api/")) return route.continue();
      blocked.push(u.href);
      return route.abort();
    });
    await ctx.addInitScript((mat) => {
      window.__F01_MATERIALS__ = mat;
    }, m);
    const page = await ctx.newPage();
    const errors = [];
    // 描画中の例外は「時間切れ」に化かさず、その文で止める
    page.on("pageerror", (e) => errors.push(e.message));
    contexts[view] = { page, blocked, errors };
    return contexts[view];
  };
  const shots = {};
  try {
    browser = await chromium.launch();
    for (const p of plan) {
      const def = F01_PARTS[p.part];
      const { page, blocked, errors } = await pageOf(def.view);
      errors.length = 0;
      const q = new URLSearchParams(Object.entries(p.q).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
      await page.goto(`${server.url}/sns-capture/f01/${p.part}?${q}`);
      const el = page.locator("[data-f01-shot][data-f01-ready], [data-f01-error]").first();
      await Promise.race([
        el.waitFor({ timeout: READY_TIMEOUT }),
        page.waitForEvent("pageerror", { timeout: READY_TIMEOUT }).then((e) => {
          throw new Error(`撮影用の頁（${p.part}）で例外: ${e.message}`);
        }),
      ]).catch((e) => {
        throw errors.length ? new Error(`撮影用の頁（${p.part}）で例外: ${errors[0]}`) : e;
      });
      if (await el.getAttribute("data-f01-error").then((v) => v !== null)) throw new Error(`撮影用の頁（${p.part}）: ${await el.textContent()}`);
      if (blocked.length) throw new Error(`撮影用の頁がネットを読もうとした: ${blocked.slice(0, 3).join(" ")}`);
      const meta = JSON.parse(await el.getAttribute("data-f01-meta"));
      const file = join(outDir, `${p.name}.png`);
      await el.screenshot({ path: file, animations: "disabled", caret: "hide" });
      // 描き終えた後に出た例外・頁の読み直し（vite の依存の前処理）も、撮った物を信じず止める
      if (errors.length) throw new Error(`撮影用の頁（${p.part}）で例外: ${errors[0]}`);
      if ((await el.getAttribute("data-f01-meta")) !== JSON.stringify(meta)) throw new Error(`撮影用の頁（${p.part}）が撮る間に描き直された`);
      const clip = { x: 0, y: 0, w: meta.w, h: meta.h };
      const scale = scaleOf(meta.w, meta.h);
      const shot = {
        file,
        clip,
        scale,
        group: p.group ?? p.name,
        part: p.part,
        text: meta.text,
        minFontPx: meta.minFontPx === null ? null : Math.round(meta.minFontPx * scale * 10) / 10,
        small: meta.small.map(([px, x]) => [Math.round(px * scale * 10) / 10, x]),
        boxes: meta.boxes,
        testid: p.testid,
      };
      if (p.gold?.boats) shot.goldBoxes = p.gold.boats.map((b) => meta.boxes.boats[b - 1]);
      if (p.gold?.card) shot.goldBoxes = [meta.boxes.card];
      if (p.cursorOf) shot.cursor = meta.boxes.cursor;
      // 押した後のカットにも押す前のカーソルの箱を持たせる（f01-build.mjs はカーソルの名前の撮った物の cursor を読む）
      if (p.cursorFrom) shot.cursor = shots[p.cursorFrom]?.cursor;
      // 思考アシストの軸のボタン: 押す前の画面（shot）の、押す軸のボタンの箱
      if (p.axisFrom) shot.cursorFrom = shots[p.axisFrom.shot]?.boxes?.boats?.[p.axisFrom.boat - 1];
      shots[p.name] = shot;
    }
  } finally {
    await browser?.close();
    server.stop();
  }
  return shots;
}
