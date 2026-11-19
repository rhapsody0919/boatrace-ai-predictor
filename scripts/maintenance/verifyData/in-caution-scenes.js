/**
 * verify-in-caution.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-in-caution.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "node:fs";
import path from "node:path";
import { toInCautionRates, computeInCaution } from "../../lib/inCaution.js";

let ROOT, check, same, PREV, tableRows, race, run, five;

function scene1() {
  {
    const ex = run([4.81, 5.12, 6.93, 3.2, 4.0, 5.5]);
    check(
      same(ex, {
        inCaution: {
          pct: 65,
          n: 34842,
          nonWin: 22634,
          level: "high",
          gapCents: -212,
          band: -5,
          round: "other",
          boat1WinRate: 4.81,
          topOtherBoat: 3,
          topOtherWinRate: 6.93,
          basePct: ex.inCaution?.basePct,
          absentBoats: [],
          lowSample: false,
          through: PREV,
          def: "gapband-r-v1",
        },
        skip: null,
      }) && Number.isInteger(ex.inCaution.basePct),
      "(c) 例のレース 2026-10-11 戸田4R: 4.81 と 6.93 → −212 → 帯 −5 → 34,842件・65%・崩れやすい",
      JSON.stringify(ex),
    );
    const skips = [
      run([4.8, ...five], { absent: [1] }).skip,
      run([null, ...five]).skip,
      run(["", ...five]).skip,
      run([4.8, ...five], { absent: [2, 5] }).skip,
      run([4.8, null, null, null, null, null]).skip,
      run([4.8, 5.0, null, null, null, null], { absent: [2] }).skip,
      run([4.8, ...five], { table: null }).skip,
      run([4.8, ...five], { table: toInCautionRates([], PREV) }).skip,
      run([3.0, ...five], { stage: "優勝戦" }).skip, // (yusho, −8) は2件
      run([5.0, 1.0, 1.0, 1.0, 1.0, 1.0], { stage: "準優勝戦" }).skip, // (junyu, 6) はセルが無い
    ];
    check(
      same(skips, [
        "boat1_absent",
        "boat1_no_rate",
        "boat1_no_rate",
        "multi_absent",
        "others_no_rate",
        "others_no_rate",
        "rates_unavailable",
        "rates_unavailable",
        "sparse_cell",
        "sparse_cell",
      ]),
      "(c) 出さない理由: 1号艇の欠場・勝率なし（null・空）・2艇以上の欠場・他の艇の勝率が全部なし（欠場を除く）・表なし・表の欠け・件数100未満・セルなし",
      JSON.stringify(skips),
    );
    const zero = run([0.0, ...five]);
    check(
      zero.skip === "sparse_cell" || zero.inCaution?.band === -8,
      "(c) 1号艇の勝率 0.00 は勝率として扱う（boat1_no_rate にしない）",
      JSON.stringify(zero),
    );
    const tie = run([4.81, 6.93, 5.0, 6.93, 4.0, 4.0]);
    check(
      tie.inCaution?.topOtherBoat === 2,
      "(c) 最大が同点なら艇番の小さい方",
      JSON.stringify(tie.inCaution),
    );
    const one = run([4.81, 5.12, 9.99, 3.2, 4.0, 6.93], { absent: [3] });
    check(
      same([one.inCaution?.absentBoats, one.inCaution?.topOtherBoat], [[3], 6]) &&
        one.inCaution?.gapCents === -212,
      "(c) 1艇の欠場は残りの艇で出し、absentBoats に入れる（欠場の艇の勝率は使わない）",
      JSON.stringify(one.inCaution),
    );
    const low = run([7.0, ...five], { stage: "準優勝戦" }); // (junyu, 4) 236件
    check(
      low.inCaution?.lowSample === true && low.inCaution?.round === "junyu",
      "(c) 件数 100〜299 は出して lowSample（「件数少なめ」）",
      JSON.stringify(low),
    );
    const edge = run([7.0, ...five], { stage: "準優進出戦" }); // other の帯 4 はセルが無い
    check(
      edge.skip === "sparse_cell",
      "(c) 準優進出戦は準優勝戦（junyu）に入れない",
      JSON.stringify(edge),
    );
  }
}

function scene2() {
  // ---------------------------------------------------------------- (d)
  {
    const cases = JSON.parse(
      fs.readFileSync(
        path.join(
          ROOT,
          "scripts/ml/analogy/tests/fixtures/in_caution_cases.json",
        ),
        "utf8",
      ),
    ).gapCases;
    // 全部の帯にセルがある表（帯の答えだけを比べる）
    const all = [];
    for (let b = -8; b <= 6; b++) all.push(["other", b, 30000, 15000]);
    const table = toInCautionRates(tableRows({ cells: all }), PREV);
    const got = cases.map((c) => {
      const r = computeInCaution({
        entries: race(c.rates),
        raceStage: "予選",
        rates: table,
      });
      return [r.inCaution?.gapCents ?? null, r.inCaution?.band ?? null];
    });
    const want = cases.map((c) => [c.gapCents, c.band]);
    const diff = cases
      .map((c, i) => [c, got[i], want[i]])
      .filter(([, g, w]) => !same(g, w))
      .map(([c, g]) => `${c.name}: ${JSON.stringify(g)}`);
    check(
      diff.length === 0,
      `(d) Python と同じ固定の入力 ${cases.length}件で勝率差・帯が同じ`,
      diff.join("\n   "),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・same・PREV・tableRows・race・run・five） */
export function runInCautionScenes1(env) {
  ({ ROOT, check, same, PREV, tableRows, race, run, five } = env);
  scene1();
  scene2();
}
