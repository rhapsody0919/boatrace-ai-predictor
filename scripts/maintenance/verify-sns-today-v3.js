// /today の X 投稿の型 v3「今日はこれだけ」（BOA-1314、scripts/lib/snsTodayDigestV3.js）の再現テスト。外部接続なし。
// 本文の4つの日（一般・SG/G1 の優勝戦・優勝戦も準優も無い・グレードの開催が無い）、何日目（画面の関数と同じ・欠けた日目の補い・
// 丸一日中止）、選び方（率の順・同じ率は締切の早い方・走数の足切りと下げ・同じ選手とレースの重複なし・欠場・送る時刻より前）、
// 材料の読み方（1000行ずつ・使う組み合わせだけ）、検査
import { test } from "node:test";
import assert from "node:assert/strict";
import { getJaT } from "../../api/_lib/botPage.js";
import {
  V3_MIN_RUNS,
  buildTodayDigestV3,
  checkTodayDigestV3,
  loadTodayV3Material,
  v3DateLine,
} from "../lib/snsTodayDigestV3.js";

const t = await getJaT();
const DATE = "2037-11-05";
const URL_C = `https://www.boat-ai.jp/x/today?d=${DATE}-c`;
const id = (venue, r) =>
  `${DATE}-${String(venue).padStart(2, "0")}-${String(r).padStart(2, "0")}`;

/**
 * 材料の組み立て。venues: { code: { grade, title, kind, start, end, stage: {R: 段}, day: {R: 日目}, final: {R: bool}, times: {R: "HH:MM"}, cancelled } }
 * 選手は艇ごとに racer_id = code*1000 + R*10 + 艇番。率は stats で上書き（既定は足切りに届かない走数）
 */
function material({
  venues,
  stats = [],
  absent = [],
  exhibition = [],
  cancelledBefore = [],
}) {
  const races = [];
  const conditions = [];
  const entries = [];
  const series = [];
  for (const [codeText, v] of Object.entries(venues)) {
    const code = Number(codeText);
    series.push({
      venue_code: code,
      start_date: v.start ?? "2037-11-02",
      end_date: v.end ?? "2037-11-07",
      title: v.title ?? `一般戦${code}`,
      grade: v.grade === "ippan" || !v.grade ? "ippan" : v.grade,
      kind: v.kind ?? "ippan",
    });
    for (let r = 1; r <= 12; r += 1) {
      const raceId = id(code, r);
      races.push({
        race_id: raceId,
        venue_code: code,
        race_number: r,
        start_time: `${v.times?.[r] ?? `${String(8 + r).padStart(2, "0")}:${String(code).padStart(2, "0")}`}:00`,
        race_grade: v.grade ?? "ippan",
        cancellation_status: v.cancelled ? "confirmed" : null,
      });
      conditions.push({
        race_id: raceId,
        race_stage: v.stage?.[r] ?? "予選",
        series_day: v.day?.[r] ?? null,
        is_final_day: v.final?.[r] ?? null,
        race_title: v.title ?? null,
      });
      for (let b = 1; b <= 6; b += 1)
        entries.push({
          race_id: raceId,
          boat_number: b,
          racer_id: code * 1000 + r * 10 + b,
          player_name: `選手\u3000${code}-${r}-${b}`,
          grade: b === 1 ? "A1" : "B1",
          is_absent: absent.includes(`${raceId}:${b}`),
        });
    }
  }
  return {
    date: DATE,
    races,
    conditions,
    entries,
    exhibition: exhibition.map((k) => {
      const [race_id, b] = k.split(":");
      return { race_id, boat_number: Number(b) };
    }),
    series,
    stats,
    cancelledBefore,
  };
}
const stat = (venue, r, boat, values) => ({
  racer_id: venue * 1000 + r * 10 + boat,
  course: boat,
  runs: 40,
  nige_rate: null,
  makuri_rate: null,
  nigashi_rate: null,
  ...values,
});
const build = (m, sendAt = "07:00") =>
  buildTodayDigestV3(m, { sendAt, t, url: URL_C });

