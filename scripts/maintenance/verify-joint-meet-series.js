// SG チャレンジカップと G2 レディースCC の併催を開催ごとの選手の組に分け、組ごとの予選の終わりを出すこと（jointMeetSeriesOf、G3 の点検 V-61）
/**
 * 本番の常滑 2026-11-24〜29 は男子34人・女子21人を1つの得点率の順位に混ぜ「準優の目安 18位」を出した。
 * 公式の得点率一覧は2表。ここでは公式の日程（2026/11/52408）と同じ形の節を作って確かめる:
 *   1〜4日目 SG の予選 2〜4・6〜8・10・12R、G2 の予選 1・5・9・11R
 *   5日目    SG の一般 2・3・6・7R・準優 10〜12R、G2 の予選 1・4・5・8・9R
 *   6日目    G2 の一般 1・5R・優勝戦 11R、SG の優勝戦 12R
 * 本番 DB には繋がない。
 */
import assert from "node:assert/strict";
import { jointMeetSeriesOf, JOINT_FINAL_SLOTS } from "../../src/pure/jointMeetSeries.js";
import { countsForSeriesScore, splitMeetSeries } from "../../src/pure/seriesPoints.js";

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

console.log("verify-joint-meet-series: OK");
