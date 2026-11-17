/**
 * verify-meet-page-model.js の MeetPage の実行の道具。verify ではない。
 * 実ページ（src/pages/MeetPage.jsx）の取得 effect・状態導出・本文分岐を実行する。依存はローカルの hook/JSX
 * スタブに置換する（DOM 描画は E2E の担当）。本番への取得はしない。
 */
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

/**
 * @returns {{stored: unknown[], effects: Function[], robots: unknown, render: (service: object) => object}}
 *   stored = [取得結果の state, 失敗した節の key]・effects = 登録された effect・robots = 直近の noindex の値
 */
export function createMeetPageHarness(startDate) {
  const ui = {
    stored: [{ key: null, page: null }, null],
    effects: [],
    robots: undefined,
  };
  const pageSource = readFileSync(
    new URL("../../../src/pages/MeetPage.jsx", import.meta.url),
    "utf8",
  );
  const componentStart = pageSource.indexOf("function MeetPage() {");
  const componentEnd = pageSource.indexOf("\n  return (", componentStart);
  const component = transformSync(
    pageSource.slice(componentStart, componentEnd) +
      "\n return { body, page, failed };\n}",
    { loader: "jsx", jsxFactory: "element" },
  ).code;
  const renderPage = new Function(
    "useState",
    "useEffect",
    "useParams",
    "useTranslation",
    "useLocalizedPath",
    "getMeetPage",
    "getTodayJST",
    "normalizeTitle",
    "md",
    "useRobotsMeta",
    "element",
    "Link",
    "DataFetchError",
    "LoadingScreen",
    "MeetBody",
    "console",
    component + "\nreturn MeetPage();",
  );
  const render = (service) => {
    let slot = 0;
    ui.effects = [];
    return renderPage(
      () => {
        const i = slot++;
        return [
          ui.stored[i],
          (value) => {
            ui.stored[i] = value;
          },
        ];
      },
      (effect) => ui.effects.push(effect),
      () => ({ venueCode: "16", startDate: startDate }),
      () => ({ t: (key) => key }),
      () => (path) => path,
      // 名前つき import（getMeetPage）を同じ偽の取得へ通す（殻 supabaseDataService は RA40 で消えた）
      (...args) => service.getMeetPage(...args),
      () => "2026-09-27",
      (title) => title ?? null,
      () => "9/28",
      (value) => {
        ui.robots = value;
      },
      (type, props, ...children) => ({ type, props, children }),
      "Link",
      "DataFetchError",
      "LoadingScreen",
      "MeetBody",
      { error() {} },
    );
  };
  return Object.assign(ui, { render });
}
