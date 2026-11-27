#!/usr/bin/env node
/**
 * PR の大きさの数え（prSize.js）が、台帳に行の無い新しい verify を ADR-0072 の既定 ci どおり頭の注釈があるときだけ試験として数えないことを守る。
 * 外部接続なし・git に触れない。注釈の無い道具・台帳に manual で足した物・本文が読めない物は数える。
 */
import { measurePrSize } from "./prSize.js";

let failures = 0;
const check = (label, pass, detail = "") => {
  if (!pass) {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
};

const REG = "scripts/maintenance/verify-registry.json";
const V = "scripts/maintenance/verify-new.js";
const lines = (k) => Array.from({ length: k }, (_, i) => `const v${i} = ${i};`);
const ANNOTATED = "/**\n * 新しい物を守る。\n */\nconst a = 1;\n";
const BARE = "const a = 1;\n";

const run = ({ head, reg = { entries: [] }, regBase = { entries: [] } }) =>
  measurePrSize({
    changes: [{ status: "A", path: V }, { status: "A", path: "src/pure/x.js" }],
    patches: new Map([
      [V, { added: lines(150), removed: [] }],
      ["src/pure/x.js", { added: lines(100), removed: [] }],
    ]),
    readText: (side, p) => {
      if (p === REG) return JSON.stringify(side === "head" ? reg : regBase);
      if (p === V && side === "head") return head;
      return null;
    },
  });

const a = run({ head: ANNOTATED });
check("行なし＋注釈あり → 数えない", a.lines === 100 && a.files === 1, JSON.stringify(a.counted));

const b = run({ head: BARE });
check("行なし＋注釈なし → 数える", b.lines === 250 && b.files === 2, JSON.stringify(b.counted));

const c = run({ head: ANNOTATED, reg: { entries: [{ script: "verify-new.js", tier: "manual" }] } });
check("台帳に tier=manual で足した → 数える", c.lines === 250, JSON.stringify(c.counted));

const d = run({ head: null });
check("本文が読めない → 数える", d.lines === 250, JSON.stringify(d.counted));

const e = run({ head: ANNOTATED, reg: { entries: [{ script: "verify-new.js", tier: "ci" }] } });
check("台帳に tier=ci で足した → 今までどおり数えない", e.lines === 100, JSON.stringify(e.counted));

const f = measurePrSize({
  changes: [{ status: "A", path: V }, { status: "M", path: "src/pure/y.js" }],
  patches: new Map([
    [V, { added: lines(150), removed: [] }],
    ["src/pure/y.js", { added: ['import { z } from "../../scripts/maintenance/verify-new.js";'], removed: [] }],
  ]),
  readText: (side, p) => (p === REG ? JSON.stringify({ entries: [] }) : p === V && side === "head" ? ANNOTATED : null),
});
check("注釈があっても本体から名を読まれたら数える", f.lines === 151, JSON.stringify(f.counted));

if (failures > 0) {
  console.error(`verify-pr-size-default-ci: ${failures} 件が失敗`);
  process.exit(1);
}
console.log("verify-pr-size-default-ci: 6 件 OK");
