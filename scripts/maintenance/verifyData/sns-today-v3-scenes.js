/**
 * verify-sns-today-v3.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-v3.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadTodayV3Material,
  buildTodayDigestV3,
  checkTodayDigestV3,
  V3_RATE_NOTE,
  V3_NIGASHI_NOTE,
} from "../../lib/snsTodayDigestV3.js";
import { DATE, material, id } from "./sns-today-v3-material.js";

let t, URL_C, stat, build, GENERAL, FOOT_PERIOD, FOOT_RATE, FOOT_NIGASHI;

function scene1() {
  test("材料の読み方: 1000行を超える表は並びを固定して1000行ずつ読む。率は使う組み合わせ（1〜4コース）だけ、300人ずつ。節の中の中止は節の開始日から", async () => {
    const calls = [];
    const entries = Array.from({ length: 1728 }, (_, i) => ({
      race_id: `${DATE}-${String(Math.floor(i / 72) + 1).padStart(2, "0")}-${String((Math.floor(i / 6) % 12) + 1).padStart(2, "0")}`,
      boat_number: (i % 6) + 1,
      racer_id: 10000 + i,
    }));
    const db = async (path) => {
      calls.push(path);
      const page = (rows) => {
        const limit = Number(path.match(/limit=(\d+)/)?.[1] ?? rows.length);
        const offset = Number(path.match(/offset=(\d+)/)?.[1] ?? 0);
        return rows.slice(offset, offset + limit);
      };
      if (path.startsWith("race_entries")) return page(entries);
      if (path.startsWith("race_series"))
        return [
          { venue_code: 1, start_date: "2037-11-01", end_date: "2037-11-06" },
        ];
      if (path.startsWith("racer_course_technique_stats")) return [];
      return page([]);
    };
    const m = await loadTodayV3Material(db, DATE);
    assert.equal(m.entries.length, 1728);
    const entryCalls = calls.filter((c) => c.startsWith("race_entries"));
    assert.deepEqual(
      entryCalls.map((c) => c.match(/offset=\d+/)[0]),
      ["offset=0", "offset=1000"],
    );
    assert.match(
      entryCalls[0],
      /race_id=like\.2037-11-05\*&.*order=race_id,boat_number/,
    );
    const statCalls = calls.filter((c) =>
      c.startsWith("racer_course_technique_stats"),
    );
    // 1コースあたり 288人 → 1回ずつ、4コース
    assert.deepEqual(
      statCalls.map((c) => c.match(/course=eq\.(\d)/)[1]),
      ["1", "2", "3", "4"],
    );
    assert.ok(
      calls.some((c) =>
        /^races\?cancellation_status=eq\.confirmed&race_date=gte\.2037-11-01&race_date=lt\.2037-11-05/.test(
          c,
        ),
      ),
    );
  });
  test("中止の疑い（tentative）のレースも載せない（送る直前の検査は中止の値が入っていれば朝の投稿ごと止める。/code-review の指摘）", () => {
    const m = material({
      venues: { 15: { stage: { 12: "優勝戦" } }, 2: {} },
      stats: [
        stat(2, 4, 1, { nige_rate: 90, runs: 40 }),
        stat(2, 5, 1, { nige_rate: 80, runs: 40 }),
      ],
    });
    for (const r of m.races)
      if (r.race_id === id(15, 12) || r.race_id === id(2, 4))
        r.cancellation_status = "tentative";
    const out = build(m);
    assert.doesNotMatch(out.text, /🏆|丸亀12R/);
    assert.deepEqual(
      out.blocks.map((b) => b.race_id),
      [id(2, 5)],
    );
    assert.ok(!out.picks.some((p) => [id(15, 12), id(2, 4)].includes(p.race_id)));
  });
  test("検査: 会場名の訳が無く i18n のキーが残った本文は通さない（/code-review の指摘）", () => {
    const out = buildTodayDigestV3(material({ venues: { 2: {} } }), {
      sendAt: "07:00",
      t: (key, params) => (key === "venues.2" ? key : t(key, params)),
      url: URL_C,
    });
    assert.match(out.text, /venues\.2/);
    assert.ok(
      checkTodayDigestV3(out.text, { date: DATE, url: URL_C }).includes(
        "i18n_key_left",
      ),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（t・URL_C・stat・build・GENERAL） */