// 一般の日: 丸亀の優勝戦（一般）・大村の優勝戦（一般）・桐生の準優（10〜12R）・下関の G2・若松のオールレディース（G3）
const GENERAL = {
  venues: {
    15: { stage: { 12: "優勝戦" }, times: { 12: "16:35" }, day: { 1: 6 } },
    24: { stage: { 12: "優勝戦" }, times: { 12: "20:45" } },
    1: {
      stage: { 10: "準優勝戦", 11: "準優勝戦", 12: "準優勝戦" },
      times: { 10: "19:52", 11: "20:22", 12: "20:52" },
      day: { 1: 5 },
    },
    19: { grade: "G2", title: "モーターボート大賞", day: { 3: 3 } },
    20: {
      grade: "G3",
      title: "オールレディース",
      kind: "lady",
      start: "2037-11-04",
    },
    2: {},
  },
  stats: [
    stat(24, 10, 1, { nige_rate: 85.71, runs: 56 }),
    stat(2, 4, 1, { nige_rate: 80.0, runs: 60 }),
    stat(2, 4, 2, { nigashi_rate: 72.4, runs: 41 }),
    stat(4, 7, 4, { makuri_rate: 31.0, runs: 38 }),
    stat(1, 7, 4, { makuri_rate: 31.0, runs: 38 }),
  ],
};

test("一般の日: 1〜3行目が日付と場の数・🏆 優勝戦・リンク。【優勝戦】【準優勝戦】【開催中】の後に罫線で囲んだ率の3塊", () => {
  const out = build(material(GENERAL));
  assert.equal(out.ok, true, out.reason);
  assert.equal(
    out.text,
    [
      "11月5日（木）今日のボートレース 6場",
      "🏆 優勝戦 丸亀12R 16:35締切",
      `全レースの一覧 → ${URL_C}`,
      "",
      "【優勝戦】大村12R 20:45締切",
      "【準優勝戦】桐生10〜12R 19:52／20:22／20:52締切",
      "【開催中】G2 モーターボート大賞 下関3日目",
      "【開催中】G3 オールレディース 若松2日目",
      "",
      "━━━━━━━━━━",
      "【逃げ率が高い選手】",
      "選手 24-10-1 A1\u300086%（56走）",
      "▶ 大村10R 1号艇 18:24締切",
      "",
      "【1号艇が逃げやすいレース】",
      "戸田4R 12:02締切",
      "1号艇 選手 2-4-1 A1／2号艇の逃し率 72%（41走）",
      "",
      "【まくり率が高い選手】",
      "選手 1-7-4 B1\u300031%（38走）",
      "▶ 桐生7R 4号艇 15:01締切",
      "━━━━━━━━━━",
      "※逃し率＝2コースに入ったとき、1コースの艇の逃げで決まった割合",
      "#ボートレース",
    ].join("\n"),
  );
  assert.deepEqual(
    checkTodayDigestV3(out.text, { date: DATE, url: URL_C }),
    [],
  );
  assert.deepEqual(out.featured, { race_id: id(15, 12), boat_number: null });
  // 送る直前に読み直す対象: 書いた優勝戦・準優（艇番 null）と、率の塊の艇（逃し率は1号艇と2号艇）
  assert.deepEqual(out.picks, [
    { race_id: id(15, 12), boat_number: null },
    { race_id: id(24, 12), boat_number: null },
    { race_id: id(1, 10), boat_number: null },
    { race_id: id(1, 11), boat_number: null },
    { race_id: id(1, 12), boat_number: null },
    { race_id: id(24, 10), boat_number: 1 },
    { race_id: id(2, 4), boat_number: 1 },
    { race_id: id(2, 4), boat_number: 2 },
    { race_id: id(1, 7), boat_number: 4 },
  ]);
});

test("SG・G1 の優勝戦がある日: 1行目は大会名・最終日（会場）、🏆 はその優勝戦。他の優勝戦は【優勝戦】に並べ、3つを超えたら「ほか◯場」", () => {
  const m = material({
    venues: {
      20: {
        grade: "SG",
        title: "ＢＯＡＴＲＡＣＥダービー",
        stage: { 12: "優勝戦" },
        times: { 12: "16:40" },
      },
      15: { stage: { 12: "優勝戦" }, times: { 12: "16:35" } },
      24: { stage: { 12: "優勝戦" }, times: { 12: "20:45" } },
      18: { grade: "G3", stage: { 12: "優勝戦" }, times: { 12: "16:50" } },
    },
  });
  const out = build(m);
  const lines = out.text.split("\n");
  // 大会名は NFKC（全角の英字を半角に）。日目は画面と同じ「最終日」（優勝戦のある日）
  assert.equal(lines[0], "11月5日（木）BOATRACEダービー 最終日（若松）");
  assert.equal(lines[1], "🏆 優勝戦 若松12R 16:40締切");
  // 並びは SG→G1→G2→G3→一般、同じ格は締切の早い順。🏆 を含めて3つまで
  assert.equal(
    lines[4],
    "【優勝戦】徳山12R 16:50締切／丸亀12R 16:35締切（ほか1場）",
  );
  assert.deepEqual(
    checkTodayDigestV3(out.text, { date: DATE, url: URL_C }),
    [],
  );
  assert.equal(out.summary.big_final, true);
});

