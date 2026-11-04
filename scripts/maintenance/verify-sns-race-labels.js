/**
 * verify-sns-race-labels.js - SNS の「何日目」「大会名（SG・G1）」「締切」の部品の契約（BOA-1309）
 *
 * 外部接続なし（純関数と、偽の get）。
 *
 * 確認すること:
 *   (a) 日目は画面と同じ規則: 自レースに無ければ同じ会場の他レースで補う（BOA-509）・全レース中止確定なら null（BOA-658）・
 *       どれか1レースでも最終日なら最終日・値が無ければ null。文言は getSeriesDayLabel と src/locales/ja/common.json
 *   (b) 大会名は SG・G1 だけ、race_title（無ければ race_series.title）を NFKC
 *   (c) 締切は "HH:MM"
 *   (d) 取得: 同じ会場・同じ日を race_id の like で読み、読み取りの失敗は握りつぶさず投げる
 *   (e) 変異: 自前の文言・補いなし・最終日を自レースだけで判定した版で (a) が落ちる
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSeriesDayLabel } from "../../src/utils/raceDetailHeading.js";
import { isRaceCancelled } from "../../src/utils/raceCancellation.js";
import {
  JA_SERIES_DAY,
  jaSeriesT,
  seriesDayTextOf,
  seriesTitleOf,
} from "../../src/utils/raceSeriesText.js";
import {
  deadlineOf,
  fetchRaceLabels,
  raceLabelsFromRows,
} from "../lib/raceSeriesLabels.js";

// 文言の写しは locales と同じ
{
  const ja = JSON.parse(
    readFileSync(
      new URL("../../src/locales/ja/common.json", import.meta.url),
      "utf8",
    ),
  );
  for (const [key, text] of Object.entries(JA_SERIES_DAY)) {
    const got = key.split(".").reduce((o, k) => o?.[k], ja);
    assert.equal(got, text, `${key} の写しが locales と違う`);
  }
  assert.throws(() => jaSeriesT("raceDetailPage.unknown"), /無いキー/);
}

const R = (n, p = {}) => ({
  raceId: `2026-11-04-24-${String(n).padStart(2, "0")}`,
  raceNumber: n,
  seriesDay: null,
  isFinalDay: null,
  cancellationStatus: null,
  ...p,
});
const ID = (n) => `2026-11-04-24-${String(n).padStart(2, "0")}`;

/** 日目の期待値の一覧（実装を渡して、落ちた件の説明を返す） */
function dayFailures(impl) {
  const cases = [
    [
      "補い（BOA-509）",
      [R(1, { seriesDay: 3, isFinalDay: false }), R(10)],
      ID(10),
      "3日目",
    ],
    ["初日", [R(1, { seriesDay: 1, isFinalDay: false })], ID(1), "初日"],
    [
      "最終日はどれか1レース（1R false・12R true）",
      [
        R(1, { seriesDay: 6, isFinalDay: false }),
        R(12, { seriesDay: 6, isFinalDay: true }),
      ],
      ID(1),
      "最終日",
    ],
    [
      "全レース中止確定（BOA-658）",
      [
        R(1, { seriesDay: 2, cancellationStatus: "confirmed" }),
        R(2, { seriesDay: 2, cancellationStatus: "confirmed" }),
      ],
      ID(1),
      null,
    ],
    ["値が無い", [R(1), R(2)], ID(1), null],
    ["N日目", [R(1, { seriesDay: 4, isFinalDay: false })], ID(1), "4日目"],
    ["対象のレースが無い", [R(1, { seriesDay: 4 })], ID(9), null],
  ];
  return cases.flatMap(([name, races, id, want]) => {
    let got;
    try {
      got = impl(races, id);
    } catch (e) {
      got = `例外: ${e.message}`;
    }
    return got === want
      ? []
      : [`${name}: ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`];
  });
}

assert.deepEqual(dayFailures(seriesDayTextOf), [], "日目の規則");
// 変異（それぞれ (a) が落ちる）
const mutants = {
  自前の文言: (races, id) => {
    const r = races.find((x) => x.raceId === id);
    if (!r || races.every(isRaceCancelled)) return null;
    const d = r.seriesDay ?? races.find((x) => x.seriesDay != null)?.seriesDay;
    return races.some((x) => x.isFinalDay) ? "最終日" : d ? `${d}日目` : null;
  },
  補いなし: (races, id) => {
    const r = races.find((x) => x.raceId === id);
    if (!r || races.every(isRaceCancelled)) return null;
    return getSeriesDayLabel(
      r.seriesDay,
      races.some((x) => x.isFinalDay === true) || r.isFinalDay,
      jaSeriesT,
    );
  },
  最終日を自レースだけ: (races, id) => {
    const r = races.find((x) => x.raceId === id);
    if (!r || races.every(isRaceCancelled)) return null;
    const v = (k) => r[k] ?? races.find((x) => x[k] != null)?.[k] ?? null;
    return getSeriesDayLabel(v("seriesDay"), v("isFinalDay"), jaSeriesT);
  },
  中止を見ない: (races, id) => {
    const r = races.find((x) => x.raceId === id);
    if (!r) return null;
    const v = (k) => r[k] ?? races.find((x) => x[k] != null)?.[k] ?? null;
    return getSeriesDayLabel(
      v("seriesDay"),
      races.some((x) => x.isFinalDay === true) ? true : v("isFinalDay"),
      jaSeriesT,
    );
  },
};
for (const [name, impl] of Object.entries(mutants))
  assert.ok(dayFailures(impl).length > 0, `変異「${name}」を検知できない`);

