/**
 * 完全版 f01 の撮影用の頁（src/snsCapture/、docs/design/f01-stable-capture/）の型の検査。
 *
 * 1. 部品の表（F01_PARTS）の props の名前が、部品（名前付き export の関数）の引数の名前とちょうど同じ
 *    （本番の部品の props が変わったら、ここで落ちる。本番の見た目の変更では落ちない）
 * 2. f01PartProps が固定の材料（fixtures）から全部品の props を作れ、名前が表と同じ
 * 3. 撮影用の頁は main.jsx がビルドの旗（VITE_SNS_CAPTURE）で閉じた分岐からだけ読み込む（本番のビルドに入らない）
 *
 * 外部接続なし・同じコミットなら同じ結果（tier=ci）。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { F01_PARTS, f01PartProps, sankeyFirstBox } =
  await import("../../src/snsCapture/f01Parts.js");

/** file の名前付き export の関数 name の、最初の引数（分割代入）の名前 */
function paramNames(file, name) {
  const ast = parse(readFileSync(join(ROOT, file), "utf8"), {
    sourceType: "module",
    plugins: ["jsx"],
  });
  for (const node of ast.program.body) {
    if (
      node.type !== "ExportNamedDeclaration" ||
      node.declaration?.type !== "FunctionDeclaration"
    )
      continue;
    if (node.declaration.id?.name !== name) continue;
    const p = node.declaration.params[0];
    assert.equal(
      p?.type,
      "ObjectPattern",
      `${file} の ${name} の引数が分割代入でない`,
    );
    return p.properties.map((x) => {
      assert.equal(
        x.type,
        "ObjectProperty",
        `${file} の ${name} の引数に ...rest がある（名前を照合できない）`,
      );
      return x.key.name;
    });
  }
  throw new Error(
    `${file} に名前付き export の関数 ${name} が無い（撮影用の頁が描く部品）`,
  );
}

// 1. 部品の引数と表
for (const [part, def] of Object.entries(F01_PARTS)) {
  const declared = paramNames(def.file, def.component).sort();
  assert.deepEqual(
    [...def.props].sort(),
    declared,
    `撮影用の部品 ${part}（${def.component}）の props が部品の引数と違う。src/snsCapture/f01Parts.js の F01_PARTS と f01PartProps を直す`,
  );
}

// 2. 固定の材料から props を作る（全部品・押す前と押した後・軸）
const FX = join(
  ROOT,
  "sns-video-studio/remotion/scripts/full-picture/fixtures",
);
const fixtures = readdirSync(FX).filter((f) => f.endsWith(".json.gz"));
assert.ok(fixtures.length > 0, "固定の材料が無い");
const fx0 = JSON.parse(gunzipSync(readFileSync(join(FX, fixtures[0]))).toString("utf8"));
for (const f of fixtures) {
  const m = JSON.parse(gunzipSync(readFileSync(join(FX, f))).toString("utf8"));
  const forms =
    (m.api.scenario?.data ?? m.api.scenario)?.scenario?.cells?.waku?.forms ??
    {};
  const form = Object.keys(forms).find((k) => k !== "any" && forms[k]?.n > 0);
  assert.ok(form, `${f} に件数のある形（any 以外）が無い。固定の材料を見直す`);
  const cases = [
    ["radar", {}],
    ["rows", {}],
    ["winBars", {}],
    ["flow", { tab: "similar" }],
    ["flow", { tab: "similar", first: "1" }],
    ["pattern", { form }],
    ["flow", { tab: "scenario", form }],
    ["followTop", { axis: "1" }],
    ["followTop", { axis: "4" }],
    ["followTable", { axis: "2" }],
  ];
  for (const [part, q] of cases) {
    const props = f01PartProps(part, m, q);
    assert.deepEqual(
      Object.keys(props).sort(),
      [...F01_PARTS[part].props].sort(),
      `${f} の ${part} の props の名前が表と違う`,
    );
  }
  // 押す前の流れのカーソルの先（1着の四角）は viewBox の中
  const b = sankeyFirstBox(f01PartProps("flow", m, { tab: "similar" }).tri, 1);
  assert.ok(b.y >= 0 && b.y + b.h <= 400 && b.h > 0, `${f} の1着の四角の箱`);
}
assert.throws(
  () => f01PartProps("radar", { api: {} }, {}),
  /材料に api.facts が無い/,
  "材料が無いときは黙らず止める",
);
assert.throws(
  () => f01PartProps("followTop", fx0, { axis: "9" }),
  /1〜6/,
);
assert.throws(() => f01PartProps("nope", {}, {}), /撮影用の部品 nope は無い/);

// 3. 本番のビルドに入らない: 頁を読むのは main.jsx の旗の分岐の中の動的 import だけ
const main = readFileSync(join(ROOT, "src/main.jsx"), "utf8");
// 旗の変数（import.meta.env.VITE_SNS_CAPTURE === "1" を含む式）と、その変数で分けた if の中身（改行・空白の違いは問わない）
const flag = main.match(
  /const (\w+)\s*=\s*import\.meta\.env\.VITE_SNS_CAPTURE\s*===\s*['"]1['"]/,
);
const gate =
  flag &&
  main.match(new RegExp(`if \\(${flag[1]}\\)\\s*\\{([\\s\\S]*?)\\}\\s*else\\s*\\{`));
assert.ok(
  gate,
  "main.jsx の撮影用の頁の分岐が、import.meta.env.VITE_SNS_CAPTURE === '1' で閉じていない",
);
assert.match(
  gate[1],
  /import\(['"]\.\/snsCapture\/F01Capture\.jsx['"]\)/,
  "撮影用の頁は旗の分岐の中で動的 import する",
);
const walk = (d) =>
  readdirSync(d).flatMap((x) =>
    statSync(join(d, x)).isDirectory() ? walk(join(d, x)) : [join(d, x)],
  );
const importers = walk(join(ROOT, "src"))
  .filter(
    (p) =>
      /\.(jsx?|mjs)$/.test(p) && !p.includes(`${join("src", "snsCapture")}`),
  )
  // import の指定（静的・動的・再 export）に snsCapture を含むファイル。コメントの言及は数えない
  .filter((p) =>
    /(?:\bfrom\s*|\bimport\s*\(?\s*)['"][^'"]*snsCapture[^'"]*['"]/.test(
      readFileSync(p, "utf8"),
    ),
  )
  .map((p) => relative(ROOT, p));
assert.deepEqual(
  importers,
  ["src/main.jsx"],
  "撮影用の頁を読むのは main.jsx だけ（ほかから読むと本番のビルドに入る）",
);

console.log("verify-f01-capture-contract: OK");
