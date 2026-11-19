/**
 * verify-analogy-facts.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-analogy-facts.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import {
  todayValues,
  FACT_ITEMS,
  radarBoats,
  boatScopeKey,
  factRows,
  todayPosition,
  defaultScope,
  todayLine,
} from "../../../src/utils/analogyFacts.js";
import { flowLinks, bandBreakdown, hintTableBest, raceListRows } from "../../../src/utils/analogyAggregate.js";

let ROOT_E2E, check, KNOWN_GAPS;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const fx = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(path.join(ROOT_E2E, "analogy-v16-fixture.json.gz")),
    ),
  ).facts;
  const k3 = fx.today.scope_keys["3"].VC;
  for (const r of ["1", "2", "3", "4", "5", "6"])
    fx.facts[k3].by["3"].exh_time[r].win = [1, 50];
  const values = todayValues(fx.today, fx.exhibition);
  const items = FACT_ITEMS.filter((it) => it.key !== "boat_2");
  const countOf = (key) => fx.facts[key]?.n ?? null;
  let n = 0;
  for (const picked of [null, "VC", "NC", "NCR", "VA"])
    for (const target of [1, 2, 3]) {
      const radar = radarBoats(
        fx.today,
        fx.facts,
        values,
        items,
        target,
        picked,
      );
      for (const b of [1, 2, 3, 4, 5, 6]) {
        // 一番上で b を選んだとき（ConditionFactsTab と同じ: boatScopeKey → factRows → カードの今日の行）
        const { key } = boatScopeKey(
          fx.today.scope_keys[String(b)],
          countOf,
          picked,
        );
        const sf = fx.facts[key];
        const rows = factRows(sf, b, target, true);
        items.forEach((it, i) => {
          const row = rows.find((r) => r.key === it.key);
          const line = row
            ? todayLine(row, values[it.key], b, sf, target)
            : null;
          check(
            `七角形の表＝一番上で選んだとき: ${b}号艇 ${it.key} target=${target} picked=${picked}`,
            radar[b - 1].cells[i].hit ?? null,
            line?.hit ?? null,
          );
          n += 1;
        });
      }
    }
  // 食い違いを作れているか（1号艇の集めたレースの3号艇の列とは違う数字になる）
  const k1 = fx.today.scope_keys["1"].VC;
  const b3 = todayPosition(values.exh_time, false, 3).bucket;
  check(
    "検査の前提: 1号艇の集めたレースの3号艇の展示タイムは、3号艇の集めたレースと違う",
    JSON.stringify(fx.facts[k1].by["3"].exh_time[String(b3)].win) !==
      JSON.stringify(fx.facts[k3].by["3"].exh_time[String(b3)].win),
    true,
  );
  check(
    "七角形の表: 3号艇の展示タイムは3号艇の集めたレースの値",
    radarBoats(fx.today, fx.facts, values, items, 1, null)[2].cells[
      items.findIndex((it) => it.key === "exh_time")
    ].hit,
    [1, 50],
  );
  // 件数0の区分は、カードの今日の行と同じく「無し」（レビュー指摘: 表だけ「— 0/0件」になっていた）
  {
    const fz = structuredClone(fx);
    const b5 = todayPosition(values.exh_time, false, 5).bucket;
    fz.facts[fz.today.scope_keys["5"].VC].by["5"].exh_time[String(b5)].win = [
      0, 0,
    ];
    const ie = items.findIndex((it) => it.key === "exh_time");
    check(
      "七角形の表: 件数0の区分は無し",
      radarBoats(fz.today, fz.facts, values, items, 1, null)[4].cells[ie].hit,
      null,
    );
  }
  return { fx, countOf, n };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ fx, countOf, n }) {
  // 手で選んだ範囲の集計がその艇だけ無いときは、既定に戻す（レビュー指摘: 表の行が全部「—」になっていた）
  {
    const keys4 = fx.today.scope_keys["4"];
    const missing = (key) =>
      key === keys4.NC ? null : (fx.facts[key]?.n ?? null);
    check(
      "範囲: 手で選んだ範囲の集計が無い艇は既定に戻す",
      boatScopeKey(keys4, missing, "NC").key,
      defaultScope(keys4, missing).key,
    );
    check(
      "範囲: 手で選んだ範囲の集計があればそれを使う",
      boatScopeKey(keys4, countOf, "NC").key,
      keys4.NC,
    );
  }
  console.log(`七角形の表と一番上で選んだときの一致: ${n} 件`);
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
  // ---- 着順の流れの帯の内訳（BOA-816）: 帯の件数＝その帯に入る3連単の件数の合計 ----
  {
    const fx = JSON.parse(
      zlib.gunzipSync(
        fs.readFileSync(path.join(ROOT_E2E, "analogy-v16-fixture.json.gz")),
      ),
    ).scenario.scenario;
    let n = 0;
    for (const { forms } of Object.values(fx.cells))
      for (const cell of Object.values(forms))
        for (const [first, not1] of [
          [null, false],
          [null, true],
          [1, false],
          [4, false],
        ])
          for (const [p, a, b, c] of flowLinks(cell.tri, { first, not1 })) {
            const bd = bandBreakdown(
              cell.tri,
              { p, a, b, first, not1 },
              { first, not1 },
            );
            check(
              `帯の内訳の合計＝帯の件数: ${p}:${a}-${b} first=${first} not1=${not1}`,
              bd?.total ?? null,
              c,
            );
            n += 1;
          }
    // 押したときと絞り込みが変わったら外れる（ファンパネル: 1着を変えたら帯の選択は外す）
    const any = fx.cells.all.forms.any;
    const [p0, a0, b0] = flowLinks(any.tri)[0];
    check(
      "帯の内訳: 1着の絞り込みが変わったら null",
      bandBreakdown(
        any.tri,
        { p: p0, a: a0, b: b0, first: null, not1: false },
        { first: a0, not1: false },
      ),
      null,
    );
    console.log(`帯の内訳の合計＝帯の件数: ${n} 件`);
  }
}

function scene4() {
  // ---- 平均STの表の金枠（BOA-814）。出走表と同じ決まり ----------------------
  {
    const st = (filled, n, extra = {}) => ({
      course_filled: filled,
      course_n: n,
      overall: [0.16, 0.16, 0.16, 0.16, 0.16, 0.16],
      venue: [],
      venue_n: [],
      ...extra,
    });
    const sets = (b) =>
      Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v].sort()]));
    const base = [0.15, 0.12, 0.14, 0.13, 0.16, 0.17];
    check(
      "平均STの表: 一番小さい値に金枠",
      sets(hintTableBest(st(base, [20, 20, 20, 20, 20, 20]), null)),
      { course: [2], overall: [], venue: [], exh: [] },
    );
    check(
      "平均STの表: 走数が6走未満の値は一番でも付けず、次の艇に繰り下げない",
      sets(hintTableBest(st(base, [20, 5, 20, 20, 20, 20]), null)).course,
      [],
    );
    check(
      "平均STの表: 3桁で同じ値なら両方に付ける",
      sets(
        hintTableBest(
          st([0.1504, 0.1496, 0.16, 0.17, 0.18, 0.19], [9, 9, 9, 9, 9, 9]),
          null,
        ),
      ).course,
      [1, 2],
    );
    check(
      "平均STの表: 会場の値は薄く出している（10走未満）ものに付けない",
      sets(
        hintTableBest(
          st(base, [20, 20, 20, 20, 20, 20], {
            venue: [0.11, 0.14, 0.15, 0.16, 0.17, 0.18],
            venue_n: [9, 30, 30, 30, 30, 30],
          }),
          null,
        ),
      ).venue,
      [],
    );
    check(
      "平均STの表: 展示STは F を外し、2桁で比べる",
      sets(
        hintTableBest(st(base, [20, 20, 20, 20, 20, 20]), [
          -0.02,
          0.051,
          0.049,
          0.1,
          0.12,
          null,
        ]),
      ).exh,
      [2, 3],
    );
  }
}

function scene5() {
  // ---- STEP4 の件数から元のレースの一覧（BOA-823）。画面の絞りと押した物を重ねる ----------------
  {
    const races = {
      entry_bits: ["waku", "inlost", "mae", "mae6", "mae5", "mae56", "maeOther"],
      form_bits: ["flat", "wall", "d2", "d3", "kado", "d1", "dash"],
      rows: [
        ["2026-10-09-01-01", 0b1, 0b10011, "213", "差し", 1980],
        ["2026-10-08-02-01", 0b1, 0b10000, "132", "逃げ", 1240],
        ["2026-10-07-03-01", 0b100, 0b1, "415", "まくり", 15600],
        ["2026-10-06-04-01", 0b1, 0b0, "246", null, null],
      ],
    };
    const ids = (o) => raceListRows(races, o).map((r) => r.race_id.slice(5, 10));
    check("一覧: 1着の艇", ids({ pick: { kind: "first", boat: 2 } }), [
      "10-09",
      "10-06",
    ]);
    check(
      "一覧: 進入（枠なり）と形（カド一撃）で絞る",
      ids({ entry: "waku", form: "kado", pick: { kind: "first", boat: 2 } }),
      ["10-09"],
    );
    check("一覧: 3連単", ids({ pick: { kind: "tri", combo: [1, 3, 2] } }), [
      "10-08",
    ]);
    check(
      "一覧: 帯（2着→3着）",
      ids({ pick: { kind: "band", p: 1, a: 1, b: 5 } }),
      ["10-07"],
    );
    check("一覧: 万舟", ids({ pick: { kind: "manshu" } }), ["10-07"]);
    check(
      "一覧: 決まり手の記録なしは「その他」",
      ids({ pick: { kind: "tech", tech: "その他" } }),
      ["10-06"],
    );
    check(
      "一覧: 1号艇以外",
      ids({ not1: true, pick: { kind: "tech", tech: "差し" } }),
      ["10-09"],
    );
    check(
      "一覧: 形の名前",
      raceListRows(races, { pick: { kind: "first", boat: 2 } })[0].forms,
      ["flat", "wall", "kado"],
    );
  }
  console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length} 件（仕様未定・不一致に数えない）`);
  for (const [input, observe] of KNOWN_GAPS) {
    let current;
    try {
      const value = observe();
      current = value === undefined ? "undefined" : JSON.stringify(value);
    } catch (error) {
      current = `例外 ${error.message}`;
    }
    console.log(`  ${input}: ${current}`);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT_E2E・check・KNOWN_GAPS） */
export function runAnalogyFactsScenes5(env) {
  ({ ROOT_E2E, check, KNOWN_GAPS } = env);
  scene3();
  scene4();
  scene5();
}
