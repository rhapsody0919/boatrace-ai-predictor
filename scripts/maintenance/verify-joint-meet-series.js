// SG チャレンジカップと G2 レディースCC の併催を開催ごとの選手の組に分け、組ごとの予選の終わりを出すこと（jointMeetSeriesOf、G3 の点検 V-61）
/**
 * 本番の常滑 2026-11-24〜29 は男子34人・女子21人を1つの得点率の順位に混ぜ「準優の目安 18位」を出した。
 * 公式の得点率一覧は2表。ここでは公式の日程（2026/11/52408）と同じ形の節を作って確かめる:
 *   1〜4日目 SG の予選 2〜4・6〜8・10・12R、G2 の予選 1・5・9・11R
 *   5日目    SG の一般 2・3・6・7R・準優 10〜12R、G2 の予選 1・4・5・8・9R
 *   6日目    G2 の一般 1・5R・優勝戦 11R、SG の優勝戦 12R
 * 本番 DB には繋がない。
 *
 * 後半は節のページ（src/pages/MeetPage.jsx）を描き、getMeetPage だけを偽物に差し替えて DOM で見る（本番へ取得しない）。
 * 描く道具は i18n を読まないので画面には訳のキーが出る。キーで出し分けを見て、ja の文は common.json で見る。
 */
import assert from "node:assert/strict";
import { jointMeetSeriesOf, JOINT_FINAL_SLOTS } from "../../src/pure/jointMeetSeries.js";
import { countsForSeriesScore, splitMeetSeries } from "../../src/pure/seriesPoints.js";
import { readFileSync } from "node:fs";
import { renderPage } from "./verifyData/jsx-page-render.js";
import { quietly } from "./verifyData/jsx-page-stubs.js";

const TITLE = "第２９回チャレンジカップ／Ｇ２レディースＣＣ";
const days = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
const SG = Array.from({ length: 12 }, (_, i) => 4000 + i);
const G2 = Array.from({ length: 9 }, (_, i) => 5000 + i);
const pad = (n) => String(n).padStart(2, "0");

/** 組の中を回して6人ずつ乗せる（組の全員がつながる） */
function sixOf(pool, k) {
  return Array.from({ length: 6 }, (_, i) => pool[(k * 3 + i) % pool.length]);
}

function buildMeet({ title = TITLE, sg = SG, g2 = G2, finalDay = true, bridge = false } = {}) {
  const conditions = [];
  const racersByRace = new Map();
  let k = 0;
  const add = (day, r, stage, pool, extra = {}) => {
    const id = `${day}-08-${pad(r)}`;
    conditions.push({ race_id: id, race_stage: stage, race_title: title, is_final_day: false, ...extra });
    racersByRace.set(id, sixOf(pool, k++));
  };
  days.slice(0, 4).forEach((d) => {
    [2, 3, 4, 6, 7, 8, 10, 12].forEach((r) => add(d, r, "予選", sg));
    [1, 5, 9, 11].forEach((r) => add(d, r, "予選", g2));
  });
  [2, 3, 6, 7].forEach((r) => add(days[4], r, "一般", sg));
  [10, 11, 12].forEach((r) => add(days[4], r, "準優勝戦", sg));
  [1, 4, 5, 8, 9].forEach((r) => add(days[4], r, "予選", g2));
  if (finalDay) {
    [1, 5].forEach((r) => add(days[5], r, "一般", g2, { is_final_day: true }));
    add(days[5], 11, "優勝戦", g2, { is_final_day: true });
    add(days[5], 12, "優勝戦", sg, { is_final_day: true });
  }
  if (bridge) racersByRace.set(`${days[0]}-08-01`, [sg[0], g2[0], g2[1], g2[2], g2[3], g2[4]]);
  return { conditions, racersByRace };
}

// 1. 2つの組に分け、SG を先に返す。予選の終わりは組ごと
{
  const { conditions, racersByRace } = buildMeet();
  const s = jointMeetSeriesOf(conditions, racersByRace);
  assert.ok(s, "併催の節を分けない");
  assert.deepEqual(s.map((x) => [x.key, x.grade, x.goal, x.racerIds.size]), [
    ["cc-sg", "SG", "semifinal", 12],
    ["cc-g2", "G2", "final", 9],
  ]);
  assert.ok(SG.every((id) => s[0].racerIds.has(id)) && G2.every((id) => s[1].racerIds.has(id)));
  assert.equal(s[0].prelimEndRaceId, "2026-11-27-08-12", "SG の予選の終わりは4日目12R");
  assert.equal(s[1].prelimEndRaceId, "2026-11-28-08-09", "G2 の予選の終わりは5日目9R");
  // SG の5日目の一般戦は、SG の予選の終わりでは算入しない（節全体の終わり 5日目9R だと算入した）
  assert.equal(countsForSeriesScore("一般", "2026-11-28-08-02", s[0].prelimEndRaceId), false);
  assert.equal(countsForSeriesScore("一般", "2026-11-28-08-02", "2026-11-28-08-09"), true);
  // 組のレースは自分の組のものだけ（SG の準優の枠数を数える材料）
  assert.ok(s[0].conditions.every((c) => !["01", "05", "09", "11"].includes(c.race_id.slice(-2)) || c.race_id.startsWith(days[4])));
  assert.equal(s[1].conditions.filter((c) => c.race_stage === "準優勝戦").length, 0);
  assert.equal(JOINT_FINAL_SLOTS, 6);
  // 男女Ｗ優勝戦の分け方（今節タブ）は変わらない: 題に「Ｗ優勝戦」が無いので分けない
  assert.equal(splitMeetSeries(conditions, racersByRace), null);
}

