// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { viewportSkipReason } from "../viewport-skip.js";
import { test, expect } from "../fixtures.js";

// 横スクロールの手がかり（useHorizontalScrollHint）。右に残っている幅に合わせて出し方を変える
// （#1130 ファン評価で見送った P3 を共通部品で直したもの）。
// - 残り 1px 超: 「›」（押せる幅 44px 以上）と右端のフェード（.has-more）
//   以前は 12px 以下の残りで「›」を出さず細いフェードだけにしていた（#1169）。380px の枠別の全コース表で
//   4〜10px だけ溢れ、「(n=20)」が「(n=2」に読めた（BOA-735、ユーザー判断で境目を下げた）
// - 残り 1px 以下: 何も出さない
// このフックを使う画面ごとに、そのときの表示と、右端の手前 10px まで送った表示の両方を確かめる。
// 本番データの列幅ではたまたま境目を踏まないことがあるため、送る位置はテストで決める
const HSCROLL_SCREENS = [
  {
    name: "直前情報の展示情報",
    path: "/race/2026-09-29-16-12?tab=beforeInfo",
    ready: ".rbi-card .drt-table",
    // #1127 以降は 320px でも表が収まる（溢れていないときに手がかりを出さないことを確かめる）
  },
  {
    name: "今節の得点率早見",
    path: "/race/2026-09-29-16-12?tab=meet",
    ready: ".rmt-forecast-scroll table",
    mobileOnly: true,
  },
  {
    // このレースは中止で得点率早見が出ない。日別表だけを見る
    name: "今節の日別表",
    path: "/race/2026-09-21-02-05?tab=meet",
    ready: ".race-history-table-row",
    // 今節は本番 Supabase を2段で引き、表が出るまで1〜2分かかる日がある（race-detail-mobile.spec.js）。
    // 溢れるのはスマホ幅だけなので、そこだけで確かめる
    mobileOnly: true,
  },
  {
    name: "モーター情報の一覧とコース別成績",
    path: "/race/2026-09-29-16-12?tab=motor",
    ready: ".motor-ranking-row",
    // 行を押すと、そのモーターのコース別成績（MotorWakuStatsGrid）が開く
    open: async (page) => {
      // 会場内順位の列（#1153）は一覧の行が出たあとに足される。列が増える前に送ると、
      // 送ったあとに表が広がり、残りの幅が 20px・10px にならない（CI で 71px 残った）
      await expect(page.locator(".motor-venue-rank-head")).toBeVisible({
        timeout: 30000,
      });
      await checkHscrollHints(page, "モーター一覧");
      await page.locator(".motor-ranking-row").first().click();
      await expect(page.locator(".motor-waku-table")).toBeVisible({
        timeout: 30000,
      });
    },
  },
  {
    name: "枠別情報の全コース表",
    path: "/race/2026-09-29-16-12?tab=waku",
    ready: ".rwit-fold-summary",
    open: async (page) => {
      await page.locator(".rwit-fold-summary").first().click();
      await expect(page.locator(".rwit-grid-hscroll")).toBeVisible({
        timeout: 30000,
      });
    },
  },
];

test.describe("レイアウト: 横スクロールの手がかりは右に残っている幅に合わせて出す", () => {
  for (const screen of HSCROLL_SCREENS) {
    test(screen.name, async ({ page }, testInfo) => {
      test.skip(
        screen.mobileOnly && testInfo.project.name !== "layout-mobile",
        viewportSkipReason("スマホ幅でだけ溢れる画面"),
      );
      test.slow();
      await page.goto(screen.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(screen.ready).first()).toBeVisible({
        timeout: 90000,
      });
      if (screen.open) await screen.open(page);
      await checkHscrollHints(page, screen.name);
    });
  }
});

