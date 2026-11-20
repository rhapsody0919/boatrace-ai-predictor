/**
 * importSpecifiers.js - 本の import 指定子を、本文の字でなく実際の import の解決で見る（verify の部品）。
 *
 * node:module の register の resolve hook（別の thread）が、印を付けた URL から解決された指定子を port で返す。
 * 印（?import-specifiers=…）を付けて import し直すので、既に読み込んだ本でも新しく解決される。本の中身は動く（top level の副作用に注意）。
 * 終わりの印（import-specifiers:end）を最後に解決させ、同じ port の順で、それより前の記録が全部届いたと分かる。
 *
 * 使い方: await importSpecifiers(new URL("../lib/snsGa4.js", import.meta.url)) → ["node:crypto"]
 */
import { register } from "node:module";

const END = "import-specifiers:end";
const HOOKS = `
let port;
export function initialize(data) { port = data.port; }
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(${JSON.stringify(END)})) {
    port.postMessage({ end: specifier });
    return { url: "data:text/javascript,", shortCircuit: true };
  }
  if (context.parentURL?.includes("?import-specifiers=")) port.postMessage({ parent: context.parentURL, specifier });
  return next(specifier, context);
}
`;
const { port1, port2 } = new MessageChannel();
const seen = [];
const waiting = new Map();
port1.on("message", (m) => (m.end ? waiting.get(m.end)?.() : seen.push(m)));
port1.unref();
let registered = false;
let seq = 0;

/** url の本を印付きで import し、その本が直に import した指定子の一覧（解決の順）を返す */
export async function importSpecifiers(url) {
  if (!registered) {
    register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, {
      data: { port: port2 },
      transferList: [port2],
    });
    registered = true;
  }
  seq += 1;
  const tagged = `${url}?import-specifiers=${seq}`;
  const end = `${END}?${seq}`;
  const done = new Promise((resolve) => waiting.set(end, resolve));
  await import(tagged);
  await import(end);
  await done;
  return seen.filter((m) => m.parent === tagged).map((m) => m.specifier);
}
