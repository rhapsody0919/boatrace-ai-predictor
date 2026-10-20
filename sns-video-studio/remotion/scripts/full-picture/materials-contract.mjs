/**
 * 材料 JSON の契約（materials.schema.json）の検査。JSON Schema のうち、この契約が使う語だけを見る小さな検査
 * （type・const・enum・pattern・minimum・maximum・required・properties・additionalProperties・items・$ref）。
 * run-full.mjs は描く前にこれで材料を確かめ、合わなければ止める（形の変わった材料で黙って描かない）。
 */
import { readFileSync } from "node:fs";

export const MATERIALS_SCHEMA = JSON.parse(readFileSync(new URL("./materials.schema.json", import.meta.url), "utf8"));

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => typeOf(v) === t || (t === "number" && typeof v === "number");

/**
 * @param {unknown} value
 * @param {object} schema
 * @returns {string[]} 合わない所（空なら合う）
 */
export function validate(value, schema = MATERIALS_SCHEMA, path = "$", root = schema) {
  if (schema.$ref) {
    const name = schema.$ref.replace("#/definitions/", "");
    const def = root.definitions?.[name];
    if (!def) return [`${path}: 定義が無い ${schema.$ref}`];
    return validate(value, def, path, root);
  }
  const errs = [];
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return [`${path}: 型が ${types.join("|")} でない（${typeOf(value)}）`];
  }
  if ("const" in schema && value !== schema.const) errs.push(`${path}: ${JSON.stringify(schema.const)} でない（${JSON.stringify(value)}）`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${schema.enum.join("|")} のどれでもない（${JSON.stringify(value)}）`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: 形が ${schema.pattern} でない（${value}）`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: ${schema.minimum} 未満`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: ${schema.maximum} を越える`);
  }
  if (value === null || typeof value !== "object") return errs;
  if (Array.isArray(value)) {
    if (schema.items) value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`, root)));
    return errs;
  }
  for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}: ${k} が無い`);
  for (const [k, v] of Object.entries(value)) {
    const sub = schema.properties?.[k] ?? (typeof schema.additionalProperties === "object" ? schema.additionalProperties : null);
    if (sub) errs.push(...validate(v, sub, `${path}.${k}`, root));
  }
  return errs;
}