test("優勝戦も準優も無い日: 2行目は最初と最後の締切（送る時刻より後のレースだけ）。【準優勝戦】は出さない。準優だけの日も2行目は締切", () => {
  const m = material({
    venues: {
      18: { times: { 1: "06:50", 2: "08:42" } },
      1: { times: { 12: "20:52" } },
    },
  });
  const out = build(m);
  const lines = out.text.split("\n");
  assert.equal(lines[0], "11月5日（木）今日のボートレース 2場");
  assert.equal(lines[1], "最初の締切 8:42 徳山2R・最後 20:52 桐生12R");
  assert.doesNotMatch(out.text, /【準優勝戦】|【優勝戦】|🏆/);
  assert.equal(out.featured, null);
  // 最初と最後のレースも送る直前に読み直す
  assert.deepEqual(
    out.picks.filter((p) => p.boat_number === null).map((p) => p.race_id),
    [id(18, 2), id(1, 12)],
  );
  const semi = build(
    material({ venues: { 1: { stage: { 11: "準優勝戦", 12: "準優勝戦" } } } }),
  );
  assert.match(semi.text.split("\n")[1], /^最初の締切 /);
  assert.match(
    semi.text,
    /【準優勝戦】桐生11・12R 19:01／20:01締切\n\n#ボートレース$/,
  );
});

test("グレードの開催が無い日は【開催中】を出さない。率の塊が1つも無い日は罫線ごと出さず、逃し率の注も出さない", () => {
  const out = build(material({ venues: { 1: {}, 2: {} } }));
  assert.doesNotMatch(out.text, /【開催中】|━|※逃し率/);
  assert.deepEqual(out.text.split("\n").slice(3), ["", "#ボートレース"]);
  assert.deepEqual(
    checkTodayDigestV3(out.text, { date: DATE, url: URL_C }),
    [],
  );
});

test("何日目: race_conditions の日目が無ければ節の開始日から補う。節の中に中止があれば補わない。初日・最終日。丸一日中止の場は出さない", () => {
  const base = {
    venues: {
      19: { grade: "G1", title: "下関記念", start: "2037-11-03" },
      20: { grade: "G2", title: "若松記念", start: "2037-11-05" },
      4: { grade: "G3", title: "平和島の企業杯", final: { 5: true } },
      2: { grade: "G1", title: "戸田記念", cancelled: true },
    },
  };
  const out = build(material(base));
  assert.match(out.text, /【開催中】G1 下関記念 下関3日目/);
  assert.match(out.text, /【開催中】G2 若松記念 若松初日/);
  // 最終日の印はレースごとに入る時点がずれる。どれか1レースでも最終日なら最終日（画面のトップの会場カードと同じ）
  assert.match(out.text, /【開催中】G3 平和島の企業杯 平和島最終日/);
  assert.doesNotMatch(out.text, /戸田/);
  assert.match(out.text, /今日のボートレース 3場/);
  // 節の中（前の日）に中止があれば、引き算の日目はずれるので出さない（BOA-501）
  const cut = build(
    material({
      ...base,
      cancelledBefore: [{ venue_code: 19, race_date: "2037-11-04" }],
    }),
  );
  assert.match(cut.text, /【開催中】G1 下関記念 下関$/m);
});

