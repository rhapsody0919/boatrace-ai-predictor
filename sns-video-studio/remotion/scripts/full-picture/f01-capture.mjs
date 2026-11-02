/**
 * 型 f01 の試作: 左に置く龍神の実画面を撮る（Playwright、viewport 1280・deviceScaleFactor 2）。
 * 画面の数字を台本と同じ材料にそろえるため、/api/analogy/{facts,similar,scenario} の応答を材料 JSON の応答に差し替える
 * （材料は公開 API の応答をそのまま持っている。fetch-materials.mjs）。ほかの読み取り（Supabase の匿名読み取り等）は本番のまま。
 * 章の部品の外枠で切り抜き、切り抜いた範囲の文字（照合用）・GOLD の枠を重ねる箱・カーソルを置く箱を返す。
 */
import { chromium } from "playwright";
import { join } from "node:path";
import process from "node:process";

export const SITE = process.env.F01_SITE ?? "https://www.boat-ai.jp";
/**
 * 撮る幅。横長の部品（6艇の図・艇の行・類似レースの1着・形の札）はスマホ幅で撮り、左の枠の縦横比に近づける
 * （1280幅の本文の列は比2〜2.5で、左の枠の下が約40%空いた。visual-designer 2026-10-27、オーナー「余白が気になる」）。
 * 縦長の部品（着順の流れ・思考アシストの相手）は PC 幅のまま
 */
export const VIEWPORT = { width: 1280, height: 900 };
export const NARROW = { width: 430, height: 900 };
/** 拡大の上限も同じ倍率（撮った画素を引き伸ばさない） */
export const DPR = 3;
/** 左の枠（1920x1080 の中、F01.jsx の LEFT と同じ）。外の余白48・右の列との溝56 */
export const LEFT_BOX = { x: 48, y: 32, w: 1136, h: 838 };
const PAD = 8;

function routeMaterials(page, m) {
  const keys = m.api.facts?.today?.scope_keys?.["1"] ?? {};
  const byScope = { [keys.NC]: "scenarioNC", [keys.NCR]: "scenarioNCR", [keys.NA]: "scenarioNA", [keys.VA]: "scenarioVA" };
  return page.route(/\/api\/analogy\/(facts|similar|scenario)\//, (route) => {
    const u = new URL(route.request().url());
    const kind = u.pathname.split("/")[3];
    const scope = u.searchParams.get("scope");
    const body = kind === "facts" ? m.api.facts : kind === "similar" ? m.api.similar : scope ? m.api[byScope[scope]] : m.api.scenario;
    if (!body) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ status: "absent" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

/**
 * 撮る画面の時点（ソナーの「時点」）。材料の時点にそろえる。facts の応答は出走表の段でも status が exhibition_ready で、
 * 画面は既定で展示後に切り替わり、値の無い展示タイムの軸を足して「6項目中」と出た（材料は5項目。2026-10-30 15場9R・
 * 11-01 4場10R の c12）。毎日の材料は racecard（daily.mjs）
 * @param {{stage?: string}} m 材料 JSON
 * @returns {"racecard"|"exhibition"}
 */
export const pageStageOf = (m) => (m.stage === "exhibition" ? "exhibition" : "racecard");

/** ソナーの「時点」を押してそろえる。切り替えが無い（展示前の段）ときは画面も出走表なので、展示後を求めたら止める */
async function setStage(page, stage) {
  const group = page.locator('[data-af-control="stage"]').first();
  if (!(await group.count())) {
    if (stage === "exhibition") throw new Error("ソナーに時点の切り替えが無い（材料は展示後、画面は展示前）");
    return;
  }
  const btn = group.locator("button").nth(stage === "racecard" ? 0 : 1);
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await page.waitForTimeout(1200);
  if ((await btn.getAttribute("aria-pressed")) !== "true") throw new Error(`ソナーの時点を ${stage} にできない`);
}

/** 固定の帯（Cookie の案内・下の3連単の帯・ヘッダー）を隠す（切り抜きに重ならないように） */
async function hideFixed(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const p = getComputedStyle(el).position;
      // 固定の帯は隠す。sticky（タブの帯・図の列）は流れの位置に戻す（隠すと図ごと消える）
      if (p === "fixed") {
        el.style.setProperty("visibility", "hidden", "important");
        el.dataset.f01Hidden = "1";
      } else if (p === "sticky") {
        el.style.setProperty("position", "static", "important");
        el.dataset.f01Hidden = "1";
      }
    }
  });
}
/** 隠した帯を戻す（タブ・ボタンを押す前に） */
async function showFixed(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-f01-hidden]")) {
      el.style.removeProperty("visibility");
      el.style.removeProperty("position");
      delete el.dataset.f01Hidden;
    }
  });
}