export function runSnsTodayV3Scenes1(env) {
  ({ t, URL_C, stat, build, GENERAL } = env);
  scene1();
}

function scene2() {
  test("脚注: 文は起票のとおり。率の塊の後・タグの前に期間・定義・逃し率の3行。期間は率の窓（2025-12-02〜前日）を年つきの YYYY/M/D で", () => {
    assert.equal(V3_RATE_NOTE, FOOT_RATE);
    assert.equal(V3_NIGASHI_NOTE, FOOT_NIGASHI);
    const out = build(material(GENERAL));
    const lines = out.text.split("\n");
    assert.deepEqual(lines.slice(-5), [
      "━━━━━━━━━━",
      FOOT_PERIOD,
      FOOT_RATE,
      FOOT_NIGASHI,
      "#ボートレース",
    ]);
    assert.deepEqual(out.summary.period, {
      from: "2025-12-02",
      to: "2037-11-04",
    });
  });
  test("脚注: 期間は率の窓（初日は載せた人の最も早い日、終わりは窓の最新。7:00 では前々日、13:00 の集計の後は前日）。更新が止まった行・窓の壊れた行・終わりが今日以降の行は使わない（/code-review の指摘）", () => {
    const m = material({
      venues: { 2: {} },
      stats: [
        stat(2, 4, 1, { nige_rate: 80, window_start: "2025-12-03" }),
        stat(2, 5, 4, { makuri_rate: 30 }),
        // 率は高いが窓の終わりが前々日（更新が止まった）→ 使わない
        stat(2, 6, 1, { nige_rate: 99, window_end: "2037-11-03" }),
        // 窓の日付が暦に無い・終わりが今日 → 使わない（その日の投稿は止めない）
        stat(2, 7, 4, { makuri_rate: 90, window_end: "2037-02-30" }),
        stat(2, 8, 4, { makuri_rate: 80, window_end: "2037-11-05" }),
      ],
    });
    const out = build(m);
    assert.deepEqual(
      out.blocks.map((b) => [b.key, b.race_id]),
      [
        ["nige", id(2, 4)],
        ["makuri", id(2, 5)],
      ],
    );
    assert.match(
      out.text,
      /^※率は 2025\/12\/2〜2037\/11\/4 の全国の成績（そのコースに入ったとき）$/m,
    );
    assert.deepEqual(
      checkTodayDigestV3(out.text, { date: DATE, url: URL_C }),
      [],
    );
    // 翌日の材料（窓の終わりが1日進む）なら、脚注の終わりも1日進む
    const next = material({
      venues: { 2: {} },
      stats: [stat(2, 4, 1, { nige_rate: 80, window_end: "2037-11-05" })],
    });
    next.date = "2037-11-06";
    const after = buildTodayDigestV3(next, { sendAt: "07:00", t, url: URL_C });
    assert.match(after.text, /〜2037\/11\/5 の全国の成績/);
    // 夜の集計が止まり全員の窓が前々日まで: 載せる率の実際の期間を書く（前日と偽らない）
    const stale = material({
      venues: { 2: {} },
      stats: [stat(2, 4, 1, { nige_rate: 80, window_end: "2037-11-03" })],
    });
    assert.match(build(stale).text, /〜2037\/11\/3 の全国の成績/);
  });
}

