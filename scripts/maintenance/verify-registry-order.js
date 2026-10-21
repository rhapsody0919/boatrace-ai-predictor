/**
 * verify-registry.json の名前の順（scripts/lib/verifyRegistryOrder.js、BOA-938）の検査。
 * 1. 順と重複の判定
 * 2. 文字列のままの並べ替え（項目の書き方を変えない・2回目は変わらない）
 * 3. 名前の順に挿した2つの PR は git merge-file で衝突しない。末尾に足した2つは衝突する（直す前の形）
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  registryOrderProblems,
  sortRegistryText,
} from "../lib/verifyRegistryOrder.js";

const entry = (script, extra = "") =>
  [
    "    {",
    `      "script": "${script}",`,
    '      "tier": "ci",' + extra,
    `      "guards": "${script} の検査"`,
    "    }",
  ].join("\n");
const registry = (scripts, extras = {}) =>
  [
    "{",
    '  "$comment": ["台帳"],',
    '  "entries": [',
    scripts.map((s) => entry(s, extras[s] ?? "")).join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");

test("名前の順なら問題なし、崩れていれば順序、同じ名前は重複", () => {
  const e = (s) => ({ script: s });
  assert.deepEqual(
    registryOrderProblems([e("verify-a.js"), e("verify-b.js")]),
    [],
  );
  const out = registryOrderProblems([e("verify-b.js"), e("verify-a.js")]);
  assert.equal(out.length, 1);
  assert.match(out[0], /^順序: verify-a\.js は verify-b\.js より前/);
  assert.match(
    registryOrderProblems([e("verify-a.js"), e("verify-a.js")]).join(),
    /重複: verify-a\.js/,
  );
  // コードポイント順（大文字・記号はロケールに依存しない）
  assert.deepEqual(
    registryOrderProblems([e("verify-a-b.js"), e("verify-a.js")]),
    [],
  );
});

test("文字列のまま並べ替え、項目の書き方を変えない。2回目は変わらない", () => {
  const extras = { "verify-a.js": '\n      "args": ["--x"],' };
  const text = registry(["verify-c.js", "verify-a.js", "verify-b.js"], extras);
  const sorted = sortRegistryText(text);
  assert.equal(
    sorted,
    registry(["verify-a.js", "verify-b.js", "verify-c.js"], extras),
  );
  assert.equal(sortRegistryText(sorted), sorted);
});

test("prettier の形でない entries は並べ替えずに例外", () => {
  assert.throws(
    () => sortRegistryText('{"entries":[{"script":"b"},{"script":"a"}]}'),
    /entries/,
  );
});

test("閉じの行末に空白があると、その行の次で例外（黙って項目を落とさない）", () => {
  const text = registry(["verify-b.js", "verify-a.js"]).replace(
    "\n    },\n",
    "\n    }, \n",
  );
  assert.throws(() => sortRegistryText(text), /9 行目.*閉じる前に次の項目/);
});

/** base から ours・theirs を git merge-file で合わせ、{ clean, text } を返す */
function merge(base, ours, theirs) {
  const dir = mkdtempSync(path.join(tmpdir(), "registry-merge-"));
  try {
    const [b, o, t] = ["base", "ours", "theirs"].map((n) => path.join(dir, n));
    writeFileSync(b, base);
    writeFileSync(o, ours);
    writeFileSync(t, theirs);
    try {
      return {
        clean: true,
        text: execFileSync("git", ["merge-file", "-p", o, b, t], {
          encoding: "utf8",
        }),
      };
    } catch (err) {
      return { clean: false, text: String(err.stdout ?? "") };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("名前の順に挿した2つの PR は衝突せずに合わさる（離れた隙間）", () => {
  const base = ["verify-a.js", "verify-f.js", "verify-m.js", "verify-t.js"];
  const ours = registry([...base, "verify-c.js"].sort());
  const theirs = registry([...base, "verify-p.js"].sort());
  const r = merge(registry(base), ours, theirs);
  assert.equal(r.clean, true, r.text);
  const entries = JSON.parse(r.text).entries;
  assert.deepEqual(
    entries.map((e) => e.script),
    [
      "verify-a.js",
      "verify-c.js",
      "verify-f.js",
      "verify-m.js",
      "verify-p.js",
      "verify-t.js",
    ],
  );
  assert.deepEqual(registryOrderProblems(entries), []);
});

test("末尾に足した2つの PR は衝突する（直す前の運用の再現）", () => {
  const base = ["verify-a.js", "verify-f.js"];
  const r = merge(
    registry(base),
    registry([...base, "verify-z1.js"]),
    registry([...base, "verify-c.js"]),
  );
  assert.equal(r.clean, false);
});
