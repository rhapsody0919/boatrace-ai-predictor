#!/usr/bin/env node
/**
 * 出走表の複製汚染の復元（BOA-422、scripts/lib/raceEntriesKbRestore.js）の検証。
 * 本番DB・公式サイト・K/Bアーカイブには接続しない（純粋関数のみ）。
 *
 * 守るもの:
 *   - 列ごとの方針（Bファイル由来 / racer_profiles由来 / NULLにする / 触らない）が崩れていないこと。
 *     とくに weight_kg は「Bファイルの登録体重（整数）」と「この列の発走前体重（小数あり）」が
 *     別の量のため、**書かずにNULLにする**。ここが崩れると、系統的に誤った体重が入る
 *   - ai_score_* を書かないこと（当時のモデル出力であり、選手の属性ではない）
 *   - 汚染の判定（艇番→登録番号がBファイルと1つでも食い違えば汚染）
 *   - race_id の組み立て（会場・レース番号とも2桁ゼロ埋め。padStartを外すと、
 *     R1〜R9が別IDになり、12レース中3レースしか照合できなくなる）
 */
import {
  COLUMNS_FROM_B,
  COLUMNS_FROM_PROFILE,
  COLUMNS_TO_NULL,
  buildRaceId,
  buildRestorePlan,
  buildRestoredRow,
  compareRace,
  indexBEntriesByRace,
} from "../lib/raceEntriesKbRestore.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` ${detail}` : ""}`);
  }
};
const show = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------
// 列ごとの方針
// ---------------------------------------------------------------------------
check(
  "race_id は会場・レース番号とも2桁ゼロ埋め",
  buildRaceId("2026-01-09", 4, 1) === "2026-01-09-04-01" &&
    buildRaceId("2026-01-09", 23, 12) === "2026-01-09-23-12",
  show(buildRaceId("2026-01-09", 4, 1)),
);
check(
  "weight_kg は NULL にする列に入っている（Bファイルの登録体重を書かない）",
  COLUMNS_TO_NULL.includes("weight_kg") && !("weight_kg" in COLUMNS_FROM_B),
);
check(
  "3連率4列は NULL にする（Bファイルに無い。N19が後から埋め直す）",
  ["global_3rate", "local_3rate", "motor_3rate", "boat_3rate"].every((c) =>
    COLUMNS_TO_NULL.includes(c),
  ),
);
check(
  "player_name は racer_profiles から取る（Bファイルの詰めた表記を使わない）",
  COLUMNS_FROM_PROFILE.player_name === "name" &&
    !("player_name" in COLUMNS_FROM_B),
);
check(
  "ai_score_* は、どの方針にも入っていない（触らない）",
  ["ai_score_standard", "ai_score_safe_bet", "ai_score_upset_focus"].every(
    (c) =>
      !(c in COLUMNS_FROM_B) &&
      !(c in COLUMNS_FROM_PROFILE) &&
      !COLUMNS_TO_NULL.includes(c),
  ),
);

// ---------------------------------------------------------------------------
// 汚染の判定
// ---------------------------------------------------------------------------
const boats = (ids) => new Map(ids.map((id, i) => [i + 1, { racer_id: id }]));
const bBoats = (ids) =>
  new Map(ids.map((id, i) => [i + 1, { racer_id: id, boat_number: i + 1 }]));

check(
  "全艇一致なら汚染ではない",
  compareRace(boats([1, 2, 3, 4, 5, 6]), bBoats([1, 2, 3, 4, 5, 6]))
    .contaminated === false,
);
check(
  "1艇でも食い違えば汚染",
  compareRace(boats([1, 2, 3, 4, 5, 9]), bBoats([1, 2, 3, 4, 5, 6]))
    .contaminated === true,
);
check(
  "DBに無い艇は分母に数えない",
  (() => {
    const db = new Map([[1, { racer_id: 1 }]]);
    const r = compareRace(db, bBoats([1, 2, 3, 4, 5, 6]));
    return r.total === 1 && r.match === 1 && r.contaminated === false;
  })(),
);

// ---------------------------------------------------------------------------
// 復元行の組み立て
// ---------------------------------------------------------------------------
const bEntry = {
  boat_number: 1,
  racer_id: 3505,
  name: "山田竜一",
  class: "B1",
  age: 54,
  branch: "東京",
  weight: 53,
  national_win_rate: 5.47,
  national_2rate: 35.09,
  local_win_rate: 5.75,
  local_2rate: 36.63,
  motor_number: 26,
  motor_2rate: 30.77,
  boat_id: 43,
  boat_2rate: 28.41,
};
const existing = {
  race_id: "2026-01-09-04-01",
  boat_number: 1,
  racer_id: 9999,
  weight_kg: 47.7,
  global_3rate: 55.5,
  f_count: 1,
  ai_score_standard: 80,
};
const profile = {
  racer_id: 3505,
  name: "山田　　竜一",
  branch: "東京",
  hometown: "東京都",
};