// 大会名（SG・G1 だけ、NFKC、全角の空白も半角に）
assert.equal(
  seriesTitleOf({ grade: "SG", raceTitle: "第６８回　ボートレースダービー" }),
  "第68回 ボートレースダービー",
);
for (const grade of ["G2", "G3", "ippan", null])
  assert.equal(
    seriesTitleOf({ grade, raceTitle: "第６８回　ボートレースダービー" }),
    null,
    `${grade} は付けない`,
  );
assert.equal(
  seriesTitleOf({
    grade: "G1",
    raceTitle: null,
    seriesTitle: "開設７３周年記念　海の王者決定戦",
  }),
  "開設73周年記念 海の王者決定戦",
  "race_title が無ければ race_series.title",
);
assert.equal(
  seriesTitleOf({ grade: "G1", raceTitle: null, seriesTitle: null }),
  null,
);
assert.equal(
  seriesTitleOf({ grade: "G1", raceTitle: " ", seriesTitle: "節の名前" }),
  "節の名前",
  "空の race_title は節の名前へ落とす",
);

// 締切
assert.equal(deadlineOf("14:37:00"), "14:37");
assert.equal(deadlineOf(null), null);

// 行 → ラベル（純関数）と取得
const rows = {
  races: [
    {
      race_id: ID(1),
      race_date: "2026-11-04",
      venue_code: 24,
      race_number: 1,
      start_time: "10:40:00",
      race_grade: "SG",
      cancellation_status: null,
    },
    {
      race_id: ID(12),
      race_date: "2026-11-04",
      venue_code: 24,
      race_number: 12,
      start_time: "14:37:00",
      race_grade: null,
      cancellation_status: null,
    },
  ],
  race_conditions: [
    {
      race_id: ID(1),
      series_day: 6,
      is_final_day: false,
      race_title: "第６８回　ボートレースダービー",
    },
    { race_id: ID(12), series_day: null, is_final_day: true, race_title: null },
  ],
  race_series: [
    {
      venue_code: 24,
      start_date: "2026-10-30",
      end_date: "2026-11-04",
      title: "ボートレースダービー",
      grade: "SG",
    },
  ],
};
assert.deepEqual(
  raceLabelsFromRows(ID(12), rows),
  {
    raceId: ID(12),
    deadline: "14:37",
    grade: "SG",
    seriesDayText: "最終日",
    seriesTitle: "第68回 ボートレースダービー",
  },
  "グレードは節で、大会名・日目は同じ会場で補う",
);
assert.deepEqual(raceLabelsFromRows(ID(1), { ...rows, race_series: [] }), {
  raceId: ID(1),
  deadline: "10:40",
  grade: "SG",
  seriesDayText: "最終日",
  seriesTitle: "第68回 ボートレースダービー",
});
{
  const queries = [];
  const get = async (table, query) => (
    queries.push([table, query]),
    rows[table]
  );
  const got = await fetchRaceLabels(get, ID(12));
  assert.equal(got.seriesDayText, "最終日");
  assert.deepEqual(queries.map(([t]) => t).sort(), [
    "race_conditions",
    "race_series",
    "races",
  ]);
  for (const [t, q] of queries.filter(([t]) => t !== "race_series"))
    assert.ok(
      q.startsWith(`race_id=like.${encodeURIComponent("2026-11-04-24-*")}&`),
      `${t}: 同じ会場・同じ日を like で読む: ${q}`,
    );
  assert.ok(
    queries
      .find(([t]) => t === "race_series")[1]
      .startsWith(
        "venue_code=eq.24&start_date=lte.2026-11-04&end_date=gte.2026-11-04&",
      ),
  );
  // 読み取りの失敗は投げる（握りつぶして日目なしにしない）
  await assert.rejects(
    fetchRaceLabels(
      async (t) =>
        t === "race_conditions"
          ? Promise.reject(new Error("HTTP 500"))
          : rows[t],
      ID(12),
    ),
    /race_conditions を読めない（HTTP 500）/,
  );
  await assert.rejects(
    fetchRaceLabels(async () => ({ error: "x" }), ID(12)),
    /races を読めない（配列でない応答）/,
  );
  await assert.rejects(
    fetchRaceLabels(get, "2026-11-04-24-99"),
    /races にこのレースが無い/,
  );
  await assert.rejects(fetchRaceLabels(get, "bad"), /race_id の形が違う/);
}

console.log("verify-sns-race-labels: OK");
