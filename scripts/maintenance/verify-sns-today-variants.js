// /today の X 投稿の見出しの日替わり（config/today-variants.json、scripts/lib/snsTodayVariants.js、2026-10-20）の再現テスト。外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  TODAY_BASE_TYPE_ID,
  TODAY_HEADING_BUILTIN,
  loadTodayVariants,
  normalizeTodayVariants,
  normalizeTypeScheduleRow,
  pickTodayHeading,
  pickTodayPost,
  renderTodayHeading,
} from "../lib/snsTodayVariants.js";

const config = {
  default: "本日のデータ一覧（{date}）",
  variants: [
    { id: "a", uuid: null, heading: "案A（{date}）" },
    {
      id: "b",
      uuid: "11111111-2222-4333-8444-555555555555",
      heading: "案B（{date}）",
    },
  ],
};
const days = (from, n) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000)
      .toISOString()
      .slice(0, 10),
  );

test("月曜はじまりの週の中では日替わりに交互、週ごとに順を逆にする（同じ曜日に同じ案が続かない）", () => {
  // 2026-10-19 は月曜
  const ids = days("2026-10-19", 14).map(
    (d) => pickTodayHeading(config, d).variant.id,
  );
  for (let i = 1; i < 7; i++) assert.notEqual(ids[i], ids[i - 1]);
  // 翌週の同じ曜日は逆の案
  for (let i = 0; i < 7; i++) assert.notEqual(ids[i + 7], ids[i]);
  // 2週で両方の案がちょうど7回ずつ
  assert.equal(ids.filter((id) => id === "a").length, 7);
});

test("案の札: uuid が入っていればそのまま、空・null なら null", () => {
  const all = days("2026-10-19", 4).map(
    (d) => pickTodayHeading(config, d).variant,
  );
  assert.ok(
    all.some(
      (v) => v.id === "b" && v.uuid === "11111111-2222-4333-8444-555555555555",
    ),
  );
  assert.ok(all.some((v) => v.id === "a" && v.uuid === null));
  const empty = normalizeTodayVariants({
    ...config,
    variants: config.variants.map((v) => ({ ...v, uuid: "" })),
  });
  assert.ok(empty.variants.every((v) => v.uuid === null));
});

test("見出しに {date} が無い案は使わない（日付が消えるため。x-channel の指摘）", () => {
  const noDate = {
    default: "既定（{date}）",
    variants: [
      config.variants[0],
      { ...config.variants[1], heading: "日付なしの見出し" },
    ],
  };
  assert.equal(pickTodayHeading(noDate, "2026-10-20").variant.id, "default");
  assert.equal(
    pickTodayHeading({ default: "日付なし", variants: [] }, "2026-10-20")
      .heading,
    TODAY_HEADING_BUILTIN,
  );
});

test("設定が無い・壊れているときは既定の文（id default）に戻す", () => {
  const def = {
    heading: "本日のデータ一覧（{date}）",
    variant: { id: "default", uuid: null },
  };
  assert.deepEqual(pickTodayHeading(null, "2026-10-20"), {
    heading: TODAY_HEADING_BUILTIN,
    variant: { id: "default", uuid: null },
  });
  for (const broken of [
    { default: "既定（{date}）", variants: [config.variants[0]] }, // 1案だけ
    {
      default: "既定（{date}）",
      variants: [config.variants[0], { ...config.variants[1], id: "a" }],
    }, // 同じ id
    {
      default: "既定（{date}）",
      variants: [
        config.variants[0],
        { ...config.variants[1], heading: "改行\nあり" },
      ],
    },
    {
      default: "既定（{date}）",
      variants: [
        config.variants[0],
        { ...config.variants[1], uuid: "not-uuid" },
      ],
    },
  ])
    assert.equal(pickTodayHeading(broken, "2026-10-20").variant.id, "default");
  assert.equal(
    pickTodayHeading({ default: "", variants: [] }, "2026-10-20").heading,
    def.heading,
  );
  // ファイルが読めない・JSON でない
  assert.equal(
    loadTodayVariants(() => {
      throw new Error("ENOENT");
    }),
    null,
  );
  assert.equal(
    loadTodayVariants(() => "{"),
    null,
  );
});

