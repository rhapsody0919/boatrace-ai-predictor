/** BOA-1061: 期別成績の純関数を手書きHTMLで検証する。通信・DB・実時刻は使わない。 */
import assert from "node:assert/strict";
import {
  getSeasonStatsUrl,
  isRacerPageNotFound,
  derivePeriodLabel,
  parseSeasonStatsHtml,
} from "../lib/racerSeasonStats.js";

let failures = 0;
let checks = 0;
function test(name, run) {
  checks++;
  try {
    run();
    console.log(`OK ${name}`);
  } catch (error) {
    failures++;
    console.error(`NG ${name}: ${error.message}`);
  }
}

// 期待値は対象モジュールのコメントと FIELD_KEY_MAP に基づく固定値。
test("getSeasonStatsUrl: 登録番号4320の公式URL", () => {
  assert.equal(
    getSeasonStatsUrl(4320),
    "https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=4320",
  );
});

test("isRacerPageNotFound: 本文の存在しないページ文言", () => {
  assert.equal(
    isRacerPageNotFound("<p>データが存在しないのでページを表示できません</p>"),
    true,
  );
});
for (const input of ["<p>期別成績</p>", "", null, undefined, 4320]) {
  test(`isRacerPageNotFound: ${String(input)} はfalse`, () => {
    assert.equal(isRacerPageNotFound(input), false);
  });
}

for (const [input, expected] of [
  ["2026-04-30", "2026-second"],
  ["2025-10-31", "2026-first"],
  ["2026-05-01", null],
  [null, null],
  ["", null],
  ["2026-04", null],
]) {
  test(`derivePeriodLabel: ${String(input)} → ${String(expected)}`, () => {
    assert.equal(derivePeriodLabel(input), expected);
  });
}

test("parseSeasonStatsHtml: 成績テーブルが無ければnull", () => {
  assert.equal(parseSeasonStatsHtml("<div class='table1'></div><table></table>"), null);
});

const html = `
<div class="text"><p class="h-alignR">集計期間：2025/11/01-2026/04/30</p></div>
<div class="table1"><table><tbody>
<tr><th>勝率</th><td>6.87</td><th>2連対率</th><td>54.30%</td></tr>
<tr><th>3連対率</th><td>70.10%</td><th>出走回数</th><td>116回</td></tr>
<tr><th>優出回数</th><td>5回</td><th>優勝回数</th><td>0回</td></tr>
<tr><th>平均スタートタイミング</th><td>0.15</td><th>フライング回数</th><td>1回</td></tr>
<tr><th>出遅れ回数（選手責任）</th><td>-</td><th>能力指数</th><td>56</td></tr>
<tr><th>1着</th><td>34.5%（40回）</td><th>2着</th><td>19.8%（23回）</td></tr>
<tr><th>3着</th><td>15.5%（18回）</td><th>4着</th><td>12.1%（14回）</td></tr>
<tr><th>5着</th><td>0.0%（0回）</td><th>6着</th><td>-</td></tr>
</tbody></table></div>`;

test("parseSeasonStatsHtml: 集計期間・数値全欄・1〜6着の率と回数", () => {
  assert.deepEqual(parseSeasonStatsHtml(html), {
    periodStart: "2025-11-01",
    periodEnd: "2026-04-30",
    periodLabel: "2026-second",
    winRate: 6.87,
    rentai2Rate: 54.3,
    rentai3Rate: 70.1,
    starts: 116,
    finalistCount: 5,
    winCount: 0,
    avgStartTiming: 0.15,
    flyingCount: 1,
    falseStartCount: null,
    abilityIndex: 56,
    placeRates: { 1: 34.5, 2: 19.8, 3: 15.5, 4: 12.1, 5: 0, 6: null },
    placeCounts: { 1: 40, 2: 23, 3: 18, 4: 14, 5: 0, 6: null },
  });
});

// 想定外の終了日の運用は呼び出し元がログする決まりだけで、パーサーの仕様は未定。
// 仕様未定の入力は assert せず、観測値を出す。
const KNOWN_GAPS = [
  {
    input: "集計期間：2025/11/01-2026/04/29（上のHTMLの終了日を置換）",
    specification: "未定（終了日が月末以外の場合のパーサーの扱い）",
    actual: parseSeasonStatsHtml(html.replace("2026/04/30", "2026/04/29"))
      .periodLabel,
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`);
for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
console.log(`${checks - failures}/${checks}件成功`);
if (failures > 0) process.exitCode = 1;
