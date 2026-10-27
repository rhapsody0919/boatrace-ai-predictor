// /today の X 投稿が使ったレースを hq に出す読む口（scripts/sns/today-picks.js、BOA-1169）の再現テスト。外部接続なし
import { test } from "node:test";
import assert from "node:assert/strict";
import { raceIdsOf, readTodayPicks, todayPicksOf } from "../sns/today-picks.js";

const DATE = "2037-10-27";
const races = [
  {
    race_id: "2037-10-27-13-02",
    race_date: DATE,
    start_time: "11:03:00",
    cancellation_status: null,
  },
  {
    race_id: "2037-10-27-13-09",
    race_date: DATE,
    start_time: "14:34:00",
    cancellation_status: null,
  },
  {
    race_id: "2037-10-27-08-11",
    race_date: DATE,
    start_time: "15:20:00",
    cancellation_status: "confirmed",
  },
];
// 2026-10-27 の本番の下書きと同じ形（型 a、注目レースあり）
const draftA = (
  caption = "本日のデータ一覧\n\n注目レース：尼崎2R 11:03締切｜1号艇\n\n［逃げ］…",
) => ({
  id: "d1",
  status: "posted",
  caption_text: caption,
  source_data: {
    digest: {
      date: DATE,
      picks: [
        { race_id: "2037-10-27-13-02", boat_number: 1 },
        { race_id: "2037-10-27-13-09", boat_number: 4 },
        { race_id: "2037-10-27-08-11", boat_number: 1 },
      ],
    },
    content_type: { id: "today-a", side: "b" },
  },
});

test("型 a: 本文に「注目レース：」の行があれば picks の先頭が注目レース、残りが一覧。締切は races の JST、中止は cancelled", () => {
  const out = todayPicksOf(DATE, draftA(), races);
  assert.deepEqual(out.featured, {
    race_id: "2037-10-27-13-02",
    boat_number: 1,
    deadline_at: "2037-10-27T02:03:00.000Z",
    cancelled: false,
  });
  assert.deepEqual(
    out.list.map((r) => [r.race_id, r.boat_number, r.deadline_at, r.cancelled]),
    [
      ["2037-10-27-13-09", 4, "2037-10-27T05:34:00.000Z", false],
      ["2037-10-27-08-11", 1, "2037-10-27T06:20:00.000Z", true],
    ],
  );
  assert.equal(out.form, "a");
  assert.equal(out.content_type_id, "today-a");
  assert.equal(out.status, "posted");
});

test("型 a: 注目レースの行が無ければ featured は null で、picks の全部が一覧（先頭を落とさない）", () => {
  const out = todayPicksOf(
    DATE,
    draftA("本日のデータ一覧\n\n［逃げ］…"),
    races,
  );
  assert.equal(out.featured, null);
  assert.equal(out.list.length, 3);
});

test("型 b（course_win）: featured は course_win.featured、一覧は picks の全部（画像の行）", () => {
  const d = draftA();
  d.source_data.course_win = {
    featured: { race_id: "2037-10-27-13-09", boat_number: 4, racer_id: 1 },
  };
  const out = todayPicksOf(DATE, d, races);
  assert.equal(out.form, "b");
  assert.equal(out.featured.race_id, "2037-10-27-13-09");
  assert.equal(out.list.length, 3);
});

test("races に無いレースは deadline_at・cancelled を null で出す（黙って落とさない）。下書きが無い日は空", () => {
  const out = todayPicksOf(DATE, draftA(), []);
  assert.equal(out.featured.deadline_at, null);
  assert.equal(out.featured.cancelled, null);
  assert.deepEqual(todayPicksOf(DATE, null), {
    date: DATE,
    draft_id: null,
    status: null,
    form: null,
    content_type_id: null,
    featured: null,
    list: [],
  });
});

test("readTodayPicks: 返信の子を除いた親を1件読み、picks と course_win の race_id だけ races を読む。親が2件は投げる", async () => {
  const d = draftA();
  d.source_data.course_win = { featured: { race_id: "2037-10-27-99-01" } };
  assert.deepEqual(raceIdsOf(d), [
    "2037-10-27-99-01",
    "2037-10-27-13-02",
    "2037-10-27-13-09",
    "2037-10-27-08-11",
  ]);
  const asked = [];
  const call = async (p) => {
    asked.push(p);
    if (p.startsWith("sns_drafts"))
      return [
        draftA(),
        {
          ...draftA(),
          id: "r1",
          source_data: { today_reply: { parent_draft_id: "d1" } },
        },
      ];
    return races;
  };
  const out = await readTodayPicks(DATE, call);
  assert.equal(out.draft_id, "d1");
  assert.match(asked[0], /format=eq\.today_digest/);
  assert.match(asked[0], /status=neq\.archived/);
  assert.match(asked[1], /^races\?race_id=in\.\(/);
  await assert.rejects(
    readTodayPicks(DATE, async (p) =>
      p.startsWith("sns_drafts") ? [draftA(), draftA()] : [],
    ),
    /2件ある/,
  );
  // 下書きが無い日は races を読まない
  const none = [];
  await readTodayPicks(DATE, async (p) => (none.push(p), []));
  assert.equal(none.length, 1);
});
