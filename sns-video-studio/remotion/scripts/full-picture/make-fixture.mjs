/**
 * 材料 JSON の最小の写し（検査の固定の材料）を作る。build（build-all.mjs）が読んだ所だけを残し、
 * 写しから作った場面が元の材料から作った場面と同じことを確かめてから書く。
 * 写しも材料の契約（materials.schema.json）に合うことを確かめる。.gz で終わる名前なら gzip で書く。
 * 使い方: node scripts/full-picture/make-fixture.mjs <材料.json> <写し.json[.gz]>
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { MATERIALS_SCHEMA, validate } from "./materials-contract.mjs";
import process from "node:process";
import { buildAll } from "./build-all.mjs";

/** 読んだ所を記録する Proxy。node: { keys: Map<key, node>, all: 列挙されたか } */
function record(value, node) {
  if (value === null || typeof value !== "object") return value;
  return new Proxy(value, {
    get(target, key, recv) {
      const v = Reflect.get(target, key, recv);
      if (typeof key === "symbol" || !Object.prototype.hasOwnProperty.call(target, key)) return v;
      let child = node.keys.get(key);
      if (!child) node.keys.set(key, (child = { keys: new Map(), all: false }));
      return record(v, child);
    },
    has(target, key) {
      if (typeof key !== "symbol" && Object.prototype.hasOwnProperty.call(target, key) && !node.keys.has(key))
        node.keys.set(key, { keys: new Map(), all: false });
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      node.all = true;
      return Reflect.ownKeys(target);
    },
  });
}

/** 読んだ所だけを残す（列挙された物はキーをすべて残す。中身は読んだ所だけ） */
function prune(value, node) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    // 配列は長さを保つ（読まなかった要素は null）
    return value.map((v, i) => (node.keys.has(String(i)) || node.all ? prune(v, node.keys.get(String(i)) ?? { keys: new Map(), all: false }) : null));
  }
  const out = {};
  for (const k of Object.keys(value))
    if (node.all || node.keys.has(k)) out[k] = prune(value[k], node.keys.get(k) ?? { keys: new Map(), all: false });
  return out;
}

/** 契約で required の項目が写しに無ければ、元の値をそのまま足す（写しも契約に合うように） */
function keepRequired(small, orig, schema, root = MATERIALS_SCHEMA) {
  if (schema.$ref) return keepRequired(small, orig, root.definitions[schema.$ref.replace("#/definitions/", "")], root);
  if (small === null || orig === null || typeof small !== "object" || typeof orig !== "object") return small;
  if (Array.isArray(small)) return schema.items ? small.map((v, i) => keepRequired(v, orig[i], schema.items, root)) : small;
  const out = { ...small };
  for (const k of schema.required ?? []) if (!(k in out) && k in orig) out[k] = orig[k];
  for (const k of Object.keys(out)) {
    const sub = schema.properties?.[k] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : null);
    if (sub) out[k] = keepRequired(out[k], orig[k], sub, root);
  }
  return out;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("使い方: node make-fixture.mjs <材料.json> <写し.json>");
  process.exit(2);
}
const m = JSON.parse(readFileSync(input, "utf8"));
const root = { keys: new Map(), all: false };
buildAll(record(m, root));
// 契約の項目（schemaVersion・raceId 等）は build が読まなくても残す
for (const k of ["schemaVersion", "raceId", "date", "venueCode", "stage", "missing"]) root.keys.set(k, root.keys.get(k) ?? { keys: new Map(), all: true });
const small = keepRequired(prune(m, root), m, MATERIALS_SCHEMA);
assert.deepEqual(JSON.parse(JSON.stringify(buildAll(small))), JSON.parse(JSON.stringify(buildAll(m))), "写しから作った場面が元と同じ");
assert.deepEqual(validate(small), [], "写しが材料の契約に合う");
const body = `${JSON.stringify(small)}\n`;
writeFileSync(output, output.endsWith(".gz") ? gzipSync(body, { level: 9 }) : body);
console.log(`${output}: ${(JSON.stringify(m).length / 1024).toFixed(0)}KB → ${(JSON.stringify(small).length / 1024).toFixed(0)}KB`);
