// 節のページが SG と G2 の併催を開催ごとの2つの表に分け、G2 には準優でなく優勝戦の目安の線を出すこと（G3 の点検 V-61）
/**
 * 本番の常滑 2026-11-24〜29 は男子34人・女子21人を1つの表に混ぜ「準優の目安 18位」を出した。
 * 実ページ（src/pages/MeetPage.jsx）を描き、getMeetPage だけを偽物に差し替えて DOM で見る（本番へ取得しない）。
 * 得点率は公式の得点率一覧の行（officialByRacer）で与える（節ページが予選中も使う値）。
 * 描く道具は i18n を読まないので画面には訳のキーが出る。キーで出し分けを見て、ja の文は common.json で見る。
 * 開催ごとの組の分け方（jointMeetSeriesOf）は verify-joint-meet-series.js が見る。
 */
import jaCommon from "../../src/locales/ja/common.json" with { type: "json" };
import { renderPage } from "./verifyData/jsx-page-render.js";
import { quietly } from "./verifyData/jsx-page-stubs.js";
const failures = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(`${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
};

const SG = Array.from({ length: 20 }, (_, i) => 4000 + i);
const G2 = Array.from({ length: 9 }, (_, i) => 5000 + i);
// 得点率は 9.00 から下へ。男女を混ぜると女子が男子の間に入る（本番の守屋 8.67 が3位）
const ZEN = "０１２３４５６７８９";
const zen = (n) => String(n).replace(/\d/g, (d) => ZEN[d]);
const officialOf = (ids, top) =>
  Object.fromEntries(
    ids.map((id, i) => [id, { racer_id: id, placements: `${zen(1)}${zen(2)}`, total_points: 2 * (top - i * 0.25), penalty_points: 0 }]),
  );
const officialByRacer = { ...officialOf(SG, 9), ...officialOf(G2, 8.9) };
const entries = [...SG, ...G2].map((id) => ({ racerId: id, playerName: `選手${id}`, raceId: "2026-11-24-08-01", raceStage: "予選" }));

const pageOf = (seriesBoards) => ({
  state: "prelim",
  venueCode: 8,
  startDate: "2026-11-24",
  endDate: "2026-11-29",
  title: "第２９回チャレンジカップ／Ｇ２レディースＣＣ",
  grade: "SG",
  meetDays: ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"],
  knownMeet: true,
  seriesDayToday: 3,
  officialAsOfDay: 2,
  officialAsOfIsToday: false,
  qualifiers: null,
  board: {
    meetStart: "2026-11-24",
    entries,
    officialByRacer,
    semifinalSlots: 18,
    notYetStartedRacerIds: [],
    seriesBoards,
  },
});

const SLOT = Symbol.for("verify-meet-page-joint-series.getMeetPage");
async function open(page) {
  globalThis[SLOT] = () => Promise.resolve(page);
  const view = await renderPage("pages/MeetPage.jsx", {
    path: "/venue/8/meet/2026-11-24",
    route: "/venue/:venueCode/meet/:startDate",
    stubs: {
      "services/meetQueries3.js": `export const getMeetPage = (...args) => globalThis[Symbol.for("verify-meet-page-joint-series.getMeetPage")](...args);`,
    },
  });
  await quietly(() => view.settle());
  const sections = [...view.container.querySelectorAll("section.meet-ranking")].map((s) => ({
    head: s.querySelector(".meet-ranking__head h2, .meet-ranking__head h3")?.textContent ?? null,
    headTag: s.querySelector(".meet-ranking__head h2, .meet-ranking__head h3")?.tagName ?? null,
    labelledBy: s.getAttribute("aria-labelledby"),
    rows: s.querySelectorAll("tr.meet-ranking__row").length,
    ranks: [...s.querySelectorAll("tr.meet-ranking__row .meet-ranking__c-rank")].map((td) => td.textContent),
    chip: s.querySelector(".meet-ranking__border")?.textContent ?? null,
    line: s.querySelector("tr.meet-ranking__line")?.textContent ?? null,
    subs: [...s.querySelectorAll(".meet-ranking__sub")].map((p) => p.textContent).join("\n"),
  }));
  const jointTitle = view.container.querySelector(".meet-page__main > .meet-ranking__head h2")?.textContent ?? null;
  const text = view.container.textContent;
  await view.unmount();
  return { sections, jointTitle, text };
}

// 1. 併催: 2つの表。順位は表ごとに1から、線は SG が準優・G2 が優勝戦の目安
{
  const { sections, jointTitle, text } = await open(
    pageOf([
      { key: "cc-sg", grade: "SG", goal: "semifinal", racerIds: SG, slots: 18, prelimEndRaceId: null },
      { key: "cc-g2", grade: "G2", goal: "final", racerIds: G2, slots: 6, prelimEndRaceId: null },
    ]),
  );
  check("表の数", sections.length, 2);
  check("ページの見出しは1回", jointTitle, "meetPage.rankingTitle");
  check("分けた理由の注記", text.includes("meetPage.jointNote"), true);
  const [sg, g2] = sections;
  check("SG の表の名", [sg?.headTag, sg?.head], ["H2", "meetPage.joint.cc-sg"]);
  check("G2 の表の名", [g2?.headTag, g2?.head], ["H2", "meetPage.joint.cc-g2"]);
  check("見出しの id が重ならない", sg?.labelledBy !== g2?.labelledBy && Boolean(sg?.labelledBy), true);
  check("SG の人数（女子を混ぜない）", sg?.rows, 20);
  check("G2 の人数", g2?.rows, 9);
  check("G2 の順位は1から", g2?.ranks.slice(0, 3), ["1", "2", "3"]);
  check("SG の札", sg?.chip, "meetPage.borderPrelim");
  check("SG の線", sg?.line, "meetPage.borderLinePrelim");
  check("G2 の札は優勝戦の目安", g2?.chip, "meetPage.borderFinalGoal");
  check("G2 の線", g2?.line, "meetPage.borderLineFinalGoal");
  
  check("G2 の注記", g2?.subs.includes("meetPage.jointFinalNote"), true);
  check("SG に G2 の注記を出さない", sg?.subs.includes("meetPage.jointFinalNote"), false);
}

// 2. 併催でない節（seriesBoards が null）は今までどおり1表・h2・準優の目安
{
  const { sections, jointTitle } = await open(pageOf(null));
  check("併催でない: 表は1つ", sections.length, 1);
  check("併催でない: ページの見出しを足さない", jointTitle, null);
  check("併催でない: 表の見出しは h2", [sections[0]?.headTag, sections[0]?.head], ["H2", "meetPage.rankingTitle"]);
  check("併催でない: 全員を1表", sections[0]?.rows, 29);
  check("併催でない: 札は準優の目安", sections[0]?.chip, "meetPage.borderPrelim");
}

// 3. ja の文: G2 の札・線に「準優」を出さず、注記は推定と断る
{
  const ja = jaCommon.meetPage;
  check("ja: 表の名", [ja.joint["cc-sg"], ja.joint["cc-g2"]], ["チャレンジカップ（SG）", "レディースチャレンジカップ（G2）"]);
  check("ja: G2 の札", ja.borderFinalGoal, "優勝戦の目安 {{slots}}位 {{rate}}");
  check("ja: G2 の線", ja.borderLineFinalGoal, "ここまで優勝戦の目安（{{slots}}人）");
  check("ja: G2 の札・線に準優を出さない", /準優/.test(ja.borderFinalGoal + ja.borderLineFinalGoal + ja.borderLineFinalGoalTie), false);
  check("ja: G2 の注記は推定と断る", ja.jointFinalNote.includes("当社の推定で、公式の決まりではありません"), true);
  check("ja: 分けた理由", ja.jointNote.includes("公式の得点率一覧と同じく、開催ごとに順位を出しています"), true);
}

if (failures.length) {
  console.error(`verify-meet-joint-boards: NG ${failures.length}件`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-meet-joint-boards: OK");
