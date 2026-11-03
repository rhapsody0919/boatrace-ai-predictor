// YouTube Shorts【人気薄の1着】（upset_win_short、BOA-1284、マイグレーション 198）の再現テスト。
// 型（sns-video-studio/remotion/src/upsetWin/model.js: 選び・直近1年の和・「およそ{1/p}回に1回」・文・検査）と、
// 送る口（scripts/sns/push-upset-win-short.js）を、PGlite に 189 まで・193・194・198 を当てて、本番と同じ承認（approve_sns_x_send）・
// claim（transition_sns_x_send → transition_sns_send_139）・YouTube の送信（runYoutubeQueueJob、モックの adapter）で通す。
// 外部接続なし。YouTube へは何も送らない。見本の bundle は 2026-11-03 宮島10R の本番の値（作り手で作った）
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import {
  addDays,
  buildBundle,
  candidates,
  checkBundle,
  dayCounts,
  hookMetrics,
  lowestBoats,
  oneIn,
  pageSeconds,
  pickUpset,
  primaryOf,
  screensOf,
  shapeDay,
  shapeRace,
  sumDays,
  tableMetrics,
  timeline,
  titleOf,
  weaknessesOf,
} from "../../sns-video-studio/remotion/src/upsetWin/model.js";
import {
  checkUpsetBundle,
  descriptionLink,
  dryRunClock,
  pushUpsetWinShort,
  raceReasons,
  resultLine,
  upsetStatus,
} from "../sns/push-upset-win-short.js";
import { parseUpsetId, upsetIdOf } from "../../api/_lib/snsUpsetWinShort.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import {
  createDeadlinePreflight,
  createMockHeadless,
  createMockYoutubeAdapter,
  runYoutubeQueueJob,
} from "../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";

const BASE_FILES = [
  "035_sns_marketing_hub_schema.sql",
  "042_content_drafts_columns.sql",
  "135_sns_preview_bundle_import.sql",
  "136_sns_metric_observations.sql",
  "137_sns_x_send.sql",
  "138_sns_external_operations.sql",
  "139_sns_deadline_queue.sql",
  "140_sns_mobile_approval.sql",
  "145_sns_edit_assist.sql",
  "146_sns_shorts_send.sql",
  "147_sns_draft_diff.sql",
  "148_sns_posted_approval_guard.sql",
  "153_sns_auto_send.sql",
  "154_sns_tokens_metric_jobs.sql",
  "158_sns_lanes_digest_period.sql",
  "160_sns_x_multiple_images.sql",
  "161_sns_full_picture_items.sql",
  "172_sns_full_picture_shorts.sql",
  "176_sns_finals_image_items.sql",
  "177_sns_finals_replies.sql",
  "179_sns_research_image_items.sql",
  "180_sns_research_image_send.sql",
  "182_sns_x_kind_reserves.sql",
  "186_sns_youtube_close_private.sql",
  "188_sns_x_cost_by_url.sql",
  "189_sns_today_thinking.sql",
  "193_sns_setsu_kiryoku_short.sql",
  "194_sns_setsu_kiryoku_x.sql",
];
const MIGRATION = "198_sns_upset_win_short.sql";
/** 本文の md5（本番の md5(prosrc)）。182・188・189・193 は verify-sns-setsu-kiryoku-x.js と同じ値、194 は 2026-11-04 に本番を読み取りで確かめた */
const MD5_182 = "c2b4835c416ff6e824a43fe9025c6518";
const MD5_188 = "ce1cd6fa756be8887f4033ab635a706b";
const MD5_189 = "96c809c05e1675d24feee596516db777";
const MD5_193 = "db961c46ca726a574b15e79c9f249d14";
const MD5_194 = "8d4f3caa34e30dda934e9b8698d970f4";
const MD5_153_X = "5ae12380ba47e6256388eec8691a603f";
const GUARDS = {
  "186_sns_youtube_close_private.sql": ["transition_sns_x_send", MD5_153_X],
  "188_sns_x_cost_by_url.sql": ["transition_sns_send_139", MD5_182],
  "189_sns_today_thinking.sql": ["transition_sns_send_139", MD5_188],
  "193_sns_setsu_kiryoku_short.sql": ["transition_sns_send_139", MD5_189],
  "194_sns_setsu_kiryoku_x.sql": ["transition_sns_send_139", MD5_193],
  [MIGRATION]: ["transition_sns_send_139", MD5_194],
};

const sqlOf = (file) =>
  readFile(new URL("../../docs/db-migration/" + file, import.meta.url), "utf8");
