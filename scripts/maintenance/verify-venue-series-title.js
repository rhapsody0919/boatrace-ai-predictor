#!/usr/bin/env node
/**
 * src/utils/venueSeriesTitle.js（会場ページの title に入れる節タイトル）の判定を固定の入力で検証する。
 *
 * 崩れると、一般戦の会場ページの title に節タイトルが入る（検索結果の見出しが長くなり、狙いの語が
 * 後ろへ押し出される）か、SG・G1 開催中なのに入らない（開催週の検索需要を取り逃す）。
 */
import { getVenueSeriesTitle } from "../../src/utils/venueSeriesTitle.js";

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const race = (raceGrade, raceTitle) => ({ raceGrade, raceTitle });

check(
  "SGは節タイトルを入れ、全角数字を半角にする",
  getVenueSeriesTitle([race("SG", "第７２回ボートレースメモリアル")]),
  "第72回ボートレースメモリアル",
);
check(
  "G1も入れる（全角スペースは半角に）",
  getVenueSeriesTitle([race("G1", "開設７４周年記念　ツッキー王座決定戦")]),
  "開設74周年記念 ツッキー王座決定戦",
);
check(
  "G2は入れない",
  getVenueSeriesTitle([race("G2", "モーターボート大賞")]),
  null,
);
check(
  "G3は入れない",
  getVenueSeriesTitle([race("G3", "オールレディース")]),
  null,
);
check(
  "一般戦は入れない",
  getVenueSeriesTitle([race("ippan", "日刊スポーツ杯")]),
  null,
);
check(
  "グレード不明（null）は入れない",
  getVenueSeriesTitle([race(null, "何かの杯")]),
  null,
);
check(
  "節タイトルが無いSGは null",
  getVenueSeriesTitle([race("SG", null)]),
  null,
);
check(
  "節タイトルが空白だけのSGは null",
  getVenueSeriesTitle([race("SG", "　 ")]),
  null,
);
check("レースが無い（非開催）は null", getVenueSeriesTitle([]), null);
check("undefined は null", getVenueSeriesTitle(undefined), null);
check(
  "代表値は先頭レース（VenueGridCard と同じ）",
  getVenueSeriesTitle([race("ippan", "一般"), race("SG", "SG名")]),
  null,
);

if (failures.length > 0) {
  console.error(
    `❌ verify-venue-series-title: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-venue-series-title: ${checked} 件すべて通過`);
