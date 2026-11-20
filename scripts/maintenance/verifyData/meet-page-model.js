/**
 * verify-meet-page-model.js の MeetPage の道具。verify ではない。
 * 実ページ（src/pages/MeetPage.jsx）を描き、取得 effect・状態導出・本文分岐を DOM で見る。
 * 取得関数（services/meetQueries3.js の getMeetPage）だけを、呼び出しを globalThis の写しへ回す物に差し替える（本番への取得はしない）。
 */
import { renderPage } from "./jsx-page-render.js";
import { quietly } from "./jsx-page-stubs.js";

const SLOT = Symbol.for("verify-meet-page-model.getMeetPage");
const DEFAULT_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

/**
 * 節ページを描く。getMeetPage は取得の偽物（() => Promise）。取得待ちの間（返り値の Promise が未決の間）の画面も見られる。
 * @returns {Promise<{ bodyKind: () => string, robotsNoindex: () => boolean, failedKey: () => string|null, settle: () => Promise<void>, unmount: () => Promise<void> }>}
 */
export async function openMeetPage(startDate, getMeetPage) {
  globalThis[SLOT] = getMeetPage;
  const view = await renderPage("pages/MeetPage.jsx", {
    path: `/venue/16/meet/${startDate}`,
    route: "/venue/:venueCode/meet/:startDate",
    head: `<meta name="robots" content="${DEFAULT_ROBOTS}">`,
    stubs: {
      "services/meetQueries3.js": `export const getMeetPage = (...args) => globalThis[Symbol.for(${JSON.stringify("verify-meet-page-model.getMeetPage")})](...args);`,
    },
  });
  const robots = view.document.head.querySelector('meta[name="robots"]');
  const q = (sel) => view.container.querySelector(sel);
  const bodyKind = () => (q(".data-fetch-error") ? "DataFetchError" : q(".meet-page__body, .meet-page__message") ? "MeetBody" : "LoadingScreen");
  return {
    /** 本文の枠の種類（取得待ち・取得失敗・取得できた本文） */
    bodyKind,
    robotsNoindex: () => robots.getAttribute("content").startsWith("noindex"),
    /** 取得失敗の画面が出ていれば、対象の節のキー（会場-開幕日） */
    failedKey: () => (q(".data-fetch-error") ? `16-${startDate}` : null),
    settle: () => quietly(() => view.settle()),
    unmount: async () => {
      await view.unmount();
      robots.remove();
    },
  };
}