const md5 = (t) => createHash("md5").update(t).digest("hex");
const bodyOf = (s, fn) => {
  const i = s.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const a = s.indexOf("AS $$", i) + 5;
  return s.slice(a, s.indexOf("$$;", a));
};
const lastBody = async (files, fn) => {
  let body = null;
  for (const f of files) {
    const s = await sqlOf(f);
    if (s.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`))
      body = bodyOf(s, fn);
  }
  return body;
};
const forTest = (s) => s.replaceAll("now()", "test_now()");
async function guardedForTest(file, baseFiles, fn, baseMd5) {
  const base = md5(forTest(await lastBody(baseFiles, fn)));
  const text = forTest(await sqlOf(file));
  const guard = [
    `md5(prosrc) = '${baseMd5}'`,
    `IS DISTINCT FROM '${baseMd5}'`,
  ].find((g) => text.includes(g));
  assert.ok(guard, `${file} に照合の md5 ${baseMd5} が無い`);
  assert.equal(text.split(guard).length, 2, `${file} の照合の md5 は1か所`);
  return text.replace(guard, guard.replace(baseMd5, base));
}

const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const SAMPLE = JSON.parse(
  await readFile(
    new URL(
      "../../sns-video-studio/remotion/src/upsetWin/samples/2026-11-03-17-10.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const DAY = SAMPLE.date; // 2026-11-04
const at = (hhmmss, day = DAY) => new Date(`${day}T${hhmmss}+09:00`);
const PUSHED_AT = at("07:03:00");
const UPSET_ID = upsetIdOf(DAY, SAMPLE.race_id);
const check = (b) => checkBundle(b, { rules: riskRules, matchRiskRules });
const clone = (x) => structuredClone(x);
/** 見本の bundle（集計の時刻は受け取りの前にそろえる） */
const bundle = (patch = {}) => ({
  ...clone(SAMPLE),
  source_observed_at: at("07:01:00").toISOString(),
  ...patch,
});
/** 見本のレース（shapeRace の形。DB の読み直しの代わり） */
const raceOfSample = (b = SAMPLE) => ({
  race_id: b.race_id,
  race_date: b.race_date,
  venue: b.venue,
  venue_code: b.venue_code,
  race_number: b.race_number,
  grade: b.grade,
  cancelled: false,
  no_race: false,
  absent: false,
  rank1: b.rank1,
  technique: b.technique,
  boats: clone(b.boats),
});

/** 最小の MP4（ftyp と moov の mvhd（尺）・trak の tkhd（幅・高さ）だけ） */
function mp4({ width = 1080, height = 1920, seconds = 31 } = {}) {
  const box = (type, payload) => {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(
      [...type].map((c) => c.charCodeAt(0)),
      4,
    );
    out.set(payload, 8);
    return out;
  };
  const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) out.set(p, (o += p.length) - p.length);
    return out;
  };
  const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\0\0isom"));
  const mvhd = new Uint8Array(100);
  new DataView(mvhd.buffer).setUint32(12, 1000);
  new DataView(mvhd.buffer).setUint32(16, seconds * 1000);
  const tkhd = new Uint8Array(84);
  new DataView(tkhd.buffer).setInt32(40, 65536);
  new DataView(tkhd.buffer).setUint32(76, width * 65536);
  new DataView(tkhd.buffer).setUint32(80, height * 65536);
  return cat(
    ftyp,
    box("moov", cat(box("mvhd", mvhd), box("trak", box("tkhd", tkhd)))),
    box("mdat", new Uint8Array(64)),
  );
}
const VIDEO = mp4();

// ---------- 型（純粋関数） ----------

/** 6艇のレース（shapeRace の形）。boats は艇ごとの上書き */
const race = (over = {}, boats = {}) => ({
  race_id: "2026-11-03-17-10",
  race_date: "2026-11-03",
  venue: "宮島",
  venue_code: 17,
  race_number: 10,
  grade: "ippan",
  cancelled: false,
  no_race: false,
  absent: false,
  rank1: 4,
  technique: "まくり",
  ...over,
  boats: [1, 2, 3, 4, 5, 6].map((b) => ({
    boat: b,
    racer: `選手${b}`,
    class: "B1",
    win_rate: 5 + b / 10,
    motor_2rate: 30 + b,
    exhibition_time: 6.8 - b / 100,
    start_timing: 0.1,
    st_flag: null,
    odds: b === 4 ? 20 : 5,
    ...(boats[b] ?? {}),
  })),
});

test("およそ{1/p}回に1回: N/k の四捨五入、100以上は10の位で四捨五入。k=0・N<k・整数でない数は言えない（null）", () => {
  assert.equal(oneIn(51369, 5339), 10); // 9.62
  assert.equal(oneIn(51720, 2724), 19); // 18.99
  assert.equal(oneIn(1000, 7), 140); // 142.9
  assert.equal(oneIn(1000, 10), 100);
  assert.equal(oneIn(995, 10), 100); // 99.5 → 100 → 10の位で 100
  assert.equal(oneIn(100, 40), 3); // 2.5 → 3
  assert.equal(oneIn(10, 10), 1);
  assert.equal(oneIn(10, 0), null);
  assert.equal(oneIn(5, 6), null);
  assert.equal(oneIn(10.5, 2), null);
});

test("最下位（同値を含む）: 勝率・モーターは低い方、展示タイムは遅い方、展示 ST は F を負・L を一番遅いとして比べる。値の無い艇・0 があればその項目は比べない", () => {
  assert.deepEqual(
    lowestBoats(
      race({}, { 2: { win_rate: 3 }, 5: { win_rate: 3 } }),
      "win_rate",
    ),
    [2, 5],
  );
  assert.deepEqual(
    lowestBoats(race({}, { 3: { exhibition_time: 6.95 } }), "exhibition_time"),
    [3],
  );
  // F.12（-0.12）は F.03（-0.03）より早い。全艇 F なら F.03 が一番遅い
  const allF = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((b) => [
      b,
      { st_flag: "F", start_timing: b === 2 ? 0.03 : 0.12 },
    ]),
  );
  assert.deepEqual(lowestBoats(race({}, allF), "start_timing"), [2]);
  assert.deepEqual(
    lowestBoats(
      race(
        {},
        { 6: { st_flag: "L", start_timing: null }, 1: { start_timing: 0.4 } },
      ),
      "start_timing",
    ),
    [6],
  );
  assert.equal(
    lowestBoats(race({}, { 2: { motor_2rate: 0 } }), "motor_2rate"),
    null,
  );
  assert.equal(
    lowestBoats(race({}, { 2: { exhibition_time: null } }), "exhibition_time"),
    null,
  );
  assert.equal(
    lowestBoats(race({}, { 2: { start_timing: null } }), "start_timing"),
    null,
  );
});

test("選び: 単勝10倍以上・弱さ1つ以上・決まり手あり。単勝の高い順 → 弱さの多い順 → グレードの高い順 → race_id。中止・不成立・欠場・単勝の欠け（0）は外す。該当なしは null（0本）", () => {
  const weak = { 4: { win_rate: 2 } };
  const a = race(
    { race_id: "2026-11-03-01-01" },
    { ...weak, 4: { win_rate: 2, odds: 30 } },
  );
  const b = race(
    { race_id: "2026-11-03-02-01" },
    { 4: { win_rate: 2, exhibition_time: 7.0, odds: 30 } },
  );
  const c = race(
    { race_id: "2026-11-03-03-01", grade: "SG" },
    { 4: { win_rate: 2, exhibition_time: 7.0, odds: 30 } },
  );
  const d = race(
    { race_id: "2026-11-03-04-01" },
    { 4: { win_rate: 2, odds: 50 } },
  );
  const low = race(
    { race_id: "2026-11-03-05-01" },
    { 4: { win_rate: 2, odds: 9.9 } },
  );
  const strong = race({ race_id: "2026-11-03-06-01" }, { 4: { odds: 80 } });
  const absent = race(
    { race_id: "2026-11-03-07-01", absent: true },
    { 4: { win_rate: 2, odds: 90 } },
  );
  const cancelled = race(
    { race_id: "2026-11-03-08-01", cancelled: true },
    { 4: { win_rate: 2, odds: 90 } },
  );
  const noRace = race(
    { race_id: "2026-11-03-09-01", no_race: true },
    { 4: { win_rate: 2, odds: 90 } },
  );
  const noOdds = race(
    { race_id: "2026-11-03-10-01" },
    { 4: { win_rate: 2, odds: 0 } },
  );
  const noTech = race(
    { race_id: "2026-11-03-11-01", technique: null },
    { 4: { win_rate: 2, odds: 90 } },
  );
  const list = candidates([
    a,
    b,
    c,
    d,
    low,
    strong,
    absent,
    cancelled,
    noRace,
    noOdds,
    noTech,
  ]);
  assert.deepEqual(
    list.map((x) => x.race.race_id),
    [
      "2026-11-03-04-01",
      "2026-11-03-03-01",
      "2026-11-03-02-01",
      "2026-11-03-01-01",
    ],
  );
  assert.equal(
    list.find((x) => x.race.race_id === "2026-11-03-05-01"),
    undefined,
    "9.9倍は外す",
  );
  assert.equal(pickUpset([low, strong, absent]), null);
  assert.equal(
    candidates([race({}, { 4: { win_rate: 2, odds: 10 } })]).length,
    1,
    "ちょうど10倍は入る",
  );
});

test("3コマ目の項目（展示タイム → モーター → 勝率の最初）・1コマ目の項目（表に列のある弱さ、2つまで）・表の列。展示 ST は弱さに入れない", () => {
  assert.equal(primaryOf(["win_rate", "exhibition_time"]), "exhibition_time");
  assert.equal(primaryOf(["win_rate", "motor_2rate"]), "motor_2rate");
  assert.equal(primaryOf(["win_rate"]), "win_rate");
  assert.equal(primaryOf(["start_timing"]), null);
  assert.deepEqual(
    hookMetrics(["win_rate", "exhibition_time"], "exhibition_time"),
    ["win_rate", "exhibition_time"],
  );
  // 3つとも弱さ: 3コマ目は展示タイム、モーターは表に列が無いので1コマ目に出さない
  assert.deepEqual(
    hookMetrics(
      ["win_rate", "exhibition_time", "motor_2rate"],
      "exhibition_time",
    ),
    ["win_rate", "exhibition_time"],
  );
  assert.deepEqual(hookMetrics(["motor_2rate"], "motor_2rate"), [
    "motor_2rate",
  ]);
  assert.deepEqual(hookMetrics(["win_rate", "motor_2rate"], "motor_2rate"), [
    "win_rate",
    "motor_2rate",
  ]);
  // 展示 ST が最下位でも弱さにしない（F の記録が 2026-09 からしかそろっていない）
  const allF = Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((b) => [
      b,
      { st_flag: null, start_timing: b === 4 ? 0.3 : 0.1 },
    ]),
  );
  assert.deepEqual(weaknessesOf(race({}, allF)), []);
  assert.deepEqual(tableMetrics("exhibition_time"), [
    "win_rate",
    "exhibition_time",
  ]);
  assert.deepEqual(tableMetrics("motor_2rate"), [
    "win_rate",
    "exhibition_time",
    "motor_2rate",
  ]);
});

test("直近1年: レースの日を含む365日の日ごとの [n, k] の和。1日でも欠けた・k>n・整数でない日は null。dayCounts は比べたレースと最下位の1着を項目ごとに数える", () => {
  const days = {};
  for (let d = "2025-11-04"; d <= "2026-11-03"; d = addDays(d, 1))
    days[d] = [100, 10];
  assert.deepEqual(sumDays(days, { from: "2025-11-04", to: "2026-11-03" }), {
    n: 36500,
    k: 3650,
  });
  assert.equal(
    sumDays(
      { ...days, "2026-01-01": undefined },
      { from: "2025-11-04", to: "2026-11-03" },
    ),
    null,
  );
  assert.equal(
    sumDays(
      { ...days, "2026-01-01": [1, 2] },
      { from: "2025-11-04", to: "2026-11-03" },
    ),
    null,
  );
  assert.equal(
    sumDays(
      { ...days, "2026-01-01": [1.5, 1] },
      { from: "2025-11-04", to: "2026-11-03" },
    ),
    null,
  );
  const c = dayCounts([
    race({}, { 4: { win_rate: 2 } }),
    race({ rank1: 1 }, { 4: { win_rate: 2 } }),
    race({ absent: true }, { 4: { win_rate: 2 } }),
    race({}, { 2: { motor_2rate: 0 } }),
  ]);
  // 1つ目は最下位の4号艇が1着、2つ目は1号艇が1着、3つ目は欠場で数えない、4つ目は1号艇が最下位で4号艇が1着
  assert.deepEqual(c.win_rate, [3, 1]);
  assert.deepEqual(c.motor_2rate, [2, 1]); // 0 の艇があるレースは比べない（2つ目は1号艇が最下位で1着）
});

test("DB の行 → 形: 名前の空白を詰め、展示の F・L を持ち、単勝の 0 は「無い」、中止・不成立・欠場を見分ける（shapeDay・shapeRace）", () => {
  const r = shapeDay({
    races: [
      {
        race_id: "2026-11-03-17-10",
        race_date: "2026-11-03",
        venue_code: 17,
        race_number: 10,
        race_grade: "ippan",
        cancellation_status: null,
      },
    ],
    results: [
      {
        race_id: "2026-11-03-17-10",
        rank1: 4,
        winning_technique: "まくり",
        is_cancelled: false,
        is_no_race: false,
        race_status: "normal",
      },
    ],
    entries: [1, 2, 3, 4, 5, 6].map((b) => ({
      race_id: "2026-11-03-17-10",
      boat_number: b,
      player_name: "鈴木　　柊介",
      grade: "B1",
      win_rate: "3.28",
      motor_2rate: 16.67,
      is_absent: false,
    })),
    exhibition: [1, 2, 3, 4, 5, 6].map((b) => ({
      race_id: "2026-11-03-17-10",
      boat_number: b,
      exhibition_time: 6.88,
      start_timing: 0.12,
      start_flag: b === 6 ? "L" : "F",
      is_absent: false,
    })),
    odds: [
      {
        race_id: "2026-11-03-17-10",
        win_all: { 1: 2, 2: 17.3, 3: 1.5, 4: 34.7, 5: 9.4, 6: 0 },
      },
    ],
  })[0];
  assert.equal(r.venue, "宮島");
  assert.equal(r.boats[0].racer, "鈴木柊介");
  assert.equal(r.boats[0].win_rate, 3.28);
  assert.equal(r.boats[0].st_flag, "F");
  assert.equal(r.boats[5].st_flag, "L");
  assert.equal(r.boats[5].odds, 0);
  assert.equal(r.cancelled || r.no_race || r.absent, false);
  const nr = shapeRace({
    race: {
      race_id: "x",
      venue_code: 1,
      race_number: 1,
      cancellation_status: null,
    },
    result: { race_status: "no_race" },
  });
  assert.equal(nr.no_race, true);
  const ab = shapeRace({
    race: {
      race_id: "x",
      venue_code: 1,
      race_number: 1,
      cancellation_status: null,
    },
    entries: [{ boat_number: 1, is_absent: true }],
  });
  assert.equal(ab.absent, true);
});

test("見本（2026-11-03 宮島10R、本番の値）: 検査を通り、見本の3コマ（hq b1〜b3）と同じ文・数になる。題と1コマ目に配当の円が無い", () => {
  assert.deepEqual(check(SAMPLE), []);
  const t = SAMPLE.texts;
  assert.deepEqual(t.hook, ["勝率も展示も", "6艇で最下位"]);
  assert.equal(t.hook_em, "それでも1着");
  assert.equal(t.hook_who, "4号艇 鈴木柊介 B1");
  assert.equal(t.hook_odds, "単勝34.7倍");
  assert.equal(t.header, "宮島10R 11/3（火）");
  assert.deepEqual(t.table_head, ["艇", "選手", "級", "勝率", "展示", "単勝"]);
  assert.deepEqual(t.table_rows[3], [
    "4",
    "鈴木柊介",
    "B1",
    "3.28",
    "6.88",
    "34.7",
  ]);
  assert.deepEqual(
    t.table_rows[5].slice(-1),
    ["—"],
    "単勝の欠けは —（見本と同じ）",
  );
  assert.equal(t.result, "4号艇がまくって1着");
  assert.equal(t.cond, "展示タイムが6艇で一番遅い艇の1着");
  assert.equal(t.one_in, "およそ10回に1回");
  assert.equal(t.tie, "（同じタイムの最下位を含む）");
  assert.equal(t.table_note, "赤＝6艇で最下位　—＝記録なし");
  // DB のデータは 2025-12-02 から。窓の頭の0の日はデータの前として外し、「直近1年」と言わない
  assert.equal(SAMPLE.year.window_from, "2025-11-04");
  assert.equal(SAMPLE.year.from, "2025-12-02");
  assert.match(t.year_n, /^2025\/12\/2以降 [\d,]+レース中$/);
  assert.match(SAMPLE.voice.result, /2025年12月2日以降/);
  assert.equal(
    SAMPLE.youtube.title,
    "宮島10R 単勝34.7倍の鈴木柊介B1が1着 勝率も展示タイムも6艇で最下位だった｜ボートレース",
  );
  assert.match(
    SAMPLE.youtube.description,
    /^ボートレース 宮島10R 11\/3（火）の結果の振り返り\n/,
  );
  const sec = timeline(SAMPLE).total / 30;
  assert.ok(sec >= 25 && sec <= 35, `${sec}`);
});

test("直近1年の範囲: 窓の頭からデータがあれば「直近1年」。窓の中ほどに比べたレースが0の日があれば、データの欠けとして止める", () => {
  const full = clone(SAMPLE);
  for (const d of Object.keys(full.year.days))
    if (full.year.days[d][0] === 0) full.year.days[d] = [100, 10];
  const sum = sumDays(full.year.days, {
    from: full.year.window_from,
    to: full.year.to,
  });
  full.year = { ...full.year, from: full.year.window_from, n: sum.n, k: sum.k };
  full.texts = screensOf(full);
  assert.match(full.texts.year_n, /^直近1年 /);
  const gap = clone(SAMPLE);
  gap.year.days["2026-06-01"] = [0, 0];
  const s2 = sumDays(gap.year.days, {
    from: gap.year.window_from,
    to: gap.year.to,
  });
  gap.year.n = s2.n;
  gap.year.k = s2.k;
  assert.match(check(gap).join(), /2026-06-01 の比べたレースが0/);
  const early = clone(SAMPLE);
  early.year.from = early.year.window_from;
  assert.match(check(early).join(), /範囲/);
});

test("検査: 文・数・題・説明欄を値から作り直して照らす。値を1つ変えた・文を書き換えた・円・禁止語・日ごとの和の食い違い・尺の外は止める", () => {
  const changed = (f) => {
    const b = clone(SAMPLE);
    f(b);
    return check(b);
  };
  assert.match(changed((b) => (b.texts.year_k = "5,336回")).join(), /texts/);
  assert.match(changed((b) => (b.boats[3].odds = 9.5)).join(), /10倍以上/);
  assert.match(
    changed((b) => (b.boats[3].win_rate = 3.95)).join(),
    /弱さが値と合わない/,
  );
  assert.match(changed((b) => (b.year.k += 1)).join(), /日ごとの和/);
  assert.match(
    changed((b) => (b.year.days["2026-01-01"] = [100, 200])).join(),
    /欠けている/,
  );
  assert.match(
    changed((b) => (b.youtube.title = `${b.youtube.title}（3,470円）`)).join(),
    /題が値から作った文と違う/,
  );
  assert.match(
    changed((b) => (b.voice.result = `${b.voice.result}次も狙い目`)).join(),
    /声の文/,
  );
  assert.match(
    changed((b) => (b.primary = "win_rate")).join(),
    /3コマ目の項目/,
  );
  assert.match(changed((b) => (b.boats[2].class = "")).join(), /級/);
  assert.match(changed((b) => (b.boats[2].racer = "仲道 大輔")).join(), /空白/);
  assert.match(changed((b) => (b.race_date = "2026-11-02")).join(), /前日/);
  assert.match(changed((b) => (b.pages.result.sec = 30)).join(), /尺/);
  assert.match(changed((b) => (b.pages.hook.sec = 4.5)).join(), /1コマ目/);
  assert.match(changed((b) => delete b.pages.table).join(), /声の table/);
  // 値を変えて作り直した bundle（buildBundle）は通るが、禁止語の入った決まり手は通らない
  const b2 = clone(SAMPLE);
  b2.technique = "必ず当たる";
  assert.match(check(b2).join(), /決まり手/);
});

test("検査: 文の型に禁止語・射幸心・次の予想・因果の語が入れば止める（作った文は全部通る）", () => {
  const b = clone(SAMPLE);
  // 型の外の文を通さないことは上で見た。ここでは型の文そのものに禁止語が無いこと（risk-rules とこの型の語）
  assert.deepEqual(check(b), []);
  for (const w of [
    "万舟",
    "儲か",
    "稼げる",
    "狙い",
    "予想",
    "買い目",
    "だから",
    "競艇",
  ]) {
    const t = clone(SAMPLE);
    t.boats[0].racer = `岩下${w}`;
    t.texts = screensOf(t);
    t.youtube = { ...t.youtube, title: titleOf(t) };
    assert.ok(
      check(t).some((r) => /禁止/.test(r)),
      w,
    );
  }
});

test("1日の数から作り直す: buildBundle は日ごとの数が欠けていれば投げ、そろえば見本と同じ bundle を作る", () => {
  const raceRow = raceOfSample();
  const rebuilt = buildBundle({
    race: raceRow,
    days: SAMPLE.year.days,
    date: SAMPLE.date,
    asOf: SAMPLE.as_of,
    sendTime: SAMPLE.send_time,
  });
  for (const k of [
    "texts",
    "voice",
    "youtube",
    "year",
    "weaknesses",
    "primary",
    "hook_metrics",
    "table_metrics",
  ])
    assert.deepEqual(rebuilt[k], SAMPLE[k], k);
  assert.throws(
    () =>
      buildBundle({
        race: raceRow,
        days: {},
        date: SAMPLE.date,
        asOf: SAMPLE.as_of,
      }),
    /そろっていない/,
  );
  assert.deepEqual(weaknessesOf(raceRow), ["win_rate", "exhibition_time"]);
});

test("章の秒: 1コマ目は3秒（声が長ければ声＋0.3秒）、合計が25秒に満たなければ2・3コマ目を延ばす", () => {
  const p = pageSeconds({ hook: 2.5, table: 5, result: 10 });
  assert.equal(p.hook, 3);
  assert.ok(Math.abs(p.hook + p.table + p.result - 25) < 0.02);
  const q = pageSeconds({ hook: 3.5, table: 7, result: 14 });
  assert.equal(q.hook, 3.8);
  assert.ok(q.hook + q.table + q.result > 25);
});

// ---------- 送る口（PGlite） ----------

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const saved = [];
let dbRace = null;

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  await db.exec(`
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT, race_grade VARCHAR, race_number SMALLINT);
    CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);
    CREATE TABLE race_entries(race_id VARCHAR, is_absent BOOLEAN);
    CREATE TABLE exhibition_data(race_id VARCHAR, is_absent BOOLEAN);`);
  const files = [...BASE_FILES, MIGRATION];
  for (const [i, file] of files.entries()) {
    const guard = GUARDS[file];
    await db.exec(
      guard
        ? await guardedForTest(file, files.slice(0, i), guard[0], guard[1])
        : forTest(await sqlOf(file)),
    );
  }
});
const setClock = async (date) => {
  await db.query("UPDATE test_clock SET value=$1", [date.toISOString()]);
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  await db.exec(
    "UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
  );
};
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=false, research_image_enabled=false, today_thinking_enabled=false,
      setsu_kiryoku_short_enabled=false, setsu_kiryoku_enabled=false, upset_win_short_enabled=(channel='youtube');
    UPDATE sns_x_send_control SET paused=false, timing_approved=true, max_source_age_seconds=14400, expiry_minutes=30, daily_limit_x=9, daily_limit_youtube=10,
      daily_external_count=0, period_start=test_now() - interval '1 day', period_end=test_now() + interval '30 days', budget_microusd=20000000,
      reserved_microusd=0, attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000;
    UPDATE sns_youtube_quota_control SET verified=true, upload_limit=100, general_limit=10000, external_uploads=0, external_general=0;`);
  await setClock(PUSHED_AT);
  saved.length = 0;
  dbRace = raceOfSample();
});
after(() => db.close());

