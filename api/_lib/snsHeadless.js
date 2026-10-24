/**
 * 送る前のリンク先の表示の確認の実体（sns-pdca-loop tasks 10、spec A2、ADR 0091）。
 * createDeadlinePreflight（snsDeadlineQueue.js）の headless.inspect の契約:
 *   inspect({url, context: {storageState: null}, requiredSelectors}) -> {finalUrl, visibleSelectors}
 *
 * - Chromium は開くたびに起動し、開き終わったら閉じる。@sparticuz/chromium は --single-process で動き、開いた context を閉じると
 *   ブラウザごと終わる（2026-10-17 本番で /today の後の龍神ソナーの図が4枚とも「browser has been closed」。
 *   GitHub Actions の Docker で 1〜4 GB のどれでも再現し、メモリ不足ではなかった）。1枚で落ちても次は新しいブラウザで開く。
 *   close() は互換のために残す（呼び出し側の後始末、開いたままのブラウザは無い）
 * - 毎回新しい context（Cookie・Storage なし）で開く。解析のタグ（GA4）は読み込ませない（確認のアクセスを数えないため）
 * - 印は要素が実際に見えている（visible）ものだけを返す。待つのは1つの印につき最大 waitMs
 * - 1回の実行で開くのは maxInspections 回まで（1回 最大 約45秒。関数の300秒を超えないため）。超えたら public_check_budget で止める
 * - 起動に失敗したら、同じ実行の中では起動し直さない（同じ失敗を候補の数だけ繰り返さない）
 */
import {
  lastLaunch,
  launchChromium,
} from "../../scripts/lib/launchChromium.js";

const BLOCKED = /google-analytics\.com|googletagmanager\.com|doubleclick\.net/;
// Cookie の同意の帯（src/components/CookieConsent.jsx）は、同意の記録が無いと画面の下に出て、画像の下半分を覆う（2026-10-16）。
// 読み込みの前に「拒否」を記録しておく（解析は上の BLOCKED でも止めている）。キーは src/utils/analytics.js の CONSENT_KEY
export const CONSENT_KEY = "boatai:cookie-consent";
const OVERLAYS = [".cookie-consent"];

/**
 * 要素の位置と大きさが、gapMs おいて2回続けて同じになるまで待つ（最大 tries 回）。落ち着かなければ screenshot_unstable
 */
export async function waitForStableBox(
  page,
  target,
  { tries = 15, gapMs = 200 } = {},
) {
  let previous = null;
  for (let i = 0; i < tries; i++) {
    const box = await target.boundingBox();
    if (
      box &&
      previous &&
      ["x", "y", "width", "height"].every(
        (k) => Math.abs(box[k] - previous[k]) < 0.5,
      )
    )
      return box;
    previous = box;
    await page.waitForTimeout(gapMs);
  }
  throw new Error("screenshot_unstable");
}

const sameBox = (a, b) =>
  Boolean(a && b) &&
  ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) < 0.5);

/**
 * 要素だけを撮り、撮れた画像がその要素だけかを確かめる（2026-10-24 BOA-1013）。
 * 位置が落ち着いたのを見てから撮っても、撮る途中で上の部品が広がると図が下にずれ、上の部品と図の頭が入った画像になった
 * （/today の2枚目、鳴門3R: 上に思考アシストのタブと条件のカード、下は図の見出しで切れた）。
 * - 撮った後に位置と大きさを測り直し、撮る前と違えば撮り直す
 * - edgeColorVar（CSS の変数名）を渡すと、画像の上端と下端の中央の色がその色に近いかを見る。別の部品が入ると外れる
 * 決めた回数で合わなければ screenshot_misframed（撮れなかった扱い。投稿には載せない）
 */
export async function captureElement(
  page,
  target,
  { attempts = 3, edgeColorVar = null } = {},
) {
  for (let i = 0; i < attempts; i++) {
    const box = await waitForStableBox(page, target);
    const png = await target.screenshot({ type: "png" });
    if (!sameBox(box, await target.boundingBox())) continue;
    if (
      edgeColorVar &&
      !(await target.evaluate(edgesMatch, {
        edgeCheck: Buffer.from(png).toString("base64"),
        edgeColorVar,
      }))
    )
      continue;
    return png;
  }
  throw new Error("screenshot_misframed");
}

