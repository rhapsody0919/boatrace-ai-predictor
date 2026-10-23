#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "source-walk-"));
const write = (name, text = "") => {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const transient = ["x.tmp.mjs", "x.tmp.js", "x.__mutant1.js", "x.mutant-1.js", "y.mutant-1-2.tmp.mjs"];
try {
  // 実際の2本を隔離した木で実行する。本番・DBへの接続はない。
  write("package.json", '{"type":"module"}');
  write("src/services/supabaseClient.js", "// .throwOnError() client.from = client.rpc =");
  write("docs/db-migration/001.sql", "CREATE TABLE test_table (\n scraped_at timestamp\n);");
  for (const name of transient) {
    write(`scripts/lib/${name}`, ['const throwOnError', '= false; db.from("test_table").update({ value: 1 });'].join(' '));
  }
  for (const name of ["verify-query-errors.js", "verify-scraped-at-on-update.js"]) {
    write(`scripts/maintenance/${name}`, fs.readFileSync(new URL(name, import.meta.url), "utf8"));
  }
  const helper = new URL("../lib/sourceFileWalk.js", import.meta.url);
  if (fs.existsSync(helper)) write("scripts/lib/sourceFileWalk.js", fs.readFileSync(helper, "utf8"));
  // 一覧後のstat・再帰readdir・read直前の削除を同期的に注入する。
  const preload = write("remove.mjs", `
    import fs from "node:fs";
    import path from "node:path";
    const operation = process.env.WALK_REMOVE;
    const original = fs[operation];
    let removed = false;
    fs[operation] = function(file, ...args) {
      const target = operation === "readFileSync" ? "gone.js" : "vanished";
      if (!removed && path.basename(String(file)) === target) {
        removed = true;
        fs.rmSync(file, { recursive: true, force: true });
      }
      return original.call(this, file, ...args);
    };
  `);
  const failures = [];
  for (const name of ["verify-query-errors.js", "verify-scraped-at-on-update.js"]) {
    for (const operation of ["statSync", "readdirSync", "readFileSync"]) {
      write("scripts/lib/vanished/child.js");
      write("scripts/lib/gone.js");
      const result = spawnSync(process.execPath, ["--import", preload, path.join(root, "scripts/maintenance", name)], {
        encoding: "utf8", env: { ...process.env, WALK_REMOVE: operation },
      });
      if (result.status !== 0) failures.push(`${name} (${operation}): ${result.stderr}`);
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
  // 通常ファイルの違反は引き続き検出する（対象を全部飛ばす実装を防ぐ）。
  const ordinary = write("scripts/lib/ordinary.js", fs.readFileSync(path.join(root, "scripts/lib/x.tmp.js"), "utf8"));
  for (const name of ["verify-query-errors.js", "verify-scraped-at-on-update.js"]) {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/maintenance", name)], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ordinary\.js/);
  }
  fs.unlinkSync(ordinary);

  const { walkSourceFiles, readSourceFile } = await import(helper);
  const tree = path.join(root, "tree");
  const keep = write("tree/nested/keep.jsx", "source");
  write("tree/empty.js");
  write("tree/ignored/no.js");
  write("tree/no.sql");
  for (const name of transient) write(`tree/${name}`);
  const options = { extensions: [".js", ".jsx", ".mjs"], excludedDirs: ["ignored"] };
  assert.deepEqual(walkSourceFiles(tree, options).sort(), [path.join(tree, "empty.js"), keep].sort());
  assert.equal(readSourceFile(keep), "source");
  assert.equal(readSourceFile(path.join(tree, "empty.js")), "");
  // 各fs境界でENOENTだけを許す。権限・I/O等のエラーは必ず伝播する。
  for (const code of ["ENOENT", "EACCES", "EIO"]) {
    for (const operation of ["statSync", "readdirSync", "readFileSync"]) {
      const error = Object.assign(new Error(code), { code });
      const injected = { ...fs, [operation]: () => { throw error; } };
      const run = operation === "readFileSync"
        ? () => readSourceFile(keep, injected)
        : () => walkSourceFiles(tree, { ...options, fs: injected });
      if (code === "ENOENT") assert.deepEqual(run(), operation === "readFileSync" ? null : []);
      else assert.throws(run, (caught) => caught === error);
    }
  }
  console.log("OK: source walk の一時ファイル除外・削除競合・エラー伝播と verify 2本の接続");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