const store = {
  controls: async () =>
    Object.fromEntries(
      (
        await all(
          "SELECT channel, mode, dry_run, auto_approver_id, upset_win_short_enabled FROM sns_auto_send_control",
        )
      ).map((r) => [r.channel, r]),
    ),
  sendControl: () =>
    first(
      "SELECT daily_limit, daily_limit_youtube, daily_baseline_date::text, daily_external_count, expiry_minutes, max_source_age_seconds FROM sns_x_send_control",
    ),
  upsetItems: (date) =>
    all(
      "SELECT id, state, draft_id, race_id, held_reason FROM sns_auto_send_items WHERE kind='upset_win_short' AND race_id LIKE $1 ORDER BY created_at DESC",
      [`upset:${date}:%`],
    ),
  raceOf: async () => dbRace,
  jobForDraft: (draftId) =>
    first(
      "SELECT id, draft_id, state, error_code, scheduled_at::text, expires_at::text, posted_at, external_post_id, external_post_url FROM sns_x_send_jobs WHERE draft_id=$1",
      [draftId],
    ),
  jobsAttemptedOn: (day) =>
    all(
      "SELECT id, state, attempt_dates::text[] attempt_dates, attempt_channels FROM sns_x_send_jobs WHERE $1::date = ANY(attempt_dates)",
      [day],
    ),
  queuedYoutubeJobs: (now) =>
    all(
      "SELECT id, draft_id, scheduled_at::text FROM sns_x_send_jobs WHERE channel='youtube' AND state='queued' AND attempts=0 AND expires_at > $1",
      [now.toISOString()],
    ),
  quotaControl: () =>
    first(
      "SELECT verified, baseline_day::text, upload_limit, general_limit, external_uploads, external_general FROM sns_youtube_quota_control",
    ),
  quotaUsed: async (day) => {
    const a = await first(
      "SELECT coalesce(sum(upload_reserved),0)::int u, coalesce(sum(general_reserved),0)::int g FROM sns_youtube_quota_attempts WHERE quota_day=$1",
      [day],
    );
    const r = await first(
      "SELECT coalesce(sum(units),0)::int n FROM sns_youtube_quota_reads WHERE quota_day=$1",
      [day],
    );
    return { uploads: a.u, general: a.g + r.n };
  },
  saveFile: async (p, bytes) => saved.push([p, bytes.byteLength]),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,publish_blocked,
        publication_hold_reasons,send_lane,scheduled_at,video_storage_path,source_data)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        row.content_group_id,
        row.platform,
        row.language,
        row.status,
        row.format,
        row.title,
        row.caption_text,
        row.hashtags,
        row.publish_blocked,
        JSON.stringify(row.publication_hold_reasons),
        row.send_lane,
        row.scheduled_at,
        row.video_storage_path,
        row.source_data,
      ],
    ),
  insertItem: (row) =>
    first(
      `INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        row.kind,
        row.variant,
        row.draft_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
        row.checks,
        row.notified_at,
        row.stop_token_hash,
      ],
    ),
  updateItem: async (id, from, patch) => {
    const row = await first(
      "UPDATE sns_auto_send_items SET state=$3, stopped_at=$4, stopped_via=$5, held_reason=$6 WHERE id=$1 AND state=$2 RETURNING *",
      [
        id,
        from,
        patch.state,
        patch.stopped_at ?? null,
        patch.stopped_via ?? null,
        patch.held_reason ?? null,
      ],
    );
    if (!row) throw new Error(`item ${id} を更新できない`);
    return row;
  },
  updateDraft: (id, patch) =>
    first("UPDATE sns_drafts SET publish_blocked=$2 WHERE id=$1 RETURNING *", [
      id,
      patch.publish_blocked,
    ]),
  approve: async (a) =>
    (
      await first("SELECT public.approve_sns_x_send($1,$2,$3,$4) r", [
        a.p_draft_id,
        a.p_approver_id,
        a.p_snapshot,
        a.p_scheduled_at,
      ])
    ).r,
};

const push = (b = bundle(), opts = {}, video = VIDEO) => {
  const f = {
    "/f/bundle.json": new TextEncoder().encode(JSON.stringify(b)),
    ...(video ? { "/f/upset_win.mp4": video } : {}),
  };
  const notes = [];
  return pushUpsetWinShort("/f", {
    store,
    readBytes: async (p) => {
      if (!f[p]) throw Object.assign(new Error("no file"), { code: "ENOENT" });
      return f[p];
    },
    notify: async (text) => notes.push(text),
    riskRules,
    now: PUSHED_AT,
    ...opts,
  }).then((r) => ({ ...r, notes }));
};
const transition = (jobId, action, result = {}) =>
  first("SELECT public.transition_sns_x_send($1,$2,$3::jsonb) r", [
    jobId,
    action,
    JSON.stringify(result),
  ]).then((row) => row.r);
const counts = async () => ({
  drafts: Number((await first("SELECT count(*) n FROM sns_drafts")).n),
  items: Number((await first("SELECT count(*) n FROM sns_auto_send_items")).n),
  jobs: Number((await first("SELECT count(*) n FROM sns_x_send_jobs")).n),
  saved: saved.length,
});
const NOTHING = { drafts: 0, items: 0, jobs: 0, saved: 0 };
const theJob = () => first("SELECT * FROM sns_x_send_jobs");

const likeOf = (p) =>
  decodeURIComponent(p.match(/race_id=like\.([^&]+)/)[1]).replace("*", "%");
const readCurrent = createReadCurrent({
  db: async (p) => {
    const table = p.split("?")[0];
    const draftId = p.match(/(?:^|[?&])(?:id|draft_id)=eq\.([0-9a-f-]+)/)?.[1];
    if (table === "sns_drafts")
      return all(
        "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_items" && p.includes("state=eq.sent"))
      return all(
        "SELECT id FROM sns_auto_send_items WHERE kind='upset_win_short' AND channel='youtube' AND race_id LIKE $1 AND state='sent'",
        [likeOf(p)],
      );
    if (table === "sns_auto_send_items")
      return all(
        "SELECT kind, race_id FROM sns_auto_send_items WHERE draft_id=$1",
        [draftId],
      );
    if (table === "sns_auto_send_control")
      return all(
        "SELECT upset_win_short_enabled FROM sns_auto_send_control WHERE channel='youtube'",
      );
    if (table === "races")
      return dbRace
        ? [{ cancellation_status: dbRace.cancelled ? "confirmed" : null }]
        : [];
    if (table === "race_results")
      return dbRace ? [{ rank1: dbRace.rank1, is_cancelled: false }] : [];
    throw new Error(`読み直しの path が想定の外: ${p}`);
  },
});
const sonarHeadless = () =>
  createMockHeadless({ visibleSelectors: SCREEN_MARKERS["race-sonar"] });
const preflightAt = (now, headless = sonarHeadless()) =>
  createDeadlinePreflight({
    headless,
    markers: SCREEN_MARKERS,
    readCurrent,
    now: () => now.getTime(),
  });

test("198 の土台: 194 の transition_sns_send_139 の本文の md5 が本番（2026-11-04 の読み取り）と一致し、198 は1つの ELSIF（と注記）だけを足す", async () => {
  const s194 = bodyOf(
    await sqlOf("194_sns_setsu_kiryoku_x.sql"),
    "transition_sns_send_139",
  );
  const s198 = bodyOf(await sqlOf(MIGRATION), "transition_sns_send_139");
  assert.equal(md5(s194), MD5_194);
  const a = s194.split("\n");
  const b = s198.split("\n");
  assert.deepEqual(
    a.filter((l) => !b.includes(l)),
    [],
    "194 の行は1行も消さない",
  );
  const added = b.filter((l) => !a.includes(l));
  assert.equal(added.length, 2, added.join("\n"));
  assert.match(added[0], /^\s+-- 198:/);
  assert.match(
    added[1],
    /ELSIF v_kind='upset_win_short' AND \(SELECT upset_win_short_enabled FROM public\.sns_auto_send_control WHERE channel='youtube'\) IS NOT TRUE THEN reason:='upset_win_short_disabled';/,
  );
  console.log(`MD5_198（適用後の本番の md5(prosrc) の期待）: ${md5(s198)}`);
});

test("198: upset_win_short の item は YouTube・variant=main・race_id は upset:{日}:{race_id} だけ。1日1本（別のレースも、送った後も入らない）。許可は既定 false・youtube の行だけ", async () => {
  const insert = (channel, raceId, variant = "main") =>
    db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $1, 'ja', 'upset_win_short', '198') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state)
       SELECT 'upset_win_short', $3, id, $1, $2, test_now()+interval '3h', test_now(), test_now()+interval '1h', 'checking' FROM draft`,
      [channel, raceId, variant],
    );
  await assert.rejects(insert("x", UPSET_ID), /kind_source/);
  await assert.rejects(
    insert("youtube", `upset:${DAY}:2026-11-03-25-10`),
    /upset_id/,
  );
  await assert.rejects(
    insert("youtube", `upset:${DAY}:2026-11-03-17-13`),
    /upset_id/,
  );
  await assert.rejects(
    insert("youtube", UPSET_ID, "shorts"),
    /variant_scope|upset_id/,
  );
  await insert("youtube", UPSET_ID);
  await assert.rejects(
    insert("youtube", `upset:${DAY}:2026-11-03-01-01`),
    /upset_day/,
  );
  await db.exec(
    `UPDATE sns_auto_send_items SET state='sent', checks='{"passed":true}'`,
  );
  await assert.rejects(
    insert("youtube", `upset:${DAY}:2026-11-03-01-01`),
    /upset_day/,
  );
  await db.exec("UPDATE sns_auto_send_items SET state='held_manual'");
  await insert("youtube", `upset:${DAY}:2026-11-03-01-01`);
  await insert("youtube", `upset:${addDays(DAY, 1)}:2026-11-04-01-01`);
  await assert.rejects(
    db.exec(
      "UPDATE sns_auto_send_control SET upset_win_short_enabled=true WHERE channel='x'",
    ),
    /youtube_only/,
  );
  const col = await first(
    "SELECT column_default FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='upset_win_short_enabled'",
  );
  assert.equal(col.column_default, "false");
  assert.deepEqual(parseUpsetId(UPSET_ID), {
    date: DAY,
    raceId: SAMPLE.race_id,
  });
  assert.equal(parseUpsetId(`upset:${DAY}:2026-11-03-17-13`), null);
});

