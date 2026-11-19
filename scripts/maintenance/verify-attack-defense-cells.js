#!/usr/bin/env node
/**
 * 超展開データのセルの値（src/utils/attackDefenseCells.js）を固定する。DB接続は不要。
 *
 * 画面（src/components/race/AttackDefenseTable.jsx）にあった計算を、全貌動画の材料
 * （sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs）と共有するため純関数へ移した
 * （2026-10-25 hq 依頼、FT01。画面と投稿の数字が食い違わないようにする）。移す前の関数と 20,000 通りの入力で
 * 値が一致することを確かめてから移した。ここでは画面の決まり（回数／分母、参考の※、全国平均の%、「-」）を固定する。
 *
 *   1. 表（AttackDefenseTable の default export）を描いた各セルが attackDefenseColumn の値と同じ（二重の実装に戻らない）。
 *      部品の本文の字は読まず、scripts/lib/renderJsx.js で描いた DOM で見る
 *   2. 1号艇は逃げ（攻め）と差され・まくられ・捲差され・その他（守り、負け数が分母の割合）
 *   3. 全枠の勝ちが2〜4は reference、2未満は全国平均の%（default）、2〜6号艇の逃げは「-」、出走0は「-」
 *   4. isDefaultAttackDistribution は集計側の既定の分布（scripts/lib/winningTechniques.js）だけを真にする
 */
import assert from "node:assert/strict";
import {
  TECHNIQUE_ROWS,
  attackDefenseColumn,
  isDefaultAttackDistribution,
} from "../../src/utils/attackDefenseCells.js";
import { COURSE_DEFAULT_DISTRIBUTION } from "../lib/winningTechniques.js";
import { renderJsx } from "../lib/renderJsx.js";

const stat = (boatNumber, counts, attack, defense = {}) => ({
  boatNumber,
  wakuRaceCounts: counts,
  attackDistribution: attack,
  defenseDistribution: defense,
});

// 2. 1号艇（勝ち10・出走20、負け10）
assert.deepEqual(
  attackDefenseColumn(
    stat(
      1,
      { 1: { total: 20, wins: 10 } },
      { 1: { nige: 0.9, nuki: 0.1 } },
      { 1: { sashi: 0.5, makuri: 0.3, makurizashi: 0.15, nuki: 0.05 } },
    ),
  ),
  {
    waku: 1,
    wins: 10,
    total: 20,
    cells: {
      nige: "9/20",
      sashi: "5/20",
      makuri: "3/20",
      makurizashi: "2/20",
      other: "1/20",
    },
  },
  "1号艇: 逃げは勝ち×割合、守りは負け×割合（その他は抜き＋恵まれ）",
);
assert.deepEqual(
  attackDefenseColumn(
    stat(1, { 1: { total: 20, wins: 20 } }, { 1: { nige: 1 } }, null),
  ).cells.sashi,
  "0/20",
  "1号艇で負けが無ければ 0/出走",
);

// 3. 参考・全国平均・「-」
assert.deepEqual(
  attackDefenseColumn(
    stat(
      2,
      { 2: { total: 30, wins: 4 } },
      { 2: { sashi: 0.5, makuri: 0.25, makurizashi: 0.25 } },
    ),
  ).cells,
  {
    nige: "-",
    sashi: { type: "reference", value: "2/30" },
    makuri: { type: "reference", value: "1/30" },
    makurizashi: { type: "reference", value: "1/30" },
    other: { type: "reference", value: "0/30" },
  },
  "全枠の勝ちが2〜4は参考、2〜6号艇の逃げは「-」",
);
assert.deepEqual(
  attackDefenseColumn(
    stat(3, { 3: { total: 10, wins: 1 } }, { 3: { makuri: 1 } }),
  ).cells.sashi,
  { type: "default", value: "12%" },
  "全枠の勝ちが2未満は全国平均の%（3号艇の差しは 0.124）",
);
assert.deepEqual(
  attackDefenseColumn(
    stat(
      5,
      { 5: { total: 12, wins: 2 }, 1: { total: 3, wins: 3 } },
      { 5: { makurizashi: 1 } },
    ),
  ).cells,
  {
    nige: "-",
    sashi: "0/12",
    makuri: "0/12",
    makurizashi: "2/12",
    other: "0/12",
  },
  "勝ちの合計は全枠で数える（5号艇2＋1号艇3）",
);
assert.equal(
  attackDefenseColumn(
    stat(4, { 1: { total: 9, wins: 9 } }, { 4: { sashi: 1 } }),
  ).cells.sashi,
  "-",
  "その枠の出走が0なら「-」",
);

