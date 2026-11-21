/**
 * verify-sns-today-thinking.js の後半の場面（2/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-thinking.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  todayTargetReason,
  imageNamesOf,
  thinkingGradeDayVenue,
  isThinkingGradeDayRace,
  checkTodayThinkingImage,
  checkTodayThinkingReply,
  THINKING_URL_REASON,
  resultLine,
  checkFinalsImage,
} from "../../sns/push-finals-image.js";
import { todayPicksOf } from "../../sns/today-picks.js";

let db,
  first,
  riskRules,
  RACE,
  OTHER_RACE,
  DAY,
  CLEAR_SQL,
  TODAY_DRAFT,
  sttState,
  stageCalls,
  bundle,
  replyBundle,
  push,
  claim,
  counts,
  NOTHING;

/** test("グレードの日（hq の a2、オーナー 2026-10-31・11-02 の (a)）: /today の対象の外でも、その日の の中身を割った 1/2 */
async function sttB1() {
  // /today の X 投稿の対象は別の場（05）の 1R だけ（場 12 のレースは対象の外）
  const offPicks = () =>
    todayPicksOf(DAY, {
      ...TODAY_DRAFT,
      source_data: {
        digest: { date: DAY, picks: [{ race_id: "2037-10-26-05-01" }] },
      },
    });
  // 場 12 の 11R（race_id とレース番号をそろえる）・9R（OTHER_RACE）・12R と、別の場（05）の 12R を置く
  const R11 = "2037-10-26-12-11";
  const OWN_12 = "2037-10-26-12-12";
  const OTHER_12 = "2037-10-26-05-12";
  const setDay = async ({ own, other, ownAt = "20:40", otherAt = "20:30" }) => {
    await db.query("DELETE FROM races WHERE race_id = ANY($1)", [
      [R11, OWN_12, OTHER_12],
    ]);
    await db.query(
      "INSERT INTO races VALUES($1,$4,'16:30:00',NULL,$6,11),($2,$4,$5,NULL,$6,12),($3,$4,$7,NULL,$8,12)",
      [R11, OWN_12, OTHER_12, DAY, `${ownAt}:00`, own, `${otherAt}:00`, other],
    );
    await db.query(
      "UPDATE races SET race_grade=$2, race_number=9 WHERE race_id=$1",
      [OTHER_RACE, own],
    );
  };
  const push11 = () =>
    push(bundle({ race_id: R11, images: imageNamesOf(R11) }));
  sttState.picks = offPicks();
  // 一般戦だけの日: 11R でも対象の外ははじく（何も書かない）
  await setDay({ own: "ippan", other: "ippan" });
  let out = await push11();
  assert.match(
    out.reasons.join(),
    /\/today の X 投稿の対象でない（2037-10-26-12-11）/,
  );
  assert.match(out.reasons.join(), /SG・PG1・G1 の場が無い/);
  assert.deepEqual(await counts(), NOTHING);
  // SG と G1 が同じ日: G1 の場の 11R ははじく
  await setDay({ own: "G1", other: "SG" });
  out = await push11();
  assert.match(out.reasons.join(), /格の最上位の場（2037-10-26-05）/);
  assert.deepEqual(await counts(), NOTHING);
  // G1 が2場: 12R の締切が早い方の場ははじく
  await setDay({ own: "G1", other: "G1", ownAt: "20:30", otherAt: "20:45" });
  out = await push11();
  assert.match(out.reasons.join(), /格の最上位の場（2037-10-26-05）/);
  assert.deepEqual(await counts(), NOTHING);
  // SG の場の 9R ははじく
  await setDay({ own: "SG", other: "G1" });
  out = await push(
    bundle({
      race_id: OTHER_RACE,
      deadline: "16:58",
      images: imageNamesOf(OTHER_RACE),
    }),
  );
  assert.match(out.reasons.join(), /10〜12R でもない/);
  assert.match(out.reasons.join(), /race_number=9/);
  assert.deepEqual(await counts(), NOTHING);
  // /today が posted でない・無い日は SG の 11R でもはじく
  sttState.picks = todayPicksOf(
    DAY,
    { ...TODAY_DRAFT, status: "approved" },
    [],
  );
  assert.match((await push11()).reasons.join(), /まだ送られていない/);
  sttState.picks = todayPicksOf(DAY, null);
  assert.match(
    (await push11()).reasons.join(),
    /その日の \/today の X 投稿が無い/,
  );
  assert.deepEqual(await counts(), NOTHING);
  // SG の場の 11R は受ける（/today の対象の外でも）
  sttState.picks = offPicks();
  out = await push11();
  assert.equal(out.reasons, undefined, JSON.stringify(out));
  assert.ok(out.job_id && out.poll_job_id);

  // 純粋関数: 受ける場
  const r12 = (venue, race_grade, start_time, cancellation_status = null) => ({
    race_id: `2037-10-26-${venue}-12`,
    race_grade,
    start_time: `${start_time}:00`,
    cancellation_status,
  });
  return { r12 };
}

