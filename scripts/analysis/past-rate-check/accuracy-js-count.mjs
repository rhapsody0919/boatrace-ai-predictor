// BOA-635 検証: 本番の layer に対して JS の countPastRate・mainText・noteText・decisionCount を流す
// 使い方: node js-count.mjs <repo> <layersDir> <choices.json> <raceId...>
import fs from "node:fs";
import path from "node:path";
const [repo, dir, choicesPath, ...ids] = process.argv.slice(2);
const { countPastRate, decisionCount } = await import(path.join(repo, "src/utils/pastRate/count.js"));
const { isTruncated } = await import(path.join(repo, "src/utils/pastRate/layer.js"));
const { mainText, noteText, pctText } = await import(path.join(repo, "src/components/race/pastRate/format.js"));
const ja = JSON.parse(fs.readFileSync(path.join(repo, "src/locales/ja/common.json"), "utf8"));
const t = (key, vars = {}) => {
  let v = key.split(".").reduce((o, k) => o?.[k], ja);
  if (typeof v !== "string") return key;
  return v.replace(/{{(\w+)}}/g, (_, k) => String(vars[k] ?? ""));
};
const choices = JSON.parse(fs.readFileSync(choicesPath, "utf8"));
const out = {};
for (const id of ids) {
  const layer = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
  const tr = isTruncated(layer);
  const res = choices.map(({ type, input }) => {
    const r = countPastRate(layer.rows, type, input);
    return { type, input, n: r.n, count: r.count, excluded: r.excluded.reduce((s, e) => s + e.count, 0),
      pct: pctText(r), main: r.n ? mainText(r, tr, t) : null };
  });
  out[id] = { truncated: tr, note: noteText(layer, tr, null, t), res };
  const dec = process.env[`DEC_${id.replace(/-/g, "_")}`];
  if (dec) {
    const d = dec.split("-").map(Number);
    const r = decisionCount(layer.rows, d);
    out[id].decision = { combo: dec, n: r.n, count: r.count, main: mainText(r, tr, t) };
  }
}
console.log(JSON.stringify(out));