/** ブラウザの中で動く。画像の上端・下端の近くの中央の画素が、CSS の変数の色から各成分40以内か */
export async function edgesMatch(node, { edgeCheck, edgeColorVar }) {
  const probe = document.createElement("span");
  probe.style.color = getComputedStyle(document.documentElement)
    .getPropertyValue(edgeColorVar)
    .trim();
  document.body.append(probe);
  const want = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(
    Number,
  );
  probe.remove();
  if (want.length < 3) return false;
  const img = new Image();
  img.src = `data:image/png;base64,${edgeCheck}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const near = (y) => {
    const px = ctx.getImageData(Math.floor(img.width / 2), y, 1, 1).data;
    return [0, 1, 2].every((c) => Math.abs(px[c] - want[c]) <= 40);
  };
  // 端から10px の行（3倍の画像で約3px 内側）。いちばん外の数px は角の丸みと縁の明るい線で背景の色が出る
  // （2026-10-21・10-24 の正常な図5枚で、上下とも10px の行は #0e1d31 前後、崩れた鳴門3R は #b6b9ba・#525855）
  return near(10) && near(img.height - 11);
}

export function createChromiumHeadless({
  launch = launchChromium,
  gotoTimeoutMs = 30000,
  waitMs = 15000,
  maxInspections = 6,
} = {}) {
  let launchError = null;
  let inspections = 0;
  // 未ログインの新しい context で開き、印が見えるのを待ってから after(page) を呼ぶ。開いた回数は inspect・screenshot の合計で数える
  async function open(
    { url, viewport, deviceScaleFactor, requiredSelectors },
    after,
  ) {
    if (inspections >= maxInspections) throw new Error("public_check_budget");
    inspections += 1;
    if (launchError) throw launchError;
    let browser;
    try {
      browser = await launch();
    } catch (error) {
      launchError = error;
      throw error;
    }
    try {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor,
        storageState: undefined,
      });
      await context.route(BLOCKED, (route) => route.abort());
      await context.addInitScript((key) => {
        try {
          window.localStorage.setItem(key, "rejected");
        } catch {
          // 保存できない環境でも開く（帯が出れば screenshot が止める）
        }
      }, CONSENT_KEY);
      const page = await context.newPage();
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: gotoTimeoutMs,
      });
      const visible = await Promise.all(
        requiredSelectors.map((selector) =>
          page
            .locator(selector)
            .first()
            .waitFor({ state: "visible", timeout: waitMs })
            .then(
              () => selector,
              () => null,
            ),
        ),
      );
      return {
        finalUrl: page.url(),
        visibleSelectors: visible.filter(Boolean),
        ...(after ? await after(page) : {}),
      };
    } finally {
      // context を閉じるとブラウザが終わるので、ブラウザを閉じる（context もまとめて閉じる）。落ちた後は閉じる失敗を無視する
      await browser.close().catch(() => {});
    }
  }
  return {
    async inspect({ url, context: options = {}, requiredSelectors = [] }) {
      if (options.storageState != null)
        throw new Error("未ログインの context だけで確かめます");
      return open({
        url,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        requiredSelectors,
      });
    },
    /**
     * 画面の上部を PNG で撮る（/today の X 投稿の画像、tasks 19b）。既定はスマホ幅の上部 4:5（390×488 を3倍で 1170×1464）。
     * 印が全部見えたときだけ撮る（見えないまま撮った画像を投稿しない）
     */
    /**
     * element を渡すと、その要素だけを撮る（/today の X 投稿の龍神ソナーの図、2026-10-16 ユーザー決定）。
     * label を渡すと、要素の先頭に1行の見出し（例: 会場R 締切）を差し込んでから撮る（どのレースの図か分かるように）
     */
    async screenshot({
      url,
      requiredSelectors = [],
      viewport = { width: 390, height: 488 },
      deviceScaleFactor = 3,
      element = null,
      label = null,
      edgeColorVar = null,
    }) {
      return open(
        { url, viewport, deviceScaleFactor, requiredSelectors },
        async (page) => {
          for (const selector of requiredSelectors)
            if (!(await page.locator(selector).first().isVisible()))
              throw new Error("screenshot_component_missing");
          // 画面を覆う帯が出ていれば撮らない
          for (const selector of OVERLAYS)
            if (await page.locator(selector).first().isVisible())
              throw new Error("screenshot_overlay_visible");
          // フォントの読み込みを待ってから撮る（文字が空白のまま撮らない）
          if (element) {
            const target = page.locator(element).first();
            // 図は印（requiredSelectors）より後に描かれることがある（本番の関数は手元より遅い）。印と同じだけ待つ
            await target
              .waitFor({ state: "visible", timeout: waitMs })
              .catch(() => {
                throw new Error("screenshot_component_missing");
              });
            if (label)
              await target.evaluate((node, text) => {
                const head = document.createElement("div");
                head.textContent = text;
                head.style.cssText =
                  "font-size:18px;font-weight:700;color:#fff;padding:12px 16px 0;letter-spacing:0.02em";
                node.prepend(head);
              }, label);
            await target.scrollIntoViewIfNeeded();
            await page.evaluate(() => document.fonts.ready);
            // 位置と大きさが落ち着いてから撮る。後から読み込まれる部品で表示がずれると、上に背景の帯が入り、
            // 下が切れた図になる（2026-10-19 の /today の4枚目、桐生6R）。撮る途中のずれ・別の部品の混入は captureElement が落とす
            return {
              png: await captureElement(page, target, { edgeColorVar }),
            };
          }
          await page.evaluate(() => document.fonts.ready);
          return { png: await page.screenshot({ type: "png" }) };
        },
      );
    },
    async close() {},
    /** 直近の起動の様子（起動の前に止めた残りの Chromium の数・/tmp から消した残りの数・空きメモリ・/tmp の空き）。/today の失敗の理由に添える（2026-10-18） */
    launchInfo() {
      return `残り${lastLaunch.reaped}・掃除${lastLaunch.cleaned}・空き${lastLaunch.freeMb ?? "?"}MB・/tmp空き${lastLaunch.tmpFreeMb ?? "?"}MB`;
    },
  };
}