test("許可が off なら、検査が通っても何も書かない（disabled・exit 3）。--dry-run も書かない（exit 0）", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
  );
  const off = await push();
  assert.equal(off.disabled, true, JSON.stringify(off.reasons));
  assert.deepEqual(off.notes, []);
  assert.equal(resultLine(off).code, 3);
  await db.exec(
    "UPDATE sns_auto_send_control SET upset_win_short_enabled=(channel='youtube')",
  );
  const dry = await push(bundle(), { dryRun: true });
  assert.equal(dry.dryRun, true, JSON.stringify(dry.reasons));
  assert.equal(resultLine(dry).code, 0);
  assert.deepEqual(await counts(), NOTHING);
});

test("許可が on・mode=auto: 動画1本の YouTube の job を送る時刻（07:15）の予定に入れる。題・説明欄は bundle の値のまま、リンク先の確認は龍神ソナーの頁", async () => {
  const r = await push();
  assert.ok(r.job_id, JSON.stringify(r));
  assert.equal(new Date(r.send_at).toISOString(), at("07:15:00").toISOString());
  const d = await first("SELECT * FROM sns_drafts");
  assert.equal(d.title, SAMPLE.youtube.title);
  assert.equal(d.caption_text, SAMPLE.youtube.description);
  assert.equal(d.format, "upset_win_short");
  assert.equal(
    d.source_data.deadline_queue.public_url,
    `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
  );
  assert.equal(d.source_data.deadline_queue.screen_key, "race-sonar");
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.deepEqual(
    [item.kind, item.race_id, item.state],
    ["upset_win_short", UPSET_ID, "notified"],
  );
  const job = await theJob();
  assert.equal(
    new Date(job.expires_at).toISOString(),
    at("08:15:00").toISOString(),
  );
  assert.equal(r.notes.length, 1);
  assert.equal(resultLine(r).code, 0);
});

test("画面の数字と DB の照合: そのレースの6艇の値・1着・決まり手・単勝が DB と違えば、また中止・欠場があれば受け取らない", async () => {
  for (const [f, re] of [
    [(r) => (r.boats[3].odds = 34.8), /4号艇の odds/],
    [(r) => (r.boats[0].exhibition_time = 6.83), /1号艇の exhibition_time/],
    [(r) => (r.boats[1].racer = "別人"), /2号艇の racer/],
    [(r) => (r.rank1 = 1), /1着/],
    [(r) => (r.technique = "差し"), /決まり手/],
    [(r) => (r.absent = true), /欠場/],
    [(r) => (r.cancelled = true), /中止/],
  ]) {
    dbRace = raceOfSample();
    f(dbRace);
    const r = await push();
    assert.match((r.reasons ?? []).join(), re);
  }
  dbRace = null;
  assert.match((await push()).reasons.join(), /DB に無い/);
  assert.deepEqual(await counts(), NOTHING);
  assert.deepEqual(raceReasons(SAMPLE, raceOfSample()), []);
});

test("時刻: 送る時刻は 07:00〜07:50、送る時刻の15分前より早い受け取り・今日でない日・送る時刻が8時を過ぎるものは受け取らない", async () => {
  assert.match(
    (await push(bundle({ send_time: "08:00" }))).reasons.join(),
    /send_time/,
  );
  assert.match(
    (await push(bundle({ send_time: "06:59" }))).reasons.join(),
    /send_time/,
  );
  assert.match(
    (
      await push(bundle({ send_time: "07:30" }), { now: at("07:10:00") })
    ).reasons.join(),
    /15分前/,
  );
  assert.match(
    (
      await push(bundle(), { now: at("07:03:00", addDays(DAY, 1)) })
    ).reasons.join(),
    /今日/,
  );
  // 7:59 に受け取ると送る時刻は今＋2分の 8:01（7時台でない）
  assert.match(
    (await push(bundle(), { now: at("07:59:00") })).reasons.join(),
    /7時台/,
  );
  assert.deepEqual(await counts(), NOTHING);
  // 見本の束（date が今日でない）を dry-run で見ると、その日の送る時刻の2分前の時計
  assert.equal(
    dryRunClock(SAMPLE, new Date("2030-01-01T00:00:00Z")).toISOString(),
    at("07:13:00").toISOString(),
  );
});

test("この口の検査: 説明欄のリンクはちょうど1つでそのレースの龍神ソナーの頁（tab=sonar・utm_* だけ）。題100字・改行・< >", () => {
  const ok = descriptionLink(SAMPLE.youtube.description, SAMPLE.race_id);
  assert.deepEqual(ok, {
    url: `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
    reasons: [],
  });
  assert.match(
    descriptionLink(
      "https://www.boat-ai.jp/race/2026-11-03-17-11?tab=sonar",
      SAMPLE.race_id,
    ).reasons.join(),
    /龍神ソナー/,
  );
  assert.match(
    descriptionLink(
      `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar&x=1`,
      SAMPLE.race_id,
    ).reasons.join(),
    /龍神ソナー/,
  );
  assert.match(
    descriptionLink(
      `https://www.boat-ai.jp/race/${SAMPLE.race_id}`,
      SAMPLE.race_id,
    ).reasons.join(),
    /龍神ソナー/,
  );
  assert.match(
    descriptionLink(
      "a https://x.com b https://www.boat-ai.jp/",
      SAMPLE.race_id,
    ).reasons.join(),
    /ちょうど1つ/,
  );
  assert.deepEqual(checkUpsetBundle(SAMPLE, riskRules), []);
  assert.match(
    checkUpsetBundle({ ...clone(SAMPLE), video: "x.mp4" }, riskRules).join(),
    /video/,
  );
});