// 4. 既定の分布の判定
assert.equal(
  isDefaultAttackDistribution(structuredClone(COURSE_DEFAULT_DISTRIBUTION)),
  true,
  "既定の分布の写しは真",
);
assert.equal(
  isDefaultAttackDistribution({
    ...structuredClone(COURSE_DEFAULT_DISTRIBUTION),
    2: { sashi: 0.5 },
  }),
  false,
  "1枠でも違えば偽",
);
assert.equal(
  isDefaultAttackDistribution({
    1: { nige: 0.954, nuki: 0.044, megumare: 0.002 },
  }),
  false,
  "一部の枠だけなら偽",
);
assert.equal(isDefaultAttackDistribution(null), false, "無ければ偽");

// 1. 画面の表は attackDefenseColumn と同じ値を描く（1号艇・参考・全国平均・「-」が混ざる6艇。並びは号艇順）
{
  const boats = [
    stat(
      1,
      { 1: { total: 20, wins: 10 } },
      { 1: { nige: 0.9, nuki: 0.1 } },
      { 1: { sashi: 0.5, makuri: 0.3, makurizashi: 0.15, nuki: 0.05 } },
    ),
    stat(
      2,
      { 2: { total: 30, wins: 4 } },
      { 2: { sashi: 0.5, makuri: 0.25, makurizashi: 0.25 } },
    ),
    stat(3, { 3: { total: 10, wins: 1 } }, { 3: { makuri: 1 } }),
    stat(4, { 1: { total: 9, wins: 9 } }, { 4: { sashi: 1 } }),
    stat(
      5,
      { 5: { total: 12, wins: 2 }, 1: { total: 3, wins: 3 } },
      { 5: { makurizashi: 1 } },
    ),
    stat(6, { 6: { total: 8, wins: 6 } }, { 6: { makuri: 0.5, sashi: 0.5 } }),
  ];
  const view = await renderJsx(
    new URL("../../src/components/race/AttackDefenseTable.jsx", import.meta.url),
    { racerStats: [...boats].reverse(), players: [] },
  );
  const asText = (v) =>
    typeof v === "string"
      ? v
      : v.type === "reference"
        ? `${v.value}※`
        : v.value;
  const asClass = (v) =>
    typeof v === "string"
      ? null
      : v.type === "reference"
        ? "ad-reference-value"
        : "ad-default-value";
  const expected = boats.map((b) => attackDefenseColumn(b));
  const cellsOf = (tr) =>
    [...tr.querySelectorAll("td")].slice(1).map((td) => ({
      text: td.textContent,
      cls: td.firstElementChild?.className ?? null,
    }));
  for (const box of [".ad-table-desktop", ".ad-table-mobile"]) {
    const rows = [...view.container.querySelectorAll(`${box} tbody tr`)];
    assert.equal(rows.length, 2 + TECHNIQUE_ROWS.length, `${box}: 行の数`);
    assert.deepEqual(
      cellsOf(rows[1]).map((c) => c.text),
      expected.map((c) => (c.total || c.wins ? `${c.wins}/${c.total}` : "-")),
      `${box}: 勝ち/出走の行`,
    );
    TECHNIQUE_ROWS.forEach((row, i) => {
      assert.deepEqual(
        cellsOf(rows[2 + i]),
        expected.map((c) => ({
          text: asText(c.cells[row.key]),
          cls: asClass(c.cells[row.key]),
        })),
        `${box}: ${row.key} の行が attackDefenseColumn と同じ`,
      );
    });
  }
  await view.unmount();
  const empty = await renderJsx(
    new URL("../../src/components/race/AttackDefenseTable.jsx", import.meta.url),
    { racerStats: boats.slice(0, 5), players: [] },
  );
  assert.equal(empty.container.innerHTML, "", "6艇そろわなければ描かない");
  await empty.unmount();
}

console.log("verify-attack-defense-cells: OK");