/** 画面にある .hscroll-hint を全部確かめる */
async function checkHscrollHints(page, label) {
  const hints = page.locator(".hscroll-hint");
  const count = await hints.count();
  expect(count, `${label}: 手がかりの箱`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const hint = hints.nth(i);
    if (!(await hint.isVisible())) continue;
    const at = `${label}[${i}]`;
    // そのときの表示。表がそろうまでは幅が変わるので、落ち着くまで読み直す
    await expect
      .poll(async () => hintMismatch(await readHint(hint)), {
        timeout: 15000,
        message: `${at}: そのときの表示`,
      })
      .toBe("");
    const { maxScroll } = await readHint(hint);
    if (maxScroll <= 30) continue;
    // 右端の手前 20px まで送る: まだ「›」を出す
    await readHint(hint, 20);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 残り20px` })
      .toMatchObject({
        remaining: 20,
        fadeWidth: 20,
        hasMore: true,
        moreButton: true,
      });
    // 右端の手前 10px まで送る: 少しだけでも残っていれば「›」を出す（BOA-735）
    await readHint(hint, 10);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 残り10px` })
      .toMatchObject({
        remaining: 10,
        fadeWidth: 10,
        hasMore: true,
        moreButton: true,
      });
    // 右端まで送る: 何も出さない
    await readHint(hint, 0);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 右端` })
      .toMatchObject({ remaining: 0, hasMore: false, moreButton: false });
    await expectGlyphDisc(hint, ".hscroll-less", at);
    // 左端へ戻すと「›」が出る。押せる幅は 44px 以上（以前は 28px で押し損ねやすかった）
    await readHint(hint, null);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 左端` })
      .toMatchObject({
        hasMore: true,
        moreButton: true,
        fadeWidth: Math.min(40, maxScroll),
      });
    expect(
      (await readHint(hint)).moreWidth,
      `${at}: 「›」の押せる幅`,
    ).toBeGreaterThanOrEqual(44);
    await expectGlyphDisc(hint, ".hscroll-more", at);
    // 押せる範囲を広げても、記号は以前と同じく端に寄せる。真ん中に置くと見出しの文字に
    // 寄って「ST›」のように続けて読めた（PR #1169 のレビュー）
    expect(
      (await readHint(hint)).moreGlyphFromRight,
      `${at}: 「›」の記号の位置`,
    ).toBeLessThanOrEqual(16);
  }
}

/**
 * 「›」「‹」の記号の後ろに面の色の円を敷いているか。左の列が固定されていない表では、記号の下を
 * 見出しの文字が流れて「枠番」の「枠」と一体に見えた（PR #1169 ファン評価1周目）
 */
async function expectGlyphDisc(hint, sel, at) {
  const bgImage = await hint.evaluate((el, s) => {
    const b = el.querySelector(`:scope > ${s}`);
    return b ? getComputedStyle(b).backgroundImage : null;
  }, sel);
  if (bgImage !== null) {
    expect(bgImage, `${at}: ${sel} の記号の下地`).toContain("radial-gradient");
  }
}

/** そのときの残りの幅に対して、出ている手がかりが合っていなければ食い違いを文で返す（合っていれば空文字） */
function hintMismatch(h) {
  // 境目の判定は丸める前の幅で行う（フックと同じ）
  const hasMore = h.remainingRaw > 1;
  const want = { hasMore, moreButton: hasMore };
  const got = { hasMore: h.hasMore, moreButton: h.moreButton };
  return JSON.stringify(want) === JSON.stringify(got)
    ? ""
    : `残り${h.remaining}px で ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`;
}

/**
 * 手がかりの箱（.hscroll-hint）の状態を読む。fromEnd を渡すと先に横へ送る
 * （右端からの距離 px。null なら左端へ戻す）。
 * スクロールするのは箱そのもの（直前情報）か中の要素（モーター・今節）で、外枠にも overflow-x: auto が
 * 付いている画面がある。実際に溢れている要素を選び、どれも溢れていなければいちばん内側を使う
 */
async function readHint(hint, fromEnd) {
  return hint.evaluate((el, d) => {
    const boxes = [el, ...el.querySelectorAll("*")].filter((n) =>
      ["auto", "scroll"].includes(getComputedStyle(n).overflowX),
    );
    const box =
      boxes.find((n) => n.scrollWidth > n.clientWidth) ?? boxes.at(-1);
    if (d !== undefined) {
      // 列を固定した表は、列の境目にしか止まらない（BOA-741）。ここで確かめるのは「残りの幅に応じた
      // 手がかりの出し分け」なので、止める仕組みを外して任意の位置に置く
      box.style.scrollSnapType = "none";
      box.scrollLeft = d === null ? 0 : box.scrollWidth - box.clientWidth - d;
    }
    const more = el.querySelector(":scope > .hscroll-more");
    return {
      remaining: Math.round(box.scrollWidth - box.clientWidth - box.scrollLeft),
      remainingRaw: box.scrollWidth - box.clientWidth - box.scrollLeft,
      maxScroll: box.scrollWidth - box.clientWidth,
      hasMore: el.classList.contains("has-more"),
      fadeWidth: el.classList.contains("has-more")
        ? Math.round(parseFloat(getComputedStyle(el, "::after").width))
        : 0,
      moreButton: Boolean(more),
      moreWidth: more ? more.getBoundingClientRect().width : 0,
      // 「›」の記号の中心から箱の右端までの距離
      moreGlyphFromRight: more
        ? (() => {
            const range = document.createRange();
            range.selectNodeContents(more);
            const g = range.getBoundingClientRect();
            return more.getBoundingClientRect().right - (g.left + g.right) / 2;
          })()
        : null,
    };
  }, fromEnd);
}