test("claim: 送る時刻に sending になり、YouTube のクォータ（1 upload・104 units）を予約する。許可を off にすると held（upset_win_short_disabled）。節の機力の許可には当たらない", async () => {
  await push();
  const job = await theJob();
  await assert.rejects(
    transition(job.id, "claim"),
    /veto_window_open|claimできません/,
  );
  await setClock(new Date(Date.parse(job.scheduled_at)));
  // 節の機力の許可が off でも止まらない
  assert.equal(
    (
      await first(
        "SELECT setsu_kiryoku_short_enabled v FROM sns_auto_send_control WHERE channel='youtube'",
      )
    ).v,
    false,
  );
  const claimed = await transition(job.id, "claim");
  assert.equal(claimed.state, "sending");
  const quota = await first(
    "SELECT upload_reserved, general_reserved FROM sns_youtube_quota_attempts WHERE job_id=$1",
    [job.id],
  );
  assert.deepEqual([quota.upload_reserved, quota.general_reserved], [1, 104]);
  await db.exec(
    "DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET state='queued', attempts=0, attempt_dates='{}', attempt_channels='{}', lease_until=NULL, locked_at=NULL",
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
  );
  const held = await transition(job.id, "claim");
  assert.deepEqual(
    [held.state, held.error_code],
    ["held", "upset_win_short_disabled"],
  );
});