/** rect（ページ座標・CSS px）の中の文字（照合用）と、文字の最小の大きさ（CSS px） */
async function textIn(page, rect) {
  return page.evaluate((r) => {
    const out = [];
    const sizes = [];
    let minFont = Infinity;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      // 閉じた折りたたみの中身（高さ0で隠れている）は数えない
      if (el.closest("details:not([open])") && !el.closest("summary")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const b = range.getBoundingClientRect();
      const x = b.x + scrollX;
      const y = b.y + scrollY;
      if (b.width === 0 || x + b.width < r.x || x > r.x + r.w || y + b.height < r.y || y > r.y + r.h) continue;
      out.push(t);
      // svg の中の字は viewBox の縮尺を掛けた画面の上の大きさ（計算した font-size は svg の単位）
      const px = parseFloat(cs.fontSize) * (el instanceof SVGElement ? (el.getScreenCTM()?.a ?? 1) : 1);
      sizes.push([Math.round(px * 10) / 10, t.slice(0, 20)]);
      minFont = Math.min(minFont, px);
    }
    sizes.sort((a, b) => a[0] - b[0]);
    return { text: out.join(" "), minFont: Number.isFinite(minFont) ? minFont : null, small: sizes.slice(0, 6) };
  }, rect);
}

const union = (rs) => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const pad = (r) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + PAD * 2, h: r.h + PAD * 2 });
const box = async (loc) => {
  const b = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });
  return b;
};
/** 切り抜きの中の座標（CSS px） */
const rel = (r, clip) => ({ x: r.x - clip.x, y: r.y - clip.y, w: r.w, h: r.h });

async function shoot(page, clip, file, extra = {}) {
  // 全体の撮影（fullPage）は画面の高さを広げ、高さが画面に合わせて変わる部品の分だけ下の部品がずれた（着順の流れが約100px）。
  // 切り抜きを画面の中に送り、画面の座標で撮る（切り抜きは全て画面の高さ900より低い）
  if (clip.h > page.viewportSize().height) throw new Error(`切り抜き ${Math.round(clip.h)}px が画面の高さより高い（${file}）`);
  const sy = await page.evaluate((y) => {
    window.scrollTo(0, Math.max(0, y - 20));
    return window.scrollY;
  }, clip.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: file, clip: { x: clip.x, y: clip.y - sy, width: clip.w, height: clip.h } });
  const t = await textIn(page, clip);
  // 拡大は deviceScaleFactor まで（それ以上は撮った画素を引き伸ばすだけでぼける）
  const scale = Math.min(LEFT_BOX.h / clip.h, LEFT_BOX.w / clip.w, DPR);
  return { file, clip, scale, text: t.text, minFontPx: t.minFont === null ? null : Math.round(t.minFont * scale * 10) / 10, small: t.small.map(([px, s]) => [Math.round(px * scale * 10) / 10, s]), ...extra };
}

/** 差がつく材料: 6艇の図と艇の行 */
async function cutRadar(page, gold, part) {
  const rows = page.locator("text=/\\d+項目中 \\d+ 項目で2位以内/");
  await rows.first().waitFor({ timeout: 30000 });
  const rowBoxes = [];
  for (let i = 0; i < (await rows.count()); i++) rowBoxes.push(await box(rows.nth(i).locator("xpath=ancestor::*[self::button or self::li or self::div][1]")));
  // 図は艇の行の左（PC 幅）か上（スマホ幅）にある、いちばん大きい svg
  const svgs = page.locator("svg");
  let radar = null;
  for (let i = 0; i < (await svgs.count()); i++) {
    const b = await box(svgs.nth(i));
    const near = b.x + b.w <= rowBoxes[0].x + 4 ? Math.abs(b.y - rowBoxes[0].y) < 200 : b.y + b.h <= rowBoxes[0].y + 4 && rowBoxes[0].y - (b.y + b.h) < 700;
    if (b.w > 250 && near && (!radar || b.w * b.h > radar.w * radar.h)) radar = b;
  }
  if (!radar) throw new Error("差がつく材料の図が見つからない");
  // ⑤は艇の行だけ（字を大きく。GOLD の枠を艇の行に重ねる）
  const clip = pad(part === "rows" ? union(rowBoxes) : radar);
  // 艇の行は上から1〜6号艇
  const goldBoxes = gold.map((b) => rel(rowBoxes[b - 1], clip));
  return { clip, goldBoxes };
}