{
  const row = buildRestoredRow(existing, bEntry, profile);
  check(
    "復元行: 主キーを保ち、Bファイル由来の列が入る",
    row.race_id === existing.race_id &&
      row.boat_number === 1 &&
      row.racer_id === 3505 &&
      row.grade === "B1" &&
      row.win_rate === 5.47 &&
      row.global_2rate === 35.09 &&
      row.motor_number === 26 &&
      row.boat_number_id === 43,
    show(row),
  );
  check(
    "復元行: player_name・branch・hometown は racer_profiles の値",
    row.player_name === "山田　　竜一" &&
      row.branch === "東京" &&
      row.hometown === "東京都",
    show(row),
  );
  check(
    "復元行: NULLにする列は、既存に値があっても null になる",
    COLUMNS_TO_NULL.every((c) => row[c] === null),
    show(COLUMNS_TO_NULL.map((c) => [c, row[c]])),
  );
  check(
    "復元行: weight_kg に、Bファイルの登録体重(53)が入らない",
    row.weight_kg === null,
    show(row.weight_kg),
  );
  check(
    "復元行: ai_score_* を含まない（既存値を上書きしない）",
    !("ai_score_standard" in row) &&
      !("ai_score_safe_bet" in row) &&
      !("ai_score_upset_focus" in row),
    show(Object.keys(row)),
  );
}
{
  const row = buildRestoredRow(existing, bEntry, null);
  check(
    "racer_profiles に無い選手は、Bファイルの氏名で代替し、支部・出身地は null",
    row.player_name === "山田竜一" &&
      row.branch === null &&
      row.hometown === null,
    show(row),
  );
}

// ---------------------------------------------------------------------------
// 日単位の組み立て
// ---------------------------------------------------------------------------
const day = {
  date: "2026-01-09",
  b: {
    venues: [
      {
        venue_code: 4,
        races: [
          { race_number: 1, entries: [{ ...bEntry, boat_number: 1 }] },
          {
            race_number: 12,
            entries: [{ ...bEntry, boat_number: 1, racer_id: 4000 }],
          },
        ],
      },
    ],
  },
};
{
  const bIndex = indexBEntriesByRace(day);
  check(
    "Bファイルの索引: race_id が2桁ゼロ埋めで作られる",
    bIndex.has("2026-01-09-04-01") && bIndex.has("2026-01-09-04-12"),
    show([...bIndex.keys()]),
  );

  // R1は汚染（DB 9999 ≠ B 3505）、R12はクリーン（DB 4000 = B 4000）
  const dbIndex = new Map([
    [
      "2026-01-09-04-01",
      new Map([
        [1, { race_id: "2026-01-09-04-01", boat_number: 1, racer_id: 9999 }],
      ]),
    ],
    [
      "2026-01-09-04-12",
      new Map([
        [1, { race_id: "2026-01-09-04-12", boat_number: 1, racer_id: 4000 }],
      ]),
    ],
  ]);
  const profiles = new Map([[3505, profile]]);
  const plan = buildRestorePlan({ bIndex, dbIndex, profiles });
  check(
    "計画: 汚染レースだけを対象にする（クリーンなレースは含めない）",
    plan.races.length === 1 &&
      plan.races[0].race_id === "2026-01-09-04-01" &&
      plan.rows.length === 1,
    show(plan.races),
  );
  check(
    "計画: DBに行が無いレースは対象外",
    buildRestorePlan({ bIndex, dbIndex: new Map(), profiles }).rows.length ===
      0,
  );
  check(
    "計画: limitToRaceIds で対象を絞れる",
    buildRestorePlan({
      bIndex,
      dbIndex,
      profiles,
      limitToRaceIds: new Set(["2026-01-09-04-12"]),
    }).rows.length === 0,
  );
  check(
    "計画: racer_profiles に無い選手を missingProfiles に集める",
    buildRestorePlan({
      bIndex,
      dbIndex,
      profiles: new Map(),
    }).missingProfiles.includes(3505),
  );
}

if (failures > 0) {
  console.error(`\n${failures}件の検証に失敗しました`);
  process.exit(1);
}
console.log("\n全ての検証に成功");
