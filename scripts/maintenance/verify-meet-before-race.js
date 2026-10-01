/**
 * verify-meet-before-race.js — 表示中レースより前の「今節」の切り出しの回帰テスト（BOA-591）。
 *
 * `src/utils/meetGrouping.js` の `groupIntoMeetBeforeRace` は、直前情報タブの
 * 「今節展示情報」（`getRacerMeetExhibitionTrendBefore`）と今節タブ
 * （`basicInfoStats.buildMeetResults`）が「今節のこれまでの走」を決めるのに使う。
 *
 * 旧実装の `getRacerMeetExhibitionTrendBefore` は選手＋モーター番号で引いた走を
 * そのまま `groupIntoCurrentMeet` に渡していた。モーター番号は会場ごとに振られる
 * ので別会場の同じ番号のモーターの節が混ざり、しかも「表示中レースより前の最後の
 * まとまり」を返すため、節の初戦で何ヶ月も前の節を今節として拾っていた。
 *
 * 1 の入力の race_id は**本番DBに実在したもの**（2026-09-21 津1R の2号艇4499・
 * 6号艇5439を、モーター番号で引いた直前の走）。実Supabaseへは接続しないので tier=ci。
 */
import { groupIntoMeetBeforeRace } from "../../src/utils/meetGrouping.js";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}: expected ${e}, got ${a}`);
  }
}

const ids = (entries) => entries.map((e) => e.race_id);
const rows = (raceIds) => raceIds.map((race_id) => ({ race_id }));

// ---- 1. 節の初戦・前の節は別会場（BOA-591 の実データ） ------------------------
// 2026-09-21 津(09)1R 2号艇 4499。モーター29で引くと、直前は2ヶ月前の蒲郡(07)の節。
// 旧実装はこれを「今節」として 前走6.74 を出していた
const RACER_4499_MOTOR29 = rows([
  "2026-07-03-07-11",
  "2026-07-04-07-05",
  "2026-07-05-07-05",
  "2026-07-05-07-12",
  "2026-07-06-07-09",
]);
check(
  "節の初戦で、別会場・前の節（蒲郡 07-03〜07-06）を拾わない",
  ids(groupIntoMeetBeforeRace(RACER_4499_MOTOR29, "2026-09-21-09-01")),
  [],
);

// 6号艇 5439、モーター53。直前は宮島(17)の 05-28〜05-30
const RACER_5439_MOTOR53 = rows([
  "2026-05-28-17-01",
  "2026-05-28-17-08",
  "2026-05-29-17-08",
  "2026-05-30-17-02",
  "2026-05-30-17-07",
]);
check(
  "節の初戦で、別会場・前の節（宮島 05-28〜05-30）を拾わない",
  ids(groupIntoMeetBeforeRace(RACER_5439_MOTOR53, "2026-09-21-09-01")),
  [],
);

// ---- 2. 別会場の節が地続き（間2日以内）でも繋げない ------------------------------
check(
  "直前の別会場の節が2日以内でも混ぜない",
  ids(
    groupIntoMeetBeforeRace(
      rows([
        "2026-09-17-16-03",
        "2026-09-18-16-05", // 別会場の同じ番号のモーター
        "2026-09-20-09-02", // 今節（津）の前日
        "2026-09-20-09-09",
      ]),
      "2026-09-21-09-01",
    ),
  ),
  ["2026-09-20-09-02", "2026-09-20-09-09"],
);

// ---- 3. 同じ会場でも、前の節（間が空いた）は拾わない ------------------------------
check(
  "同じ会場の前の節（間が2日を超える）は拾わない",
  ids(
    groupIntoMeetBeforeRace(
      rows(["2026-08-10-09-04", "2026-08-11-09-06"]),
      "2026-09-21-09-01",
    ),
  ),
  [],
);

// ---- 4. 節の途中: 今節の走だけを昇順で返し、表示中・後のレースを含めない ---------
check(
  "節の途中では今節の走だけ（表示中のレースと同じ日の後のレースは含めない）",
  ids(
    groupIntoMeetBeforeRace(
      rows([
        "2026-09-23-09-12", // 表示中より後
        "2026-09-22-09-03",
        "2026-09-21-09-01",
        "2026-09-22-09-10", // 表示中そのもの
        "2026-09-22-09-11", // 同じ日の後のレース
        "2026-07-06-07-09", // 別会場
      ]),
      "2026-09-22-09-10",
    ),
  ),
  ["2026-09-21-09-01", "2026-09-22-09-03"],
);

// ---- 5. 入力の要素そのものを返す（呼び出し側が boat_number 等を使う） -------------
const withBoat = [{ race_id: "2026-09-21-09-01", boat_number: 2 }];
check(
  "入力の要素（boat_number 付き）をそのまま返す",
  groupIntoMeetBeforeRace(withBoat, "2026-09-22-09-03"),
  withBoat,
);

// ---- 6. 異常な入力 ---------------------------------------------------------------
check("空の入力は空", groupIntoMeetBeforeRace([], "2026-09-21-09-01"), []);
check(
  "配列でなければ空",
  groupIntoMeetBeforeRace(null, "2026-09-21-09-01"),
  [],
);
check(
  "目印が無ければ空",
  groupIntoMeetBeforeRace(rows(["2026-09-21-09-01"]), undefined),
  [],
);

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全件成功");
