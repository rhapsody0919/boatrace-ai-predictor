/**
 * importProbe.js - 製品の本を、その本の直の import の一部だけを偽へ差し替えて新しく読み込む（verify の部品）。
 *
 * probeImport(本の URL, (回) => ({ 本物の URL: 偽の URL })) は、本の URL に ?probe=<回>&swap=<表> を付けて import する。
 * 解決の hook（module.register が別の thread で動かす）は、親の URL に swap が付いた本のときだけ、表にある本物を偽へ向ける。
 * 表に無い import と、子の本からの import は本物のまま。回ごとに新しく評価する（import で動く入口を何度でも回せる）。
 * 本の import.meta.url には ?probe= が付く（pathname は同じ）。
 */
import { register } from "node:module";

const HOOKS = `
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  const parent = context.parentURL ?? "";
  const q = parent.indexOf("?");
  const swap = q < 0 ? null : new URLSearchParams(parent.slice(q + 1)).get("swap");
  const to = swap ? JSON.parse(swap)[resolved.url] : undefined;
  return to ? { url: to, shortCircuit: true } : resolved;
}
`;
let registered = false;
let runs = 0;

/** 偽の本の URL（?m=<名>&p=<回>）。同じ偽の本でも名・回ごとに別に評価する */
export const fakeOf = (href, name, run) =>
  `${href}?m=${encodeURIComponent(name)}&p=${run}`;

/** href の本を swapsOf(回) の差し替えで新しく import し、その本の名前空間を返す */
export async function probeImport(href, swapsOf = () => ({})) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);
    registered = true;
  }
  runs += 1;
  const q = new URLSearchParams({
    probe: String(runs),
    swap: JSON.stringify(swapsOf(runs)),
  });
  return import(`${href}?${q}`);
}
