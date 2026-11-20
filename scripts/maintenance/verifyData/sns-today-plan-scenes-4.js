/**
 * verify-sns-today-plan.js の後半の場面（4/7）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { createTodayStore } from "../../lib/snsTodayPlanner.js";
import { clearAll, TYPE_VARIANTS, linkAt } from "./sns-today-plan-scenes-3.js";
import { digestOf } from "./sns-today-plan-scenes-1.js";

let db, first, all, at, sqlStore, plan, putType, withAuto;

function scene1() {
  test("型の列: 行が無い日・作れない項目がある日・壊れた日・表が無い日は config の案で送り、理由を残す（止めない）", async () => {
    const cases = [
      [null, "no_schedule_row"],
      [
        { heading: "見出し（{date}）", thumb: "早見表" },
        "type_unsupported:thumb",
      ],
      [{ heading: "日付なし" }, "heading_invalid"],
      [
        { heading: "見出し（{date}）", link_position: "middle" },
        "link_position_invalid",
      ],
    ];
    for (const [post, reason] of cases) {
      await clearAll();
      if (post) await putType(DATE, "t09-test", post);
      const result = await plan({ loadVariants: () => TYPE_VARIANTS });
      assert.equal(result.report.items[0].outcome, "manual", reason);
      const draft = await first("SELECT * FROM sns_drafts");
      const ct = draft.source_data.content_type;
      assert.deepEqual(
        [ct.id, ct.source, ct.fallback_reason],
        ["today-a", "config", reason],
      );
      // 今の型（リンクは見出しの直後、3行目）
      assert.equal(linkAt(draft.caption_text), 2);
      assert.equal(result.report.items[0].type_fallback, reason);
    }
    // 表が無い（174 の適用前。PostgREST は 404）
    await clearAll();
    const typeSchedule = sqlStore.typeSchedule;
    sqlStore.typeSchedule = async () => {
      throw new Error(
        "/today の計画の DB 操作に失敗: HTTP 404 GET sns_today_type_schedule",
      );
    };
    try {
      await plan({ loadVariants: () => TYPE_VARIANTS });
    } finally {
      sqlStore.typeSchedule = typeSchedule;
    }
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(
      draft.source_data.content_type.fallback_reason,
      "schedule_unavailable",
    );
  });
  test("型の列: 下書きができた後は列が変わってもその日の型を変えない（作り直しでも同じ型）", async () => {
    await putType(DATE, "t04-question-heading", {
      heading: "今日いちばん荒れそうな場は？（{date}）",
    });
    await plan({ loadVariants: () => TYPE_VARIANTS });
    await db.exec(
      `UPDATE sns_today_type_schedule SET type_id='t03-conclusion-heading', post='{"heading":"別の見出し（{date}）"}'`,
    );
    const again = await plan({
      now: at("07:10"),
      digest: digestOf(24),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(again.report.items[0].outcome, "rebuilt");
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(draft.source_data.content_type.id, "t04-question-heading");
    assert.match(draft.caption_text, /^今日いちばん荒れそうな場は？/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・sqlStore・plan・putType・withAuto） */
export function runSnsTodayPlanScenes11(env) {
  ({ db, first, all, at, sqlStore, plan, putType, withAuto } = env);
  scene1();
}

function scene2() {
  test("返信: 子の下書きの後に落ちて子の item が無いときは、同じ版でも「変化なし」で止まらず子の item を作る", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(async () => {
      const insertItem = sqlStore.insertItem;
      sqlStore.insertItem = async (row) => {
        if (row.race_id.endsWith(":reply")) throw new Error("item を作れない");
        return insertItem(row);
      };
      try {
        await assert.rejects(
          plan({ loadVariants: () => TYPE_VARIANTS }),
          /item を作れない/,
        );
      } finally {
        sqlStore.insertItem = insertItem;
      }
      const again = await plan({
        now: at("06:45"),
        loadVariants: () => TYPE_VARIANTS,
      });
      // 親の item はあるので作り直しの扱い（子の item を作り、親から順に承認する）
      assert.equal(again.report.items[0].outcome, "rebuilt");
      const items = await all(
        "SELECT race_id, state FROM sns_auto_send_items ORDER BY race_id",
      );
      assert.deepEqual(
        items.map((i) => i.state),
        ["notified", "notified"],
      );
      assert.equal((await all("SELECT * FROM sns_drafts")).length, 2);
    });
  });
  test("返信: 子の承認に落ちたら、親の item も held_manual にして送らない（リンクの無い親だけを出さない。x-channel の審査 P2）", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(async () => {
      const approveFn = sqlStore.approve;
      let calls = 0;
      sqlStore.approve = async (a) => {
        calls += 1;
        if (calls === 2) throw new Error("子の承認に失敗");
        return approveFn(a);
      };
      try {
        const result = await plan({ loadVariants: () => TYPE_VARIANTS });
        assert.match(result.report.items[0].reason, /子の承認に失敗/);
      } finally {
        sqlStore.approve = approveFn;
      }
      const items = await all(
        "SELECT race_id, state FROM sns_auto_send_items ORDER BY race_id",
      );
      assert.deepEqual(
        items.map((i) => i.state),
        ["held_manual", "held_manual"],
      );
    });
  });
  test("返信: 個別承認（mode=manual）の日は返信を選べず、config の案（リンクは見出しの直後）で送る。理由は reply_not_allowed", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await plan({ loadVariants: () => TYPE_VARIANTS });
    const drafts = await all("SELECT * FROM sns_drafts");
    assert.equal(drafts.length, 1);
    assert.equal(linkAt(drafts[0].caption_text), 2);
    assert.deepEqual(
      [
        drafts[0].source_data.content_type.id,
        drafts[0].source_data.content_type.fallback_reason,
      ],
      ["today-a", "reply_not_allowed"],
    );
  });
}

