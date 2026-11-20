/**
 * verify-series-points-stage-rules.js の道具（今節タブ RaceMeetTab.jsx を描いて見る）。verify ではない。
 * 今節の取得（getMeetScoreboard）と選手の履歴（getRacerScopedRaceStats）は、渡した board・履歴を返す写しに
 * 差し替える（DB には繋がない）。訳は react-i18next の既定（キーをそのまま返す）なので、描いた文はキーで見る。
 */
import { createElement } from "react";
import { renderJsx } from "../../lib/renderJsx.js";
import { quietly, registerJsxPageStubs } from "./jsx-page-stubs.js";

const ROUTER = new URL(import.meta.resolve("react-router-dom"));
const MEET_TAB = new URL("../../../src/components/race/RaceMeetTab.jsx", import.meta.url);
const HOLDER = "__seriesPointsMeetTab";

const SERVICE_STUBS = {
  "services/meetQueries2.js": `export const getMeetScoreboard = async () => globalThis.${HOLDER}.board;`,
  "services/racerQueries2.js": `export const getRacerScopedRaceStats = async () => globalThis.${HOLDER}.records;`,
};

/**
 * board（getMeetScoreboard の戻りの形）と6艇（players）で今節タブを描き、取得の後の本文を返す。
 * focusedBoat は選んでいる艇（null なら1号艇）
 */
export async function renderMeetTabText({ board, players, focusedBoat = null, records = [] }) {
  return quietly(async () => {
    const boot = await renderJsx(ROUTER, { children: null }, { exportName: "MemoryRouter" });
    // jsdom に無い物（横スクロールの目印が測り直しの枠で呼ぶ）。renderPage と同じ何もしない物で足す
    globalThis.requestAnimationFrame ??= (callback) => setTimeout(() => callback(Date.now()), 0);
    globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
    await boot.unmount();
    registerJsxPageStubs({ stubs: SERVICE_STUBS });
    globalThis[HOLDER] = { board, records };
    const RaceMeetTab = (await import(MEET_TAB.href)).default;
    const element = createElement(RaceMeetTab, {
      raceId: "2026-09-25-20-01",
      venueCode: 20,
      players,
      focusedBoat,
      onFocusBoat: () => {},
    });
    const view = await renderJsx(ROUTER, { children: element }, { exportName: "MemoryRouter" });
    // 取得（Promise）の後に描き直されるのを待つ
    await view.act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    const text = view.container.textContent;
    await view.unmount();
    delete globalThis[HOLDER];
    return text;
  });
}

/**
 * 全走欠場の選手を選んだ詳細の見出し（meetTab.absentDetail）と、「欠」の意味の注記（meetTab.finishAbsentNote）を
 * 描いた結果で見る。board は 1001（走った）・2002（全走欠場）・3003（一部欠場）・4004（未走）の節
 */
export async function meetTabAbsentScenes({ board, check }) {
  const player = (number, racerId) => ({ number, racerId, name: `選手${racerId}` });
  const shown = async (players, focusedBoat) => {
    const text = await renderMeetTabText({ board, players, focusedBoat });
    return [text.includes("meetTab.absentDetail"), text.includes("meetTab.finishAbsentNote")];
  };
  check(
    "全走欠場の選手を選んだ詳細に欠場の見出し、「欠」があれば意味の注記を出す（描いた今節タブ）",
    [
      // 全走欠場の 2002 を選ぶ → 見出しと注記
      await shown([player(1, 1001), player(2, 2002), player(3, 3003)], 2),
      // 走った 1001 を選ぶ。表に「欠」のある 3003 が居る → 注記だけ
      await shown([player(1, 1001), player(3, 3003)], 1),
      // 表に全走欠場の 2002 が居る（選んでいない） → 注記だけ
      await shown([player(1, 1001), player(2, 2002)], 1),
      // 表に「欠」の走が無い → どちらも出さない
      await shown([player(1, 1001), player(6, 4004)], 1),
    ],
    [
      [true, true],
      [false, true],
      [false, true],
      [false, false],
    ],
  );
}