test("リポジトリの config/today-variants.json は読めて、2案と既定の文がそろう", () => {
  const loaded = loadTodayVariants();
  const n = normalizeTodayVariants(loaded);
  assert.equal(n.variants.length, 2);
  assert.ok(n.fallback.length > 0);
});

test("見出しへの日付の差し込み", () => {
  assert.equal(
    renderTodayHeading("案A（{date}）", "10月20日（火）"),
    "案A（10月20日（火））",
  );
  assert.equal(renderTodayHeading("日付なし", "10月20日（火）"), "日付なし");
});
// ---------- PD02: 型の列（sns_today_type_schedule、174）と push-today-types.js ----------
test("型の列の1行: 書ける項目だけを受け、作れない項目・壊れた値は理由で返す", () => {
  const ok = normalizeTypeScheduleRow(
    {
      day: "2026-10-27",
      type_id: "t03-conclusion-heading",
      post: { heading: "見出し（{date}）", link_position: "end" },
    },
    "2026-10-27",
  );
  assert.deepEqual(ok, {
    type_id: "t03-conclusion-heading",
    post: {
      heading: "見出し（{date}）",
      link_lead: null,
      link_position: "end",
    },
  });
  const base = {
    day: "2026-10-27",
    type_id: "t01",
    post: { heading: "見出し（{date}）" },
  };
  for (const [row, reason] of [
    [{ ...base, day: "2026-10-28" }, "day_mismatch"],
    [{ ...base, type_id: "T01 bad" }, "type_id_invalid"],
    [{ ...base, post: [] }, "post_invalid"],
    [
      { ...base, post: { ...base.post, thumb: "表" } },
      "type_unsupported:thumb",
    ],
    [{ ...base, post: { heading: "日付なし" } }, "heading_invalid"],
    [
      { ...base, post: { ...base.post, link_lead: "改行\nあり" } },
      "link_lead_invalid",
    ],
    [
      { ...base, post: { ...base.post, link_lead: "{x}" } },
      "link_lead_invalid",
    ],
    [
      { ...base, post: { ...base.post, link_position: "top" } },
      "link_position_invalid",
    ],
  ])
    assert.equal(normalizeTypeScheduleRow(row, "2026-10-27").reason, reason);
  assert.equal(
    normalizeTypeScheduleRow(
      { ...base, post: { ...base.post, link_position: "reply" } },
      "2026-10-27",
      { allowReply: false },
    ).reason,
    "reply_not_allowed",
  );
});

test("その日の型: 列の行があれば a・b どちらの日もその中身。札（偶奇の a・b）は変えない。無ければ config の案と理由", () => {
  const typed = {
    default: "既定（{date}）",
    variants: [
      { id: "a", uuid: null, type_id: "today-a", heading: "案A（{date}）" },
      { id: "b", uuid: null, heading: "案B（{date}）", link_position: "end" },
    ],
  };
  // 2026-10-26 は日の番号が偶数（a）、10-27 は奇数（b）
  const row = (day) => ({
    day,
    type_id: "t04-question-heading",
    post: { heading: "問い（{date}）" },
  });
  for (const [day, side] of [
    ["2026-10-26", "a"],
    ["2026-10-27", "b"],
  ]) {
    const picked = pickTodayPost(typed, day, { row: row(day) });
    assert.equal(picked.heading, "問い（{date}）");
    assert.equal(picked.variant.id, side);
    assert.deepEqual(picked.content_type, {
      id: "t04-question-heading",
      side,
      source: "schedule",
    });
  }
  const none = pickTodayPost(typed, "2026-10-27");
  assert.deepEqual(
    [none.heading, none.link_position, none.content_type],
    [
      "案B（{date}）",
      "end",
      {
        id: TODAY_BASE_TYPE_ID,
        side: "b",
        source: "config",
        fallback_reason: "no_schedule_row",
      },
    ],
  );
  assert.equal(
    pickTodayPost(typed, "2026-10-27", {
      scheduleError: "schedule_unavailable",
    }).content_type.fallback_reason,
    "schedule_unavailable",
  );
  // config の案は返信を選べない（いつでも送れる形に保つ）。選んだ案があれば設定ごと既定に戻る
  const replyConfig = {
    ...typed,
    variants: [
      typed.variants[0],
      { ...typed.variants[1], link_position: "reply" },
    ],
  };
  assert.equal(normalizeTodayVariants(replyConfig).variants.length, 0);
  assert.equal(
    pickTodayPost(replyConfig, "2026-10-27").content_type.side,
    "default",
  );
  // 返信の行は allowReply=false なら config に戻る
  const reply = {
    day: "2026-10-27",
    type_id: "t01-link-in-reply",
    post: { heading: "見出し（{date}）", link_position: "reply" },
  };
  assert.equal(
    pickTodayPost(typed, "2026-10-27", { row: reply, allowReply: false })
      .content_type.fallback_reason,
    "reply_not_allowed",
  );
  assert.equal(
    pickTodayPost(typed, "2026-10-27", { row: reply }).link_position,
    "reply",
  );
});