// 2. 最終日の番組が無い間（予選中）は、人数の多い組を SG にする
{
  const { conditions, racersByRace } = buildMeet({ finalDay: false });
  const s = jointMeetSeriesOf(conditions, racersByRace);
  assert.equal(s[0].key, "cc-sg");
  assert.equal(s[0].racerIds.size, 12);
}

// 3. 最終日の12R に出た組が SG（人数が少なくても）
{
  const bigG2 = Array.from({ length: 14 }, (_, i) => 5000 + i);
  const { conditions, racersByRace } = buildMeet({ g2: bigG2 });
  const s = jointMeetSeriesOf(conditions, racersByRace);
  assert.equal(s[0].key, "cc-sg");
  assert.ok(SG.every((id) => s[0].racerIds.has(id)), "12R の組を SG にしない");
}

// 4. 分けない場面
{
  const notCc = buildMeet({ title: "第２９回チャレンジカップ" });
  assert.equal(jointMeetSeriesOf(notCc.conditions, notCc.racersByRace), null, "題に「レディース」が無いのに分けた");
  const bridged = buildMeet({ bridge: true });
  assert.equal(jointMeetSeriesOf(bridged.conditions, bridged.racersByRace), null, "男女が同じレースに乗ったのに分けた");
  const small = buildMeet({ g2: G2.slice(0, 5) });
  assert.equal(jointMeetSeriesOf(small.conditions, small.racersByRace), null, "6人未満の組で分けた");
  assert.equal(jointMeetSeriesOf([], new Map()), null);
  assert.equal(jointMeetSeriesOf(notCc.conditions, {}), null);
}

// ---- 節のページ: 2つの表、G2 は優勝戦の目安 ----
const failures = [];
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push(`${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
};

const PAGE_SG = Array.from({ length: 20 }, (_, i) => 4000 + i);
const PAGE_G2 = Array.from({ length: 9 }, (_, i) => 5000 + i);
// 得点率は 9.00 から下へ。男女を混ぜると女子が男子の間に入る（本番の守屋 8.67 が3位）
const ZEN = "０１２３４５６７８９";
const zen = (n) => String(n).replace(/\d/g, (d) => ZEN[d]);
const officialOf = (ids, top) =>
  Object.fromEntries(
    ids.map((id, i) => [id, { racer_id: id, placements: `${zen(1)}${zen(2)}`, total_points: 2 * (top - i * 0.25), penalty_points: 0 }]),
  );
const officialByRacer = { ...officialOf(PAGE_SG, 9), ...officialOf(PAGE_G2, 8.9) };
const entries = [...PAGE_SG, ...PAGE_G2].map((id) => ({ racerId: id, playerName: `選手${id}`, raceId: "2026-11-24-08-01", raceStage: "予選" }));

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
      { key: "cc-sg", grade: "SG", goal: "semifinal", racerIds: PAGE_SG, slots: 18, prelimEndRaceId: null },
      { key: "cc-g2", grade: "G2", goal: "final", racerIds: PAGE_G2, slots: 6, prelimEndRaceId: null },
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
  const ja = JSON.parse(readFileSync(new URL("../../src/locales/ja/common.json", import.meta.url), "utf8")).meetPage;
  check("ja: 表の名", [ja.joint["cc-sg"], ja.joint["cc-g2"]], ["チャレンジカップ（SG）", "レディースチャレンジカップ（G2）"]);
  check("ja: G2 の札", ja.borderFinalGoal, "優勝戦の目安 {{slots}}位 {{rate}}");
  check("ja: G2 の線", ja.borderLineFinalGoal, "ここまで優勝戦の目安（{{slots}}人）");
  check("ja: G2 の札・線に準優を出さない", /準優/.test(ja.borderFinalGoal + ja.borderLineFinalGoal + ja.borderLineFinalGoalTie), false);
  check("ja: G2 の注記は推定と断る", ja.jointFinalNote.includes("当社の推定で、公式の決まりではありません"), true);
  check("ja: 分けた理由", ja.jointNote.includes("公式の得点率一覧と同じく、開催ごとに順位を出しています"), true);
}

if (failures.length) {
  console.error(`verify-joint-meet-series（節のページ）: NG ${failures.length}件`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-joint-meet-series: OK");