async function openTab(page, name) {
  await showFixed(page);
  await page.getByRole("tab", { name }).first().click();
  await page.waitForTimeout(2500);
}

/**
 * 部品そのものを撮る（Playwright が部品を画面に送って測る）。着順の流れは、上の部品の読み込みで撮る間に位置が約100px ずれたので、
 * 測った座標で撮らず部品で撮る。座標（clip）は撮った直後に測る
 */
async function shootEl(page, loc, file, extra = {}) {
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await loc.screenshot({ path: file });
  const clip = await box(loc);
  const t = await textIn(page, clip);
  const scale = Math.min(LEFT_BOX.h / clip.h, LEFT_BOX.w / clip.w, DPR);
  return { file, clip, scale, text: t.text, minFontPx: t.minFont === null ? null : Math.round(t.minFont * scale * 10) / 10, small: t.small.map(([px, s]) => [Math.round(px * scale * 10) / 10, s]), ...extra };
}

/** sankey の1着の帯を押す（押した後の切り抜き） */
async function pickFirst(flow, boat) {
  const g = flow.locator(`svg g[role=button]`);
  for (let i = 0; i < (await g.count()); i++) {
    const label = (await g.nth(i).getAttribute("aria-label")) ?? "";
    if (label.includes(`${boat}号艇`)) {
      const b = await box(g.nth(i));
      await g.nth(i).dispatchEvent("click");
      return b;
    }
  }
  throw new Error(`着順の流れに ${boat}号艇の1着の帯が無い`);
}

/**
 * @param {object} m 材料 JSON
 * @param {{chapters: object[]}} s f01Script の結果
 * @param {string} outDir 撮った画像を置くフォルダ（public-dir）
 * @returns {Promise<Record<string, object>>} 撮った物の名前 → 撮った物。名前と章の並べ方は f01-build.mjs の PLAN。
 *   字の小ささ（2026-10-30 の f01 で7章が目安 28px に届かなかった、hq 11d 節）を直すため、章ごとに見せる部品だけを撮る
 *   （説明の行・凡例・ボタンを入れない）。部品の外枠で撮れば、左の枠いっぱいまで拡大できる
 */
