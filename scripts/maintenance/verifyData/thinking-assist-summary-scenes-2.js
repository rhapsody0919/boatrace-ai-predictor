/**
 * verify-thinking-assist-summary.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-summary.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { factsScopeLabel, b1Usual, axisWhyKinds, factChips } from "../../../src/utils/assistSummary.js";
import { theoryCard, guideSteps } from "../../../src/utils/assistTheory.js";
import { trueWindDirection, windRelation } from "../../../src/utils/windDirection.js";
import { ASSIST_COPY, GLOSSARY } from "../../../src/data/thinkingAssistCopy.js";
import { cWpre, cWpost, tctx } from "./thinking-assist-summary-scenes-1.js";

let today, check, s1, hs, conclusion;
let windTok, cWrel, cT1weak, cT6, cT7, theoryTexts, bannedHits, steps;

// 用語の辞書・カードの文に禁止語が無い（D-41・D-42・N-7）
const BANNED = /数え|集計|算出|対象|似た|似てい|ふつう|いつも|競艇|鉄板|大本線/;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const u2 = b1Usual(s1, 1, 2);
  const u3 = b1Usual(s1, 1, 3);
  check(
    "着順: 1号艇の2着以内 83/119・3着以内 94/119（v16 facts の top2・top3、承認モック v2 の値）",
    u2?.k === 83 && u2?.n === 119 && u3?.k === 94 && u3?.n === 119,
    JSON.stringify({ u2, u3 }),
  );
  const at = (target) =>
    factChips({
      scope: s1,
      today,
      boat: 1,
      post: false,
      finalRound: true,
      target,
    });
  const pick = (chips) =>
    Object.fromEntries(chips.filter((c) => c.hit).map((c) => [c.key, c.pair]));
  const w1 = pick(at(1));
  const w2 = pick(at(2));
  const w3 = pick(at(3));
  check(
    "着順: ▲の付く材料は着順で変わらない（今日の6艇の中の位置で決まる）",
    JSON.stringify(Object.keys(w1).sort()) ===
      JSON.stringify(Object.keys(w2).sort()) &&
      JSON.stringify(Object.keys(w2).sort()) ===
        JSON.stringify(Object.keys(w3).sort()),
    JSON.stringify({ w1, w2, w3 }),
  );
  check(
    "着順: 割合は選んだ着順の値（平均ST 13/22→17/22→18/22、モーター2連率 15/26→20/26→22/26）",
    JSON.stringify(w1.st_mean30) === "[13,22]" &&
      JSON.stringify(w2.st_mean30) === "[17,22]" &&
      JSON.stringify(w3.st_mean30) === "[18,22]" &&
      JSON.stringify(w1.motor_2) === "[15,26]" &&
      JSON.stringify(w2.motor_2) === "[20,26]" &&
      JSON.stringify(w3.motor_2) === "[22,26]",
    JSON.stringify({ w1, w2, w3 }),
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2() {
  check(
    "着順の言葉: 札・入口1行・見出し・問い・セオリーカードが選んだ着順を書く",
    ASSIST_COPY.factHit("早い", 77, 22, "69.7", 2) ===
      "▲6艇で一番早いとき 2着以内 77%・22件（全体 69.7%）" &&
      ASSIST_COPY.factHit("早い", 59, 22, "54.6") ===
        "▲6艇で一番早いとき 1着 59%・22件（全体 54.6%）" &&
      ASSIST_COPY.factsEntry(1, 3, 2) ===
        "1号艇の差がつく材料 ▲3件（2着以内）" &&
      ASSIST_COPY.factsEntry(1, 3) === "1号艇の差がつく材料 ▲3件" &&
      ASSIST_COPY.axisHeading(1, 3) === "1号艇が3着以内に来たのは" &&
      ASSIST_COPY.axisHeading(1) === "1号艇が1着になったのは" &&
      ASSIST_COPY.theoryFactLikely(1, 2) === "1号艇の2着以内の割合が変わる",
  );
  check(
    "着順: 件数が違う理由は、2着以内・3着以内で会場の返還の項目を外し、空なら折りたたみを出さない（/code-review の指摘）",
    JSON.stringify(
      axisWhyKinds({
        kind: "NC",
        fellBack: false,
        venue: "徳山",
        win: false,
        venueRefund: true,
      }),
    ) === "[]" &&
      JSON.stringify(
        axisWhyKinds({
          kind: "NC",
          fellBack: false,
          venue: "徳山",
          win: true,
          venueRefund: true,
        }),
      ) === '["venueRefund"]' &&
      JSON.stringify(
        axisWhyKinds({
          kind: "NCR",
          fellBack: true,
          venue: "徳山",
          win: false,
          venueRefund: true,
        }),
      ) === '["fellBack"]',
  );
}

function scene3() {
  check(
    "TC-W1 展示前は「風は展示の後に分かる」で数値を出さない。展示後は風速4〜5m 4,040件・1号艇 2,352件、TC-T1・T2 を並べる",
    cWpre.today.state === "pending" &&
      cWpre.meas === null &&
      cWpost.meas.scope === "徳山・風速4〜5m 4,040件" &&
      Math.abs(cWpost.meas.table[0].p - (2352 / 4040) * 100) < 1e-9 &&
      cWpost.also.map((c) => c.id).join() === "TC-T1,TC-T2",
    JSON.stringify(cWpost.meas?.scope),
  );
  // 今日の追い風・向かい風（BOA-809）。徳山10R は DB「北西」4m（本当の方位は北）、ホームに対して向かい風
  windTok = {
    speed: 4,
    dir: trueWindDirection("北西", 18),
    rel: windRelation("北西", 18, 4),
    wave: 4,
  };
  cWrel = theoryCard("TC-W1", { ...tctx, post: true, wind: windTok });
  check(
    "TC-W1 の今日の行に本当の方位と向き（今日は北4m・向かい風）。向かい風のカードだけ当てはまる",
    cWrel.today.text === "今日は北4m・向かい風" &&
      cWrel.also[0].today.state === "hit" &&
      cWrel.also[0].today.text === "今日は向かい風4m" &&
      cWrel.also[1].today.state === "miss" &&
      cWrel.meas.notes[0] === "表は追い風・向かい風が混ざった値",
    JSON.stringify([cWrel.today, cWrel.also.map((c) => c.today)]),
  );
}

function scene4() {
  check(
    "向きの区分: アイコンの「東」（右向き＝1マークへ）は追い風、「西」は向かい風、「北」は横風。1m以下・会場不明は出さない",
    windRelation("東", 1, 3) === "tail" &&
      windRelation("南東", 24, 3) === "tail" &&
      windRelation("西", 1, 3) === "head" &&
      windRelation("北西", 18, 3) === "head" &&
      windRelation("北", 5, 3) === "cross" &&
      windRelation("東", 1, 1) === null &&
      windRelation("東", 99, 3) === null &&
      windRelation("無風", 1, 0) === null,
  );
  cT1weak = theoryCard("TC-T1", {
    ...tctx,
    post: true,
    wind: { ...windTok, speed: 3, rel: windRelation("北西", 18, 3) },
  });
  check(
    "向かい風でも4m未満なら「向かい風が強い」は当てはまらない",
    cT1weak.today.state === "miss" && cT1weak.today.text === "今日は向かい風3m",
  );
  cT6 = theoryCard("TC-T6", tctx);
  check(
    "文だけのカード（TC-T6 部品交換）は過去レースの傾向を出さない（準備中）",
    cT6.meas === null,
  );
  cT7 = theoryCard("TC-T7", tctx);
  check(
    "TC-T7 スジは、今日の手がかりの形（2コース凹み161件）のよく出た3連単を関連の実データとして添える",
    cT7.related?.includes("161件") && cT7.related.includes("1-3-4（9件）"),
    cT7.related,
  );
  // 同じ呼び名で件数が違う札（BOA-809）: 艇ごとの範囲に艇番と級、展開の2つに理由
  check(
    "範囲の札: 艇を渡すと「（{n}号艇が{級}）」、渡さなければ今の呼び名",
    factsScopeLabel({ kind: "NCR", round: "junyu" }, "徳山", 3, "A1") ===
      "全国・級の並びが同じ準優勝戦（3号艇がA1）" &&
      factsScopeLabel({ kind: "VC" }, "徳山") === "徳山・級の並びが同じ",
    factsScopeLabel({ kind: "NCR", round: "junyu" }, "徳山", 3, "A1"),
  );
  check(
    "展開の札: 件数の後ろに違う理由",
    ASSIST_COPY.scopeChipWhy(
      "全国・級の並びが同じ（予選も含む）",
      2457,
      ASSIST_COPY.scopeWhy.hint,
    ) === "全国・級の並びが同じ（予選も含む） 2,457件・平均STがそろったレース",
  );
  // 今節の平均着順点の一言（BOA-804）: 何を平均したか。優勝戦の日は準優勝戦の着順も入る
  check(
    "今節の平均着順点の一言: 予選の日と優勝戦の日",
    ASSIST_COPY.seriesAvgNote(7, 60, false) ===
      "前日までの今節 7走の平均（60点÷7走。F・失格は0点）" &&
      ASSIST_COPY.seriesAvgNote(8, 64, true).endsWith("。準優勝戦の着順も入る"),
  );
  theoryTexts = [
    "TC-S:flat",
    "TC-S:wall",
    "TC-S:d2",
    "TC-S:d3",
    "TC-S:kado",
    "TC-S:d1",
    "TC-S:dash",
    "TC-H:d2_slow01",
    "TC-E:waku",
    "TC-E:mae",
    "TC-E:inlost",
    "TC-F:1:motor_2",
    "TC-V1",
    "TC-T1",
    "TC-T2",
    "TC-T3",
    "TC-T4",
    "TC-T5",
    "TC-T6",
    "TC-T7",
    "TC-T8",
    "TC-T9",
    "TC-T10",
    "TC-X1",
  ].map((id) => JSON.stringify(theoryCard(id, { ...tctx, post: true })));
}

function scene5() {
  bannedHits = [
    JSON.stringify(GLOSSARY),
    JSON.stringify(cWpost),
    JSON.stringify(cWrel),
    conclusion,
    ASSIST_COPY.simTopNote(63, "13:14"),
    ASSIST_COPY.entryNoPast,
    ASSIST_COPY.seriesAvgNote(8, 64, true),
    JSON.stringify(ASSIST_COPY.scopeWhy),
    ASSIST_COPY.flowCourseNote,
    ASSIST_COPY.stNoData,
    ASSIST_COPY.stCourseChip(".148", 30, false),
    ASSIST_COPY.stCourseChip(".147", 3, true),
    ...theoryTexts,
  ]
    .map((t) => t.match(BANNED)?.[0])
    .filter(Boolean);
  check(
    "セオリーカード・用語の文に禁止語が無い",
    bannedHits.length === 0,
    bannedHits.join(","),
  );
  steps = guideSteps({ post: false, rough: null, hintTop: hs.top });
  check(
    "ガイドは6段（軸・軸・展開・機力・相手・買い目。spec D-46）、各段の1文は40字以内、展示前の④は展示の値を出さない",
    steps.map((x) => x.lens).join() === "axis,axis,flow,power,place,bet" &&
      ASSIST_COPY.guideStep(5, steps.length, steps[4].step) ===
        "ガイド 5/6 ⑤相手" &&
      steps.every((x) => x.sub.length <= 40 && x.q.length <= 40) &&
      !steps[3].sub.includes("金枠"),
    JSON.stringify(steps.map((x) => x.sub)),
  );
  // 札の言い方: 形容詞に「の」を挟まない（「一番高いのとき」ではなく「一番高いとき」。2026-10-11 ユーザー指摘）
  {
    const words = Object.values(ASSIST_COPY.factWords);
    const texts = [
      ...words.map((w) => ASSIST_COPY.factHit(w, 77, 1793, 72)),
      ASSIST_COPY.motorChipRate(true, 60, 55),
      ASSIST_COPY.motorChipRate(false, 40, 55),
    ];
    check(
      "札: 「6艇で一番高いとき 1着」の形（「〜いのとき」にしない。誰の中で一番かを書く）",
      texts.every((t) => !/いのとき/.test(t)) &&
        texts[0] === "▲6艇で一番高いとき 1着 77%・1,793件（全体 72%）" &&
        texts.at(-2).startsWith("一番高いとき 1着") &&
        texts.at(-1).startsWith("一番低いとき 1着"),
      JSON.stringify(texts),
    );
  }
  {
    scene1();
    scene2();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（today・check・s1・hs・conclusion） */
export function runThinkingAssistSummaryScenes2(env) {
  ({ today, check, s1, hs, conclusion } = env);
  scene3();
  scene4();
  scene5();
}