test("リポジトリの config の案 a・b の型の id は today-a（2案が同じ中身の間は、hq の基準の型と同じ）", () => {
  const n = normalizeTodayVariants(loadTodayVariants());
  assert.deepEqual(
    n.variants.map((v) => v.type_id),
    ["today-a", "today-a"],
  );
  assert.ok(
    n.variants.every(
      (v) => v.link_position === "after_heading" && v.link_lead === null,
    ),
  );
});

test("push-today-types.js: 先の7日分を検査し、1行でも落ちたら何も入れない。入れるのは日付ごとの upsert", async () => {
  const { checkTypeSchedule, upsertTypeSchedule } =
    await import("../sns/push-today-types.js");
  const riskRules = JSON.parse(
    await readFile(
      new URL(
        "../../sns-video-studio/remotion/risk-rules.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).rules;
  const now = new Date("2026-10-25T13:45:00Z"); // JST 10/25 22:45
  const types = days("2026-10-26", 7).map((day, i) => ({
    day,
    type_id: i % 2 ? "t03-conclusion-heading" : "today-a",
    post: { heading: "本日のデータ一覧（{date}）" },
  }));
  const ok = checkTypeSchedule({ types }, { now, riskRules });
  assert.deepEqual(ok.reasons, []);
  assert.equal(ok.rows.length, 7);
  assert.deepEqual(Object.keys(ok.rows[0]).sort(), [
    "day",
    "post",
    "source",
    "type_id",
    "updated_at",
  ]);
  for (const [bad, pattern] of [
    [{ ...types[0], day: "2026-10-24" }, /JST の今日/],
    [{ ...types[0], day: "2026-11-08" }, /JST の今日/],
    [{ ...types[0], post: { heading: "必ず当たる（{date}）" } }, /禁止表現/],
    [{ ...types[0], post: { heading: "競艇の一覧（{date}）" } }, /禁止表現/],
    [
      { ...types[0], post: { heading: "x（{date}）", caption: "y" } },
      /type_unsupported:caption/,
    ],
    [types[1], /同じ日が2回/],
  ]) {
    const res = checkTypeSchedule(
      { types: [...types.slice(1), bad] },
      { now, riskRules },
    );
    assert.match(res.reasons.join(" / "), pattern);
  }
  assert.match(checkTypeSchedule({}, { now }).reasons[0], /types が空/);
  const calls = [];
  await upsertTypeSchedule(ok.rows, {
    url: "https://db",
    key: "k",
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return Response.json(ok.rows);
    },
  });
  assert.equal(
    calls[0].url,
    "https://db/rest/v1/sns_today_type_schedule?on_conflict=day",
  );
  assert.match(calls[0].opts.headers.Prefer, /resolution=merge-duplicates/);
  await assert.rejects(
    upsertTypeSchedule(ok.rows, {
      url: "https://db",
      key: "k",
      fetchImpl: async () => new Response("no", { status: 404 }),
    }),
    /HTTP 404/,
  );
});
