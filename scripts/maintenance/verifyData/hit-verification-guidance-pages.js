/**
 * verify-hit-verification-guidance.js の道具。verify ではない。DB・公式・ネットには繋がない。
 *   renderedSentences(page, path) … 頁を描いて、見える文を「。」と改行で区切って返す（空白は除く）
 *   importersOf(target, modules)   … modules を読み込んだとき、target の部品を import した module の一覧
 *                                    （module の import を読み込みの道で見る。本文の字を fs で読まない）
 */
import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";
import { register } from "node:module";
import { renderJsx } from "../../lib/renderJsx.js";
import { renderPage } from "./jsx-page-render.js";
import { quietly } from "./jsx-page-stubs.js";

const SRC = new URL("../../../src/", import.meta.url);

/** 頁を描いた DOM の文（「。」と改行で区切り、空白を除く） */
export async function renderedSentences(page, path) {
  const view = await renderPage(page, { path });
  const text = view.container.textContent;
  await view.unmount();
  return text.split(/[。\n]/).map((s) => s.replace(/\s+/g, ""));
}

const HOOKS = `
let port = null;
let target = "";
export async function initialize(data) { port = data.port; target = data.target; }
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  if (context.parentURL && resolved.url === target) port.postMessage(context.parentURL);
  return resolved;
}
`;

/** modules（src/ からの相対）を読み込み、target（src/ からの相対）を import した module の src/ からの相対を昇順で返す */
export async function importersOf(target, modules) {
  const { port1, port2 } = new MessageChannel();
  // 先に renderJsx の hooks（.jsx の変換）を入れてから、記録の hook を足す（後に登録した hook が先に呼ばれ、解決後の URL を見られる）
  await quietly(() => renderJsx(new URL("../../../src/components/MotorStatBadgeRow.jsx", import.meta.url), { icon: "", label: "", badges: [] }).then((v) => v.unmount()));
  register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, {
    parentURL: import.meta.url,
    data: { port: port2, target: new URL(target, SRC).href },
    transferList: [port2],
  });
  await quietly(() => Promise.all(modules.map((m) => import(new URL(m, SRC).href))));
  const found = new Set();
  for (let m = receiveMessageOnPort(port1); m; m = receiveMessageOnPort(port1)) {
    found.add(m.message.slice(SRC.href.length));
  }
  port1.close();
  return [...found].sort();
}
