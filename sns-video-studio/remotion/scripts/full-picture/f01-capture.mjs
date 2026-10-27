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
      minFont = Math.min(minFont, parseFloat(cs.fontSize));
    }
    return { text: out.join(" "), minFont: Number.isFinite(minFont) ? minFont : null };
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
  await page.screenshot({ path: file, clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h }, fullPage: true });
  const t = await textIn(page, clip);
  // 拡大は deviceScaleFactor まで（それ以上は撮った画素を引き伸ばすだけでぼける）
  const scale = Math.min(LEFT_BOX.h / clip.h, LEFT_BOX.w / clip.w, DPR);
  return { file, clip, scale, text: t.text, minFontPx: t.minFont === null ? null : Math.round(t.minFont * scale * 10) / 10, ...extra };
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

/** 着順の流れの切り抜き: 部品の上の空白を入れず、図の暗い面の下端まで（visual-designer 2026-10-27） */
async function flowClip(flow) {
  const dark = await box(flow.locator(".af-dark").first());
  const top = await box(flow.locator(".af-seg").first());
  return pad(union([top, dark]));
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
 * @returns {Promise<Record<string, object>>} 章の id（2カット目は id+"2"）→ 撮った物
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
      // 見出し「類似レースの決まり方」から、1着の棒の6号艇の行の下まで（下の空白・次の段を入れない）
      const top = await box(narrow.getByRole("heading", { name: "類似レースの決まり方" }).first());
      const end = await box(narrow.getByRole("heading", { name: "どう決まった？" }).first());
      const rows = await narrow.evaluate(
        ({ y0, y1 }) =>
          [...document.querySelectorAll("body *")]
            .filter((e) => e.children.length === 0 && /6号艇/.test(e.textContent))
            .map((e) => e.getBoundingClientRect())
            .map((r) => r.y + scrollY + r.height)
            .filter((b) => b > y0 && b < y1),
        { y0: top.y, y1: end.y },
      );
      const bottom = rows.length ? Math.max(...rows) + 6 : end.y - 12;
      const clip = pad({ x: top.x, y: top.y, w: Math.max(top.w, 380), h: bottom - top.y });
      shots.c2 = await shoot(narrow, clip, file("c2"), { testid: "類似レースの決まり方" });
    }
    const c3 = at("c3");
    if (c3) {
      await openTab(narrow, "展開シナリオ");
      await hideFixed(narrow);
      const pats = narrow.locator(".af-pats").first();
      const btn = pats.locator("button", { hasText: c3.shot.form }).first();
      // 形の札は選んだ札と隣の札の2枚（同じ行）。外周は狭く（隣の札の縁を入れない）
      const cards = pats.locator("button");
      const all = [];
      for (let i = 0; i < (await cards.count()); i++) all.push(await box(cards.nth(i)));
      const b = await box(btn);
      const row = all.filter((r) => Math.abs(r.y - b.y) < 4);
      const i0 = row.findIndex((r) => Math.abs(r.x - b.x) < 2);
      const pair = row.length < 2 ? [b] : i0 > 0 ? [row[i0 - 1], row[i0]] : row.slice(0, 2);
      const u = union(pair);
      const clip = { x: u.x - 4, y: u.y - 4, w: u.w + 8, h: u.h + 8 };
      shots.c3 = await shoot(narrow, clip, file("c3"), { goldBoxes: [rel(b, clip)], testid: "スタートの形" });
    }
    // PC 幅: 縦長の部品（着順の流れ・思考アシストの相手）
    const page = await open(VIEWPORT);
    if (c2?.shot.cut2 || c3) await sonar(page);
    if (c2?.shot.cut2) {
      await openTab(page, "類似レース");
      await hideFixed(page);
      const flow = page.locator(".af-flow").first();
      const clip2 = await flowClip(flow);
      const before = await shoot(page, clip2, file("c2-pre"));
      const hit = await pickFirst(flow, c2.shot.firstBoat);
      await page.waitForTimeout(1200);
      shots.c22 = await shoot(page, clip2, file("c22"), { pre: before.file, cursor: rel(hit, clip2), testid: "着順の流れ" });
    }
    if (c3) {
      await openTab(page, "展開シナリオ");
      await hideFixed(page);
      await page.locator(".af-pats").first().locator("button", { hasText: c3.shot.form }).first().click();
      await page.waitForTimeout(2500);
      await hideFixed(page);
      const flow = page.locator(".af-flow").last();
      const clip2 = await flowClip(flow);
      const before = await shoot(page, clip2, file("c3-pre"));
      const hit = await pickFirst(flow, c3.shot.firstBoat);
      await page.waitForTimeout(1200);
      shots.c32 = await shoot(page, clip2, file("c32"), { pre: before.file, cursor: rel(hit, clip2), testid: "着順の流れ（展開）" });
    }
    // 思考アシスト＞相手
    const c4 = at("c4");
    if (c4) {
      await page.goto(`${SITE}/race/${m.raceId}/assist`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "拒否する" }).click({ timeout: 3000 }).catch(() => {});
      await page.getByRole("tab", { name: "相手" }).click();
      await page.waitForTimeout(1500);
      await hideFixed(page);
      const follow = page.locator(".ta-box", { hasText: "軸（1着）" }).first();
      const radio = (b) => follow.getByRole("radio", { name: `${b}号艇を軸` });
      if ((await radio(c4.shot.axis).getAttribute("aria-checked")) !== "true") await radio(c4.shot.axis).click();
      await page.waitForTimeout(1200);
      const clip = pad(await box(follow));
      const target = rel(await box(radio(c4.shot.axis2)), clip);
      shots.c4 = await shoot(page, clip, file("c4"), { testid: "相手（軸1号艇）" });
      await radio(c4.shot.axis2).click();
      await page.waitForTimeout(1500);
      const clip2 = pad(await box(follow));
      shots.c42 = await shoot(page, clip2, file("c42"), { cursorFrom: target, testid: `相手（軸${c4.shot.axis2}号艇）` });
      const close = at("close");
      if (close) {
        const g = rel(await box(radio(close.shot.goldAxis)), clip2);
        shots.close = await shoot(page, clip2, file("close"), { goldBoxes: [g], testid: "相手（押していない軸）" });
      }
    }
  } finally {
    await browser.close();
  }
  return shots;
}