function scene3() {
  test("脚注: 逃し率の行は【逃し率が高い選手】の塊がある日だけ。率の塊が無い日は脚注を出さない", () => {
    const noNigashi = build(
      material({
        venues: { 2: {} },
        stats: [
          stat(2, 4, 1, { nige_rate: 80 }),
          stat(2, 5, 4, { makuri_rate: 30 }),
        ],
      }),
    );
    assert.deepEqual(noNigashi.text.split("\n").slice(-4), [
      "━━━━━━━━━━",
      FOOT_PERIOD,
      FOOT_RATE,
      "#ボートレース",
    ]);
    assert.deepEqual(
      checkTodayDigestV3(noNigashi.text, { date: DATE, url: URL_C }),
      [],
    );
    const onlyNigashi = build(
      material({
        venues: { 2: {} },
        stats: [stat(2, 4, 2, { nigashi_rate: 70 })],
      }),
    );
    assert.deepEqual(onlyNigashi.text.split("\n").slice(-5), [
      "━━━━━━━━━━",
      FOOT_PERIOD,
      FOOT_RATE,
      FOOT_NIGASHI,
      "#ボートレース",
    ]);
    const none = build(material({ venues: { 2: {} } }));
    assert.doesNotMatch(none.text, /※/);
    assert.equal(none.summary.period, null);
  });
  test("脚注の検査: 期間の形・前日より後の終わり・初日が終わりより後・定義の行の欠け・塊の無い日の脚注・逃し率の行の食い違いを止める", () => {
    const ok = build(material(GENERAL)).text;
    const check = (text) => checkTodayDigestV3(text, { date: DATE, url: URL_C });
    assert.deepEqual(check(ok), []);
    // 終わりが今日（前日より後）
    assert.ok(
      check(ok.replace("〜2037/11/4 ", "〜2037/11/5 ")).includes(
        "period_note_invalid",
      ),
    );
    // 初日が終わりより後
    assert.ok(
      check(ok.replace("2025/12/2〜", "2037/12/2〜")).includes(
        "period_note_invalid",
      ),
    );
    // 暦に無い日付（/code-review の指摘）
    assert.ok(
      check(ok.replace("〜2037/11/4 ", "〜2037/0/99 ")).includes(
        "period_note_invalid",
      ),
    );
    // 年の無い期間（sns-copy-rules: 期間は年つきの両端）
    assert.ok(
      check(ok.replace("2025/12/2〜2037/11/4", "12/2〜11/4")).includes(
        "period_note_invalid",
      ),
    );
    assert.ok(
      check(ok.replace(`${FOOT_RATE}\n`, "")).includes("rate_note_missing"),
    );
    assert.ok(
      check(ok.replace(`${FOOT_NIGASHI}\n`, "")).includes(
        "nigashi_note_mismatch",
      ),
    );
    const none = build(material({ venues: { 2: {} } })).text;
    assert.ok(
      check(
        none.replace("#ボートレース", `${FOOT_RATE}\n#ボートレース`),
      ).includes("rate_note_without_rates"),
    );
    assert.ok(
      check(
        none.replace("#ボートレース", `${FOOT_NIGASHI}\n#ボートレース`),
      ).includes("nigashi_note_mismatch"),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（t・URL_C・stat・build・GENERAL・FOOT_PERIOD・FOOT_RATE・FOOT_NIGASHI） */
export function runSnsTodayV3Scenes2(env) {
  ({ t, URL_C, stat, build, GENERAL, FOOT_PERIOD, FOOT_RATE, FOOT_NIGASHI } = env);
  scene2();
  scene3();
}

function scene4() {
  test("逃し率の塊（BOA-1324）: 見出しは【逃し率が高い選手】で、2号艇の名前・級・逃し率・走数と会場R・2号艇・締切。1号艇の名前は出さず、「逃げやすい」「鉄板」「決まりやすい」を書かない", () => {
    const out = build(material(GENERAL));
    assert.match(
      out.text,
      /【逃し率が高い選手】\n選手 2-4-2 B1\u300072%（41走）\n▶ 戸田4R 2号艇 12:02締切\n/,
    );
    assert.doesNotMatch(out.text, /逃げやすい|鉄板|決まりやすい|選手 2-4-1/);
    assert.match(
      out.text,
      /※逃し率＝2コースに入ったとき、1コースの艇の逃げで決まった割合/,
    );
    const check = (text) => checkTodayDigestV3(text, { date: DATE, url: URL_C });
    assert.deepEqual(check(out.text), []);
    // 検査は旧い見出しや言い回しが本文のどこかに混ざったら止める。1号艇（戸田4R、選手 2-4-1）の名前は本文に出ない
    for (const bad of [
      "【1号艇が逃げやすいレース】",
      "鉄板の1号艇",
      "逃げが決まりやすい",
    ])
      // 他の検査に当たらない別の行に入れて、banned_phrase だけで止まることを確かめる（/code-review の指摘）
      assert.deepEqual(
        check(out.text.replace("【優勝戦】", `${bad}\n【優勝戦】`)),
        ["banned_phrase"],
        bad,
      );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（t・URL_C・stat・build・GENERAL・FOOT_PERIOD・FOOT_RATE・FOOT_NIGASHI） */
export function runSnsTodayV3Scenes3(env) {
  ({ t, URL_C, stat, build, GENERAL, FOOT_PERIOD, FOOT_RATE, FOOT_NIGASHI } = env);
  scene4();
}