test("選び方: 率の高い順、同じ率は締切の早い方。走数30未満は外し、無ければ10まで下げる。同じ選手・同じレースは2回出さない", () => {
  // 逃げ: 30走以上の最高は 80%（戸田4R）。90% は29走で外す
  const m = material({
    venues: { 2: {}, 4: {} },
    stats: [
      stat(2, 4, 1, { nige_rate: 80, runs: 30 }),
      stat(4, 3, 1, { nige_rate: 90, runs: V3_MIN_RUNS - 1 }),
      // 逃し率の最高は戸田4R（逃げで使ったレース）なので、次の平和島5R
      stat(2, 4, 2, { nigashi_rate: 90, runs: 50 }),
      stat(4, 5, 2, { nigashi_rate: 70, runs: 50 }),
      // まくり: 同じ率なら締切の早い方（戸田6R 15:02 より平和島6R 15:04 が遅い）
      stat(4, 6, 3, { makuri_rate: 30, runs: 40 }),
      stat(2, 6, 4, { makuri_rate: 30, runs: 40 }),
    ],
  });
  const out = build(m);
  assert.deepEqual(
    out.blocks.map((b) => [b.key, b.race_id, b.rate, b.runs]),
    [
      ["nige", id(2, 4), 80, 30],
      ["nigashi", id(4, 5), 70, 50],
      ["makuri", id(2, 6), 30, 40],
    ],
  );
  // 30走以上が誰もいなければ10走まで下げる。10走未満しかいなければ塊を出さない
  const low = build(
    material({
      venues: { 2: {} },
      stats: [
        stat(2, 4, 1, { nige_rate: 70, runs: 12 }),
        stat(2, 5, 3, { makuri_rate: 40, runs: 9 }),
      ],
    }),
  );
  assert.deepEqual(
    low.blocks.map((b) => [b.key, b.runs]),
    [["nige", 12]],
  );
  assert.doesNotMatch(low.text, /まくり率/);
  // 逃げの選手が逃し率の1号艇と同じ人にならない（別のレースでも同じ選手は2回出さない）
  const same = material({
    venues: { 2: {} },
    stats: [
      stat(2, 4, 1, { nige_rate: 80, runs: 40 }),
      stat(2, 5, 2, { nigashi_rate: 80, runs: 40 }),
      stat(2, 6, 2, { nigashi_rate: 60, runs: 40 }),
    ],
  });
  for (const e of same.entries)
    if (e.race_id === id(2, 5) && e.boat_number === 1)
      e.racer_id = 2000 + 4 * 10 + 1;
  assert.deepEqual(
    build(same).blocks.map((b) => [b.key, b.race_id]),
    [
      ["nige", id(2, 4)],
      ["nigashi", id(2, 6)],
    ],
  );
});

test("選び方: 欠場の艇（出走表・展示）・中止のレース・締切が送る時刻より前のレースは選ばない。逃し率は1号艇が欠場のレースを選ばない", () => {
  const m = material({
    venues: { 2: { times: { 1: "06:55" } }, 4: { cancelled: true } },
    stats: [
      stat(2, 1, 1, { nige_rate: 99, runs: 40 }),
      stat(4, 2, 1, { nige_rate: 98, runs: 40 }),
      stat(2, 3, 1, { nige_rate: 97, runs: 40 }),
      stat(2, 5, 1, { nige_rate: 96, runs: 40 }),
      stat(2, 6, 1, { nige_rate: 50, runs: 40 }),
      stat(2, 7, 2, { nigashi_rate: 90, runs: 40 }),
      stat(2, 8, 2, { nigashi_rate: 60, runs: 40 }),
    ],
    absent: [`${id(2, 3)}:1`, `${id(2, 7)}:1`],
    exhibition: [`${id(2, 5)}:1`],
  });
  const out = build(m);
  assert.deepEqual(
    out.blocks.map((b) => [b.key, b.race_id]),
    [
      ["nige", id(2, 6)],
      ["nigashi", id(2, 8)],
    ],
  );
  assert.match(out.text, /今日のボートレース 1場/);
  // 載せられるレースが無い日は作らない
  assert.deepEqual(build(material({ venues: { 2: {} } }), "23:59"), {
    ok: false,
    reason: "no_live_races",
  });
  assert.deepEqual(build(material({ venues: { 2: { cancelled: true } } })), {
    ok: false,
    reason: "no_races",
  });
  assert.throws(() => build(material({ venues: { 2: {} } }), "7:00"), /HH:MM/);
});

test("検査: 1行目の日付・2行目・3行目のリンク・リンクは1つ・置き換え漏れ・「競艇」・最後のタグ・長文の加重", () => {
  const ok = build(material(GENERAL)).text;
  const check = (text) => checkTodayDigestV3(text, { date: DATE, url: URL_C });
  assert.deepEqual(check(ok), []);
  assert.deepEqual(check(ok.replace(v3DateLine(DATE), "11月6日（金）")), [
    "line1_date_missing",
  ]);
  assert.deepEqual(
    check(ok.replace("🏆 優勝戦 丸亀12R 16:35締切", "🏆 丸亀")),
    ["line2_invalid"],
  );
  assert.ok(
    check(ok.replace(`→ ${URL_C}`, "→ x")).includes("line3_link_invalid"),
  );
  assert.ok(check(`${ok}\n${URL_C}`).includes("link_count"));
  assert.ok(
    check(ok.replace("86%", "undefined%")).includes("placeholder_left"),
  );
  assert.ok(
    check(ok.replace("【開催中】", "【開催中】https://example.com ")).includes(
      "extra_link",
    ),
  );
  assert.ok(check(ok.replace("モーターボート大賞", "競艇")).includes("kyotei"));
  assert.ok(check(`${ok}\n追記`).includes("tag_missing"));
  assert.ok(
    check(
      ok.replace("#ボートレース", `${"あ".repeat(13000)}\n#ボートレース`),
    ).includes("weighted_text_invalid"),
  );
});

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