/** test("グレードの日（hq の a2、オーナー 2026-10-31・11-02 の (a)）: /today の対象の外でも、その日の の中身を割った 2/2 */
function sttB2({ r12 }) {
  for (const [twelves, venue] of [
    [[r12("12", "SG", "20:40"), r12("05", "G1", "20:45")], "2037-10-26-12"],
    [[r12("12", "G1", "20:40"), r12("05", "PG1", "20:30")], "2037-10-26-05"],
    [[r12("12", "g1", "20:40"), r12("05", "G1", "20:45")], "2037-10-26-05"],
    [[r12("12", "G1", "20:50"), r12("05", "G1", "20:45")], "2037-10-26-12"],
    // 中止は見ない（日中に中止が入っても場が入れ替わらない）
    [
      [r12("12", "SG", "20:40", "confirmed"), r12("05", "G1", "20:45")],
      "2037-10-26-12",
    ],
    // 格も締切も同じなら race_id の小さい方（行の順に依らない）
    [[r12("12", "G1", "20:40"), r12("05", "G1", "20:40")], "2037-10-26-05"],
    [[r12("05", "G1", "20:40"), r12("12", "G1", "20:40")], "2037-10-26-05"],
    [[r12("12", "G2", "20:40"), r12("05", "ippan", "20:45")], null],
    [[r12("12", null, "20:40")], null],
    [[], null],
  ])
    assert.equal(
      thinkingGradeDayVenue(twelves),
      venue,
      JSON.stringify(twelves),
    );
  // 純粋関数: 受ける場の 10〜12R だけ
  const day = [r12("12", "SG", "20:40"), r12("05", "G1", "20:45")];
  const posted = { draft_id: "d", status: "posted", featured: null, list: [] };
  for (const [race_id, race_number, ok] of [
    ["2037-10-26-12-10", 10, true],
    ["2037-10-26-12-12", 12, true],
    ["2037-10-26-12-09", 9, false],
    ["2037-10-26-12-12", null, false],
    ["2037-10-26-05-11", 11, false],
  ]) {
    const race = { race_id, race_grade: "SG", race_number };
    assert.equal(isThinkingGradeDayRace(race, day), ok, race_id);
    assert.equal(todayTargetReason(posted, race_id, race, day) === null, ok);
    // posted でなければ、受ける場でも通さない
    assert.match(
      todayTargetReason({ ...posted, status: "approved" }, race_id, race, day),
      /まだ送られていない/,
    );
  }
  // 別のレースの行・行が無いときは通さず、行が無いと書く（race_id の取り違えを防ぐ）
  for (const race of [
    { race_id: "2037-10-26-12-11", race_grade: "SG", race_number: 11 },
    null,
  ])
    assert.match(
      todayTargetReason(posted, "2037-10-26-12-10", race, day),
      /races の行が無くグレードを確かめられない/,
    );
}

function stt2Scene1() {
  test("/today の X 投稿の対象でないレース・その日の /today の投稿が無いときは受け取らない（何も書かない）", async () => {
    sttState.picks = todayPicksOf(DAY, {
      ...TODAY_DRAFT,
      source_data: { digest: { date: DAY, picks: [{ race_id: OTHER_RACE }] } },
    });
    const out = await push();
    assert.match(
      out.reasons.join(),
      /\/today の X 投稿の対象でない（2037-10-26-12-08）/,
    );
    assert.deepEqual(await counts(), NOTHING);
    assert.match(out.notes[0], /検査で拒否/);
    sttState.picks = todayPicksOf(DAY, null);
    assert.match(
      (await push()).reasons.join(),
      /その日の \/today の X 投稿が無い/,
    );
    assert.deepEqual(await counts(), NOTHING);
    // 純粋関数: 注目レース（featured）か一覧（list）にあれば通る
    assert.equal(
      todayTargetReason(
        {
          draft_id: "d",
          status: "posted",
          featured: { race_id: RACE },
          list: [],
        },
        RACE,
      ),
      null,
    );
    assert.equal(
      todayTargetReason(
        {
          draft_id: "d",
          status: "posted",
          featured: null,
          list: [{ race_id: RACE }],
        },
        RACE,
      ),
      null,
    );
    // 送られていない（held・pending_review のまま）/today の投稿の候補には出さない（審査 P2）
    for (const status of ["approved", "pending_review", null])
      assert.match(
        todayTargetReason(
          { draft_id: "d", status, featured: { race_id: RACE }, list: [] },
          RACE,
        ),
        /まだ送られていない/,
      );
    sttState.picks = todayPicksOf(
      DAY,
      { ...TODAY_DRAFT, status: "approved" },
      [],
    );
    assert.match((await push()).reasons.join(), /まだ送られていない/);
    assert.deepEqual(await counts(), NOTHING);
  });
  test("グレードの日（hq の a2、オーナー 2026-10-31・11-02 の (a)）: /today の対象の外でも、その日の格の最上位の場の 10〜12R だけ受ける。同じ格が2場なら 12R の締切が遅い方", async () => {
    const { r12 } = await sttB1();
    sttB2({ r12 });
  });
  test("優勝戦の段を見ない: race_conditions が無くても・準優勝戦でも通る。優勝戦の束は今までどおり段を見る", async () => {
    await db.exec("DELETE FROM race_conditions");
    assert.ok((await push()).job_id);
    assert.deepEqual(stageCalls, []);
    await db.exec(CLEAR_SQL);
    await db.query("INSERT INTO races VALUES($1,$2,'16:30:00',NULL)", [
      RACE,
      DAY,
    ]);
    await db.query("INSERT INTO race_conditions VALUES($1,'準優勝戦')", [RACE]);
    const finals = await push(bundle({ format: "finals_image" }));
    assert.match(finals.reasons.join(), /優勝戦でない（race_stage=準優勝戦）/);
    assert.equal(finals.kind, "finals_image");
    assert.deepEqual(stageCalls, [RACE]);
  });
}