test("送る: 送る時刻に動画を YouTube に上げて公開し、item が sent・状態に動画の URL が出る。同じ日の2本目は作らない（exit 4）。送り手の読み直しは許可・同じ日に送ったか・item を見る", async () => {
  await push();
  const job = await theJob();
  const sendAt = new Date(Date.parse(job.scheduled_at));
  await setClock(sendAt);
  const youtube = createMockYoutubeAdapter({
    videoId: "upsetvideo1",
    postedAt: sendAt.toISOString(),
  });
  const headless = sonarHeadless();
  const done = await runYoutubeQueueJob(job.id, {
    store: { transition: (id, action, r = {}) => transition(id, action, r) },
    youtube,
    loadMedia: async () => VIDEO,
    preflight: preflightAt(sendAt, headless),
  });
  assert.equal(done.state, "posted", done.error_code);
  assert.ok(
    headless.calls.length > 0 &&
      headless.calls.every(
        (c) =>
          c.url === `https://www.boat-ai.jp/race/${SAMPLE.race_id}?tab=sonar`,
      ),
  );
  assert.equal(
    (await first("SELECT state FROM sns_auto_send_items")).state,
    "sent",
  );
  const status = await upsetStatus(DAY, { store });
  assert.deepEqual(
    [status.upset_id, status.item_state, status.job_state, status.video_id],
    [UPSET_ID, "sent", "posted", "upsetvideo1"],
  );
  const again = await push(bundle(), { now: at("07:20:00") });
  assert.equal(again.already, true);
  assert.equal(resultLine(again).code, 4);
  // 送った後の読み直しは「同じ日に送った」で止める
  const draft = await first("SELECT id FROM sns_drafts");
  await assert.rejects(readCurrent(draft.id), /upset_already_sent_today/);
});

