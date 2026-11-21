/**
 * verify-analogy-v16-api.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-v16-api.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { resolveStatus, cacheControl, isRaceId } from "../../../api/_lib/analogyV16.js";
import { layerStatus } from "../../../api/analogy/layer/[raceId].js";
import { withoutSeriesScoreOnFinal } from "../../../api/analogy/facts/[raceId].js";
import { mergeExhibition } from "../../../api/analogy/similar/[raceId].js";
import { exhibitionNeighbors } from "../../lib/analogyV16Exhibition.js";

let check, te, file, nb;
let nbd;

// ---- 4. 状態とキャッシュ ----------------------------------------------------
const st = (o, passed) =>
  resolveStatus(
    { racecard: null, exhibition: null, sixExhibition: false, ...o },
    passed,
  );

const rc = { status: "ok" };

// ---- 5. NCR が優勝戦のときは今節の平均着順点を外す ----------------------------
const facts = { n: 1, by: { 1: { series_score: {}, nat_win: {} } } };

function scene1() {
  check("展示で決まる項目（曇りと晴は近い）", nb[1].items.weather, 1);
  check("結果を付ける", nb[0].finish, [4, 1, 5]);
  check("表示用の値は無ければ付けない", "display" in nb[0], false);
  nbd = exhibitionNeighbors(
    file,
    { neighbors: [{ race_id: "y", d2: 0.25 }] },
    { race: { wind_speed: 1 }, exh_time: [6.8, 6.8, 6.8, 6.8, 6.8, 6.8] },
    {
      columns: {
        nat: [
          [1, 1, 1, 1, 1, 1],
          [2, 2, 2, 2, 2, 2],
        ],
        rn: [3, 7],
      },
    },
  );
  check("表示用の値は候補の位置で付ける", nbd[0].display, {
    nat: [2, 2, 2, 2, 2, 2],
    rn: 7,
  });
  check(
    "今日の展示に風の成分と展示タイムの差",
    Object.keys(te).filter((k) =>
      ["weather_code", "wind_x", "wind_y", "exh_time_diff"].includes(k),
    ),
    ["exh_time_diff", "weather_code", "wind_x", "wind_y"],
  );
  // 展示後の類似レースは、層の情報を出走表の段のファイルから合わせる
  check(
    "展示後の類似レースに層の情報を合わせる",
    mergeExhibition(
      {
        conditions: { round: "yusho" },
        n_layer: 15,
        pool_rate: { venue: 0.04, weather: 0 },
        neighbors: [1],
      },
      { neighbors: [2], exact: true },
    ),
    {
      conditions: { round: "yusho" },
      n_layer: 15,
      pool_rate: { venue: 0.04, weather: 0 },
      neighbors: [2],
      pool_rate_exhibition: false,
      exact: true,
    },
  );
  // 展示で決まる項目の「全レースで同じ割合」は、展示後の段が今日の展示の値で数え直した値にする
  check(
    "展示後の pool_rate は展示後の段の値で上書きする",
    mergeExhibition(
      { pool_rate: { venue: 0.04, weather: 0, wind_bin: 0 }, neighbors: [1] },
      {
        neighbors: [2],
        exact: true,
        pool_rate: { weather: 0.61, wind_bin: 0.497 },
      },
    ),
    {
      pool_rate: { venue: 0.04, weather: 0.61, wind_bin: 0.497 },
      neighbors: [2],
      pool_rate_exhibition: true,
      exact: true,
    },
  );
  check(
    "展示後のファイルが無ければ null",
    mergeExhibition({ n_layer: 1 }, null),
    null,
  );
  check("racecard が無い", st({}, false), "not_saved");
  check("展示前", st({ racecard: rc }, false), "before_exhibition");
  check(
    "展示タイムがそろい並べ直し待ち",
    st({ racecard: rc, sixExhibition: true }, false),
    "exhibition_reflecting",
  );
  check(
    "展示後の段あり",
    st({ racecard: rc, exhibition: { status: "ok" } }, false),
    "exhibition_ready",
  );
  check(
    "締切後も展示後の段が無い",
    st({ racecard: rc, sixExhibition: true }, true),
    "exhibition_missing",
  );
}

function scene2() {
  check(
    "欠場",
    st({ racecard: rc, exhibition: { status: "absent" } }, false),
    "absent",
  );
  check(
    "layer: 層が0件",
    layerStatus({ racecard: { status: "empty_layer" }, exhibition: null }),
    "empty_layer",
  );
  check(
    "layer: 欠場は racecard があっても absent",
    layerStatus({ racecard: rc, exhibition: { status: "absent" } }),
    "absent",
  );
  // 公開前点検 F01: 展示後の段を ok で書いた後や、締切後（展示後の段が書かない）に欠場が分かったレースも absent
  // （spec「時点」Q5。本番の 2026-10-06-02-05 は欠場があるのに exhibition_missing を返していた）
  check(
    "展示後の段 ok の後に欠場が分かった",
    st({ racecard: rc, exhibition: { status: "ok" }, absent: true }, false),
    "absent",
  );
  check(
    "締切後・展示後の段なしで欠場が分かった",
    st({ racecard: rc, absent: true }, true),
    "absent",
  );
  check(
    "layer: 展示後の段 ok の後に欠場が分かったら absent",
    layerStatus({ racecard: rc, exhibition: { status: "ok" }, absent: true }),
    "absent",
  );
  check(
    "キャッシュ: not_saved はしない",
    cacheControl("not_saved", false),
    "no-store",
  );
  check(
    "キャッシュ: 締切前は60秒",
    cacheControl("before_exhibition", false).includes("s-maxage=60"),
    true,
  );
  check(
    "キャッシュ: 締切後は1日",
    cacheControl("exhibition_ready", true).includes("s-maxage=86400"),
    true,
  );
  check(
    "race_id の形",
    [
      isRaceId("2026-10-05-20-12"),
      isRaceId("2026-10-05-20-12x"),
      isRaceId("../x"),
    ],
    [true, false, false],
  );
  check(
    "NCR 優勝戦",
    Object.keys(withoutSeriesScoreOnFinal("NCR:6-0-0-0:1A1:yusho", facts).by[1]),
    ["nat_win"],
  );
  check(
    "NCR 準優勝戦はそのまま",
    Object.keys(withoutSeriesScoreOnFinal("NCR:6-0-0-0:1A1:junyu", facts).by[1]),
    ["series_score", "nat_win"],
  );
  check(
    "VC はそのまま",
    Object.keys(withoutSeriesScoreOnFinal("VC:20:6-0-0-0:1A1", facts).by[1]),
    ["series_score", "nat_win"],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・te・file・nb） */
export function runAnalogyV16ApiScenes1(env) {
  ({ check, te, file, nb } = env);
  scene1();
  scene2();
}