function stt2Scene2() {
  test("本文に URL を付けない: today_thinking の3本は URL が1つでもあれば拒否。優勝戦の束はこのレースのページ1つなら今までどおり通る", async () => {
    const url = `https://www.boat-ai.jp/race/${RACE}?tab=sonar`;
    assert.deepEqual(checkTodayThinkingImage(bundle(), riskRules), []);
    assert.deepEqual(checkTodayThinkingReply(replyBundle(), riskRules), []);
    for (const b of [
      checkTodayThinkingImage(bundle({ x_text: `若松8R\n${url}` }), riskRules),
      checkTodayThinkingImage(bundle({ poll_text: `投票 ${url}` }), riskRules),
      checkTodayThinkingImage(
        bundle({ x_text: "詳しくは boat-ai.jp で" }),
        riskRules,
      ),
      checkTodayThinkingReply(
        replyBundle({ x_text: `展示後 ${url}` }),
        riskRules,
      ),
    ])
      assert.ok(
        b.some((r) => r.startsWith(THINKING_URL_REASON)),
        b.join(),
      );
    const out = await push(bundle({ x_text: `若松8R\n${url}` }));
    assert.match(out.reasons.join(), /today_thinking の本文に URL がある/);
    assert.equal(resultLine(RACE, out).code, 1);
    assert.deepEqual(await counts(), NOTHING);
    // 優勝戦: このレースのページ1つは通り、別のページ・2つは今までどおり拒否
    const finals = (patch) =>
      checkFinalsImage({ ...bundle(patch), format: "finals_image" }, riskRules);
    assert.deepEqual(finals({ x_text: `若松8R 優勝戦\n${url}` }), []);
    assert.match(
      finals({
        x_text: `若松8R\nhttps://www.boat-ai.jp/race/${OTHER_RACE}`,
      }).join(),
      /リンクがこのレースのページ1つでない/,
    );
  });
  test("許可が off: push は何も書かず disabled（exit 3、理由は today_thinking_enabled）。claim でも held（today_thinking_disabled）", async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
    );
    const off = await push();
    assert.equal(off.disabled, true);
    assert.deepEqual(await counts(), NOTHING);
    assert.deepEqual(off.notes, []);
    const line = resultLine(RACE, off);
    assert.equal(line.code, 3);
    assert.match(line.text, /today_thinking_enabled/);
    assert.match(line.text, /"kind":"today_thinking"/);
    // 承認の後に off にすると claim で held
    await db.exec(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=(channel='x')",
    );
    const on = await push();
    await db.exec(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
    );
    const r = await claim(on.job_id);
    assert.deepEqual(
      [r.state, r.error_code],
      ["held", "today_thinking_disabled"],
    );
    // 優勝戦の許可は今のまま（today_thinking の旗に引きずられない）
    assert.equal(
      (
        await first(
          "SELECT finals_image_enabled f FROM sns_auto_send_control WHERE channel='x'",
        )
      ).f,
      true,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・riskRules・RACE・OTHER_RACE・DAY・CLEAR_SQL・TODAY_DRAFT・sttState・stageCalls・bundle・replyBundle・push・claim・counts・NOTHING） */
export function runSnsTodayThinkingScenes2(env) {
  ({
    db,
    first,
    riskRules,
    RACE,
    OTHER_RACE,
    DAY,
    CLEAR_SQL,
    TODAY_DRAFT,
    sttState,
    stageCalls,
    bundle,
    replyBundle,
    push,
    claim,
    counts,
    NOTHING,
  } = env);
  stt2Scene1();
  stt2Scene2();
}