test("二重送信: 同じ束を2回入れても2本目は作らない。送らずに終わった（held）job は作り直す（前の item を stopped（superseded）にする）", async () => {
  await push();
  const second = await push(bundle(), { now: at("07:04:00") });
  assert.equal(second.already, true);
  assert.equal((await counts()).jobs, 1);
  await db.exec(
    "UPDATE sns_x_send_jobs SET state='held', error_code='deadline_expired'",
  );
  const third = await push(bundle(), { now: at("07:05:00") });
  assert.ok(third.job_id, JSON.stringify(third));
  const items = await all(
    "SELECT state, stopped_via FROM sns_auto_send_items ORDER BY created_at",
  );
  assert.deepEqual(
    items.map((i) => [i.state, i.stopped_via]),
    [
      ["stopped", "superseded"],
      ["notified", null],
    ],
  );
});

test("送り手の読み直し（readCurrent）: 許可が off・item の kind が違えば投げる。通れば欠場・中止は false、版は下書きの値", async () => {
  await push();
  const draft = await first("SELECT id, source_data FROM sns_drafts");
  const cur = await readCurrent(draft.id);
  assert.deepEqual(cur, {
    withdrawn: false,
    cancelled: false,
    deadline_at: draft.source_data.deadline_queue.deadline_at,
    source_revision: draft.source_data.upset_win_short.revision,
  });
  // 1着の訂正・中止を読み直す
  dbRace.rank1 = 1;
  await assert.rejects(readCurrent(draft.id), /upset_result_changed/);
  dbRace.rank1 = SAMPLE.rank1;
  dbRace.cancelled = true;
  assert.equal((await readCurrent(draft.id)).cancelled, true);
  dbRace.cancelled = false;
  await db.exec(
    "UPDATE sns_auto_send_control SET upset_win_short_enabled=false",
  );
  await assert.rejects(readCurrent(draft.id), /upset_win_short_disabled/);
  await db.exec(
    "UPDATE sns_auto_send_control SET upset_win_short_enabled=(channel='youtube')",
  );
  await db.exec(
    `ALTER TABLE sns_auto_send_items DROP CONSTRAINT sns_auto_send_items_upset_id; UPDATE sns_auto_send_items SET race_id='upset:${DAY}:2026-11-03-01-01'`,
  );
  await assert.rejects(readCurrent(draft.id), /upset_item_mismatch/);
  await db.exec(`DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_auto_send_items ADD CONSTRAINT sns_auto_send_items_upset_id CHECK (
      kind <> 'upset_win_short' OR (race_id ~ '^upset:[0-9]{4}-[0-9]{2}-[0-9]{2}:[0-9]{4}-[0-9]{2}-[0-9]{2}-(0[1-9]|1[0-9]|2[0-4])-(0[1-9]|1[0-2])$' AND variant = 'main'))`);
});