function scene3() {
  test("返信: 子の文に禁止表現があれば、親も held_manual にして承認しない", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_lead: "必ず当たる一覧→",
      link_position: "reply",
    });
    await withAuto(async () => {
      const result = await plan({ loadVariants: () => TYPE_VARIANTS });
      assert.equal(result.report.items[0].outcome, "held_manual");
      const items = await all("SELECT state FROM sns_auto_send_items");
      assert.deepEqual(
        items.map((i) => i.state),
        ["held_manual", "held_manual"],
      );
      assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
    });
  });
  test("PostgREST の store: 親と返信の下書きを分けて返す（返信は source_data.today_reply.parent_draft_id）", async () => {
    const fetchImpl = async (url) =>
      Response.json(
        String(url).includes("sns_drafts")
          ? [
              { id: "c", source_data: { today_reply: { parent_draft_id: "p" } } },
              { id: "p", source_data: {} },
            ]
          : [
              { id: "i1", race_id: `today:${DATE}`, draft_id: "p" },
              { id: "i2", race_id: `today:${DATE}:reply`, draft_id: "c" },
            ],
      );
    const state = await createTodayStore({
      url: "https://db",
      key: "k",
      fetchImpl,
    }).todayState(DATE);
    assert.deepEqual(
      [state.draft.id, state.item.id, state.reply.draft.id, state.reply.item.id],
      ["p", "i1", "c", "i2"],
    );
  });
}

function scene4() {
  test("182: X の日の枠の /today の取り置きに入らなければ自動の承認をしない（返信の型は親と返信の2本で数え、両方 held_manual）。182 の前（404）は今のまま", async () => {
    await clearAll();
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    const asked = [];
    sqlStore.xSlotRoom = async (kind, need) => {
      asked.push([kind, need]);
      return {
        ok: false,
        reason: "kind_slot_full",
        kind,
        need,
        limit: 8,
        reserve: 1,
        booked: 0,
        others_booked: 4,
        held_for_others: 3,
        external: 0,
      };
    };
    try {
      await withAuto(async () => {
        const notes = [];
        const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
        assert.match(
          result.report.items[0].reason,
          /auto_failed: X の日の枠に digest（2本）が入らない/,
        );
        assert.deepEqual(asked, [["digest", 2]]);
        const items = await all("SELECT state FROM sns_auto_send_items");
        assert.deepEqual(
          items.map((i) => i.state),
          ["held_manual", "held_manual"],
        );
        assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
        assert.ok(notes.some((n) => /自動の承認に失敗したので送らない/.test(n)));
      });
      await clearAll();
      sqlStore.xSlotRoom = async () => {
        throw new Error(
          "/today の計画の DB 操作に失敗: HTTP 404 POST rpc/sns_x_slot_room",
        );
      };
      await withAuto(async () => {
        const result = await plan({ loadVariants: () => TYPE_VARIANTS });
        assert.equal(result.report.items[0].outcome, "notified");
        assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 1); // clearAll で型の列も消えるので返信の無い型
      });
    } finally {
      delete sqlStore.xSlotRoom;
      await clearAll();
    }
  });
  test("返信: 返信の型を引き継いだ作り直しで自動でなくなっていたら（mode を manual に戻した）、親も子も held_manual にして送らない（/code-review の指摘）", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(() => plan({ loadVariants: () => TYPE_VARIANTS }));
    // withAuto の後は mode=manual。一覧がやり直されて作り直す
    const rebuilt = await plan({
      now: at("06:55"),
      digest: digestOf(24),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
    const items = await all(
      "SELECT race_id, state, held_reason FROM sns_auto_send_items ORDER BY race_id",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["held_manual", "held_manual"],
    );
    assert.match(items[0].held_reason, /自動（mode=auto）の日だけ/);
    const parent = (await sqlStore.todayState(DATE)).draft;
    assert.equal(linkAt(parent.caption_text), -1);
  });
}

function scene5() {
  test("返信: 自動の承認に落ちて item を戻せなかったら、握りつぶさず知らせる", async () => {
    await putType(DATE, "t01-link-in-reply", {
      heading: "本日のデータ一覧（{date}）",
      link_position: "reply",
    });
    await withAuto(async () => {
      const approveFn = sqlStore.approve;
      const updateItem = sqlStore.updateItem;
      sqlStore.approve = async () => {
        throw new Error("承認に失敗");
      };
      sqlStore.updateItem = async (id, from, p) => {
        if (p.state === "held_manual") throw new Error("戻せない");
        return updateItem(id, from, p);
      };
      try {
        const notes = [];
        const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
        assert.match(result.report.items[0].reason, /承認に失敗.*を戻せない/);
        assert.ok(notes.some((n) => /を戻せない/.test(n)));
      } finally {
        sqlStore.approve = approveFn;
        sqlStore.updateItem = updateItem;
      }
    });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・at・sqlStore・plan・putType・withAuto） */
export function runSnsTodayPlanScenes12(env) {
  ({ db, first, all, at, sqlStore, plan, putType, withAuto } = env);
  scene2();
  scene3();
  scene4();
  scene5();
}
