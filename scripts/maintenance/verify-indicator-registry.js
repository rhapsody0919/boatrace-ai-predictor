#!/usr/bin/env node
/**
 * 指標の登録簿（src/pure/indicatorRegistry.js、ADR-0108）の形と振る舞いの検査。DB 接続は不要。
 *
 * 守ること:
 *   - id が重複しない。改名の読み替え（ALIASES）は今ある id を指す
 *   - 種類・主語・値の形・比べ方の向きは決まった値だけ
 *   - 文のキー（見出し・短い見出し）が ja の common.json にある
 *   - 書き方は src/pure/dataFormat.js にある関数の名前
 *   - 見立て（judgement）は材料を持ち、材料の id は登録簿にあって輪にならない
 *   - select は6艇の艇番ごとに { value, n, hidden } を返す
 *   - 最良は表示の桁で比べ、hidden の艇は返さない。書き方は勝率2桁・率は % を分ける
 */
import * as dataFormat from "../../src/pure/dataFormat.js";
import ja from "../../src/locales/ja/common.json" with { type: "json" };
import {
  ALIASES,
  INDICATORS,
  bestOfIndicator,
  formatIndicatorParts,
  getIndicator,
} from "../../src/pure/indicatorRegistry.js";

const hasKey = (key) =>
  key.split(".").reduce((node, part) => node?.[part], ja) !== undefined;

const KINDS = ["official", "aggregate", "judgement"];
const SUBJECTS = ["racer", "boat", "course", "motor", "hull", "venue", "race", "meet", "prediction"];
const SHAPES = ["perBoat", "byCondition", "composition", "series", "scalar"];
const SCENES = ["race", "racer", "venue", "meet", "list"];
const DIRECTIONS = ["max", "min", null];

const failures = [];
const fail = (msg) => failures.push(msg);

// 形
const seen = new Set();
for (const def of INDICATORS) {
  const where = `指標 ${def.id}`;
  if (seen.has(def.id)) fail(`${where}: id が重複`);
  seen.add(def.id);
  if (!/^[a-z]+\.[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(def.id)) fail(`${where}: id は 族.指標.変種 の形`);
  if (!KINDS.includes(def.kind)) fail(`${where}: kind ${def.kind}`);
  if (!SUBJECTS.includes(def.subject)) fail(`${where}: subject ${def.subject}`);
  if (!SHAPES.includes(def.shape)) fail(`${where}: shape ${def.shape}`);
  if (!def.scenes?.length || def.scenes.some((s) => !SCENES.includes(s))) fail(`${where}: scenes ${def.scenes}`);
  if (!def.sources?.length) fail(`${where}: sources が空`);
  if (!DIRECTIONS.includes(def.compare?.direction ?? null)) fail(`${where}: compare.direction`);
  if (typeof dataFormat[def.format] !== "function") fail(`${where}: format ${def.format} が dataFormat に無い`);
  if (typeof def.select !== "function") fail(`${where}: select が関数でない`);
  for (const key of [def.text?.label, def.text?.short]) {
    if (!key || !hasKey(key)) fail(`${where}: ja の文のキー ${key} が無い`);
  }
  if (def.kind === "judgement" && !def.materials?.length) fail(`${where}: 見立ては materials が要る`);
  if (def.kind !== "judgement" && def.materials) fail(`${where}: 見立てでないのに materials がある`);
}
for (const [from, to] of Object.entries(ALIASES)) {
  if (!seen.has(to)) fail(`ALIASES ${from} → ${to}: 行き先の id が無い`);
  if (seen.has(from)) fail(`ALIASES ${from}: 今ある id を読み替えている`);
}

// 見立ての材料: 参照先があり、輪にならない
const visit = (id, stack) => {
  if (stack.includes(id)) return fail(`材料が輪になる: ${[...stack, id].join(" → ")}`);
  const def = getIndicator(id);
  if (!def) return fail(`材料の id ${id} が登録簿に無い（${stack.at(-1)}）`);
  (def.materials ?? []).forEach((m) => visit(m, [...stack, id]));
};
INDICATORS.filter((d) => d.materials).forEach((d) => visit(d.id, []));

// 振る舞い（出走表の見本の6艇）
const players = [
  { number: 1, winRate: "7.84", localWinRate: "8.10", global2Rate: "58.26" },
  { number: 2, winRate: "2.80", localWinRate: null, global2Rate: "8.14" },
  { number: 3, winRate: "7.836", localWinRate: "5.40", global2Rate: "31.0" },
  { number: 4, winRate: "6.03", localWinRate: "6.22", global2Rate: "44.2" },
  { number: 5, winRate: "4.41", localWinRate: "4.05", global2Rate: "22.7" },
  { number: 6, winRate: "", localWinRate: "5.90", global2Rate: "36.5" },
];
const expectEq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`${name}: 期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(got)}`);
  }
};
const sorted = (set) => [...set].sort((a, b) => a - b);

const win = getIndicator("racer.winRate.official");
const winValues = win.select({ players });
expectEq("select は6艇ぶん", winValues.size, 6);
expectEq("select の形", winValues.get(1), { value: 7.84, n: null, hidden: false });
expectEq("空の値は null", winValues.get(6).value, null);
expectEq("勝率の最良は表示の2桁で比べる（7.84 と 7.836）", sorted(bestOfIndicator(win, winValues)), [1, 3]);
expectEq("勝率は2桁", formatIndicatorParts(win, 2.8), { text: "2.80", unit: "" });
expectEq("空は —", formatIndicatorParts(win, null), { text: "—", unit: "" });

const two = getIndicator("racer.twoRate.official");
expectEq("2連率は % を分ける", formatIndicatorParts(two, 58.26), { text: "58.3", unit: "%" });
expectEq("2連率の最良", sorted(bestOfIndicator(two, two.select({ players }))), [1]);

const hidden = new Map([[1, { value: 9, hidden: true }], [2, { value: 5, hidden: false }], [3, { value: 3 }]]);
expectEq("hidden の艇は最良に返さない（繰り下げない）", sorted(bestOfIndicator(win, hidden)), []);
expectEq("比べない指標は空", sorted(bestOfIndicator({ compare: { direction: null } }, winValues)), []);
expectEq("知らない id は null", getIndicator("racer.nothing.here"), null);

if (failures.length > 0) {
  console.error("verify-indicator-registry: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-indicator-registry: OK（指標 ${INDICATORS.length} 件）`);