test("YouTube の日の上限: ちょうど入る数は通し、1本多ければ受け取らない（節の機力と同じ数え方）", async () => {
  await db.exec(
    "UPDATE sns_x_send_control SET daily_limit_youtube=1, daily_external_count=0",
  );
  assert.ok((await push()).job_id);
  await db.exec(`DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_x_send_control SET daily_limit_youtube=1, daily_external_count=1`);
  assert.match((await push()).reasons.join(), /日の上限/);
});

test("動画の検査: 無い・横は受け取らない", async () => {
  assert.match((await push(bundle(), {}, null)).reasons.join(), /無い/);
  assert.match(
    (
      await push(bundle(), {}, mp4({ width: 1920, height: 1080 }))
    ).reasons.join(),
    /縦/,
  );
});

test("龍神ソナーの頁の印（snsScreenMarkers の race-sonar）は画面の部品に実在する data-testid", async () => {
  for (const sel of SCREEN_MARKERS["race-sonar"]) {
    const id = sel.match(/data-testid="([^"]+)"/)[1];
    const { execFileSync } = await import("node:child_process");
    const hit = execFileSync(
      "git",
      ["grep", "-l", `data-testid="${id}"`, "--", "src"],
      { encoding: "utf8" },
    );
    assert.ok(hit.trim().length > 0, id);
  }
});