export async function captureAll(m, s, outDir) {
  const browser = await chromium.launch();
  const open = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: DPR, locale: "ja-JP" });
    const page = await ctx.newPage();
    await routeMaterials(page, m);
    return page;
  };
  const shots = {};
  const file = (n) => join(outDir, `${n}.png`);
  const at = (c) => s.chapters.find((x) => x.id === c);
  const sonar = async (page) => {
    await page.goto(`${SITE}/race/${m.raceId}?tab=sonar`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "拒否する" }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await setStage(page, pageStageOf(m));
    await hideFixed(page);
  };
  try {
    // スマホ幅: 横長の部品
    const narrow = await open(NARROW);
    await sonar(narrow);
    // ①は図 → 艇の行の2カット。⑤は艇の行に GOLD の枠
    for (const [id, cid, part] of [["c1", "c1", "radar"], ["c12", "c1", "rows"], ["c5", "c5", "rows"]]) {
      const c = at(cid);
      if (!c) continue;
      const r = await cutRadar(narrow, id === "c5" ? c.shot.gold : [], part);
      shots[id] = await shoot(narrow, r.clip, file(id), { goldBoxes: r.goldBoxes, testid: part === "radar" ? "差がつく材料（図）" : "差がつく材料（艇の行）" });
    }
    const c2 = at("c2");
    if (c2) {
      await openTab(narrow, "類似レース");
      await hideFixed(narrow);
      // 1着の棒だけ: 見出し「どの艇が勝った？」から6号艇の行の下まで（上の件数の見出し・凡例を入れない）
      const top = await box(narrow.getByRole("heading", { name: "どの艇が勝った？" }).first());
      const end = await box(narrow.getByRole("heading", { name: "どう決まった？" }).first());
      const rows = await narrow.evaluate(
        ({ y0, y1 }) =>
          (() => {
            const out = [];
            const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n; n = w.nextNode()) {
              if (!/[1-6]号艇/.test(n.textContent)) continue;
              const r = document.createRange();
              r.selectNodeContents(n);
              out.push(r.getBoundingClientRect());
            }
            return out;
          })()
            .map((r) => ({ y: r.y + scrollY, b: r.y + scrollY + r.height }))
            .filter((r) => r.y > y0 && r.b < y1),
        { y0: top.y, y1: end.y },
      );
      if (rows.length < 2) throw new Error("類似レースの1着の棒の行が見つからない");
      const clip = pad({ x: top.x, y: top.y, w: Math.max(top.w, 380), h: Math.max(...rows.map((r) => r.b)) + 6 - top.y });
      shots.c2 = await shoot(narrow, clip, file("c2"), { testid: "類似レースの1着の棒" });
    }
    const c3 = at("c3");
    if (c3) {
      // 形の札は選んだ1枚だけ（狭い幅 360 で撮っても札の中の図の艇番は同じ割合で小さくなり、かえって 20.6px に下がった）
      await openTab(narrow, "展開シナリオ");
      await hideFixed(narrow);
      const btn = narrow.locator(".af-pats").first().locator("button", { hasText: c3.shot.form }).first();
      const b = await box(btn);
      const clip = { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 };
      shots.c3 = await shoot(narrow, clip, file("c3"), { goldBoxes: [rel(b, clip)], testid: "スタートの形" });
    }
    // PC 幅: 着順の流れ（図の暗い面だけを撮る。押す前・押した後）
    const page = await open(VIEWPORT);
    if (c2?.shot.cut2 || c3) await sonar(page);
    const flowShots = async (flow, pre, post, firstBoat, testid) => {
      const dark = flow.locator(".af-dark").first();
      shots[pre] = await shootEl(page, dark, file(pre));
      const hit = await pickFirst(flow, firstBoat);
      const at0 = await box(dark);
      await page.waitForTimeout(1200);
      shots[post] = await shootEl(page, dark, file(post), { cursor: rel(hit, at0), testid });
    };
    if (c2?.shot.cut2) {
      await openTab(page, "類似レース");
      await hideFixed(page);
      await flowShots(page.locator(".af-flow").first(), "c2-pre", "c22", c2.shot.firstBoat, "着順の流れ");
    }
    if (c3) {
      await openTab(page, "展開シナリオ");
      await hideFixed(page);
      await page.locator(".af-pats").first().locator("button", { hasText: c3.shot.form }).first().click();
      await page.waitForTimeout(2500);
      await hideFixed(page);
      await flowShots(page.locator(".af-flow").last(), "c3-pre", "c32", c3.shot.firstBoat, "着順の流れ（展開）");
    }
    // 思考アシスト＞相手（スマホ幅）。上＝軸のボタン・見出し・結論の1行、下＝2着の棒、の2カット
    const c4 = at("c4");
    if (c4) {
      await narrow.goto(`${SITE}/race/${m.raceId}/assist`, { waitUntil: "networkidle" });
      await narrow.waitForTimeout(1500);
      await narrow.getByRole("button", { name: "拒否する" }).click({ timeout: 3000 }).catch(() => {});
      await narrow.getByRole("tab", { name: "相手" }).click();
      await narrow.waitForTimeout(1500);
      await hideFixed(narrow);
      const follow = narrow.locator(".ta-box", { hasText: "軸（1着）" }).first();
      const radio = (b) => follow.getByRole("radio", { name: `${b}号艇を軸` });
      const topClip = async () => pad(union([await box(follow.locator(".ta-axis-pick-row").first()), await box(follow.locator(".ta-follow-concl").first())]));
      const bars = follow.locator("table.ta-follow").first();
      if ((await radio(c4.shot.axis).getAttribute("aria-checked")) !== "true") await radio(c4.shot.axis).click();
      await narrow.waitForTimeout(1200);
      const clip = await topClip();
      const target = rel(await box(radio(c4.shot.axis2)), clip);
      shots.c4 = await shoot(narrow, clip, file("c4"), { testid: "相手（軸1号艇）" });
      shots.c4b = await shootEl(narrow, bars, file("c4b"), { testid: "相手の2着の棒（軸1号艇）" });
      await radio(c4.shot.axis2).click();
      await narrow.waitForTimeout(1500);
      const clip2 = await topClip();
      shots.c42 = await shoot(narrow, clip2, file("c42"), { cursorFrom: target, testid: `相手（軸${c4.shot.axis2}号艇）` });
      shots.c42b = await shootEl(narrow, bars, file("c42b"), { testid: `相手の2着の棒（軸${c4.shot.axis2}号艇）` });
      const close = at("close");
      if (close) {
        const clip3 = await topClip();
        const g = rel(await box(radio(close.shot.goldAxis)), clip3);
        shots.close = await shoot(narrow, clip3, file("close"), { goldBoxes: [g], testid: "相手（押していない軸）" });
      }
    }
  } finally {
    await browser.close();
  }
  return shots;
}
