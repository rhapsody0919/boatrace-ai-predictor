// html・body のクラスの付け外し（src/hooks/useRootClass.js の holdRootClass）が、同じクラスを付けた部品の最後の1つが外すまでクラスを残すことを守る（html:has()・body:has() の代わり、2026-11-26）
import assert from "node:assert/strict";
import { holdRootClass } from "../../src/hooks/useRootClass.js";

const fakeRoot = () => {
  const set = new Set();
  return {
    set,
    classList: { add: (c) => set.add(c), remove: (c) => set.delete(c) },
  };
};

const body = fakeRoot();
const releaseA = holdRootClass(body, "x-shown");
assert.deepEqual([...body.set], ["x-shown"], "付ける");
const releaseB = holdRootClass(body, "x-shown");
releaseA();
assert.deepEqual([...body.set], ["x-shown"], "もう1つが付けている間は残す");
releaseA();
assert.deepEqual(
  [...body.set],
  ["x-shown"],
  "同じ外す関数を2回呼んでも数を減らしすぎない",
);
releaseB();
assert.deepEqual([...body.set], [], "最後の1つで外す");

const releaseY = holdRootClass(body, "y-shown");
const releaseZ = holdRootClass(body, "z-shown");
releaseY();
assert.deepEqual([...body.set], ["z-shown"], "クラスごとに数える");
releaseZ();

const html = fakeRoot();
const releaseHtml = holdRootClass(html, "x-shown");
const releaseBody = holdRootClass(body, "x-shown");
releaseBody();
assert.deepEqual([...html.set], ["x-shown"], "要素ごとに数える");
releaseHtml();
assert.deepEqual([...html.set], []);

const again = holdRootClass(body, "x-shown");
assert.deepEqual([...body.set], ["x-shown"], "外した後にまた付けられる");
again();

console.log("verify-root-class-hook: OK");
