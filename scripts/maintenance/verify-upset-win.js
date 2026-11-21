// YouTube Shorts【人気薄の1着】（upset_win_short、BOA-1284、マイグレーション 200）の再現テスト。
// 型（sns-video-studio/remotion/src/upsetWin/model.js: 選び・直近1年の和・「およそ{1/p}回に1回」・文・検査）と、
// 送る口（scripts/sns/push-upset-win-short.js）を、PGlite に 189 まで・193・194・200 を当てて、本番と同じ承認（approve_sns_x_send）・
// claim（transition_sns_x_send → transition_sns_send_139）・YouTube の送信（runYoutubeQueueJob、モックの adapter）で通す。
// 外部接続なし。YouTube へは何も送らない。見本の bundle は 2026-11-03 宮島10R の本番の値（作り手で作った）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import { checkBundle, shapeDay, shapeRace, timeline } from "../../sns-video-studio/remotion/src/upsetWin/model.js";

import { upsetIdOf } from "../../api/_lib/snsUpsetWinShort.js";



import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import { runUpsetWinScenes1, runUpsetWinScenes2 } from "./verifyData/upset-win-scenes-1.js";
import { runUpsetWinScenes3 } from "./verifyData/upset-win-scenes-2.js";
import { runUpsetWinScenes4 } from "./verifyData/upset-win-scenes-3.js";
import { runUpsetWinScenes5 } from "./verifyData/upset-win-scenes-4.js";
import { runUpsetWinScenes6 } from "./verifyData/upset-win-scenes-5.js";

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
const MIGRATION = "200_sns_upset_win_short.sql";
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
  start_time: b.start_time,
  series_day: b.series_day,
  is_final_day: b.is_final_day,
  race_title: b.race_title,
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
  start_time: "14:32",
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

// ---- 後半の場面（verifyData/upset-win-scenes-1.js） ----
runUpsetWinScenes1({ SAMPLE, check, clone, race });

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

// ---- 後半の場面（verifyData/upset-win-scenes-1.js） ----
runUpsetWinScenes2({ SAMPLE, check, clone, race });

test("見本（2026-11-03 宮島10R、本番の値）: 検査を通り、見本の3コマ（hq b1〜b3）と同じ文・数になる。題と1コマ目に配当の円が無い", () => {
  assert.deepEqual(check(SAMPLE), []);
  const t = SAMPLE.texts;
  assert.deepEqual(t.hook, ["勝率も展示も", "6艇で最下位"]);
  assert.equal(t.hook_em, "それでも1着");
  assert.equal(t.hook_who, "4号艇 鈴木柊介 B1");
  assert.equal(t.hook_odds, "単勝34.7倍");
  assert.equal(t.header, "11/3（火）宮島10R 3日目 締切14:32");
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
    "11/3（火）宮島10R 締切14:32 単勝34.7倍の鈴木柊介B1が1着 勝率も展示タイムも6艇で最下位だった｜ボートレース",
  );
  assert.match(
    SAMPLE.youtube.description,
    /^ボートレース 11\/3（火）宮島10R 3日目 締切14:32の結果の振り返り\n/,
  );
  const sec = timeline(SAMPLE).total / 30;
  assert.ok(sec >= 25 && sec <= 35, `${sec}`);
});

// ---- 後半の場面（verifyData/upset-win-scenes-2.js・upset-win-scenes-3.js・upset-win-scenes-4.js） ----
runUpsetWinScenes3({ BASE_FILES, MIGRATION, GUARDS, sqlOf, forTest, guardedForTest, SAMPLE, PUSHED_AT, check, clone, raceOfSample });
runUpsetWinScenes4({ MIGRATION, MD5_194, sqlOf, md5, bodyOf, riskRules, SAMPLE, DAY, PUSHED_AT, UPSET_ID, bundle, VIDEO });
runUpsetWinScenes5({ riskRules, SAMPLE, DAY, at, UPSET_ID, clone, bundle, raceOfSample, mp4, VIDEO });

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

// ---- 後半の場面（verifyData/upset-win-scenes-5.js） ----
runUpsetWinScenes6({ at, UPSET_ID, bundle });

test("日ごとの数の読み取り: 結果のそろわない日はそのレースを外して数え、キャッシュに入れない（毎朝止まらない）。レースの無い日もキャッシュに入れない", async () => {
  const { loadDayCounts, readCache } =
    await import("../../sns-video-studio/remotion/scripts/upset-win/materials.mjs");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/upset-cache-`);
  const file = `${dir}/c.json`;
  const r = (id, rank1) => ({
    race_id: id,
    race_date: id.slice(0, 10),
    venue_code: 17,
    race_number: Number(id.slice(-2)),
    race_grade: "ippan",
    cancellation_status: null,
    _rank1: rank1,
  });
  const rows = {
    "2026-11-01": [r("2026-11-01-17-01", 1)],
    "2026-11-02": [r("2026-11-02-17-01", 1), r("2026-11-02-17-02", null)],
    "2026-11-03": [],
  };
  const get = async (table, query) => {
    const day = (decodeURIComponent(query).match(/(\d{4}-\d{2}-\d{2})/) ??
      [])[1];
    const races = rows[day] ?? [];
    if (table === "races") return races;
    if (table === "race_results")
      return races
        .filter((x) => x._rank1)
        .map((x) => ({
          race_id: x.race_id,
          rank1: x._rank1,
          winning_technique: "逃げ",
          race_status: "normal",
        }));
    if (table === "race_entries")
      return races.flatMap((x) =>
        [1, 2, 3, 4, 5, 6].map((b) => ({
          race_id: x.race_id,
          boat_number: b,
          player_name: "a",
          grade: "B1",
          win_rate: 3 + b,
          motor_2rate: 30 + b,
          is_absent: false,
        })),
      );
    return [];
  };
  const out = await loadDayCounts({
    from: "2026-11-01",
    to: "2026-11-03",
    cacheFile: file,
    today: "2026-11-04",
    get,
  });
  assert.deepEqual(out.days["2026-11-01"].win_rate, [1, 1]);
  assert.deepEqual(
    out.days["2026-11-02"].win_rate,
    [1, 1],
    "1着の無いレースは外す",
  );
  assert.deepEqual(out.days["2026-11-03"].win_rate, [0, 0]);
  assert.deepEqual(Object.keys(readCache(file).days), ["2026-11-01"]);
});
