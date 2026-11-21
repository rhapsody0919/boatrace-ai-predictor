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

// 2b. 形は台本の名前（「横一線」等）で渡す。頁は ja の文言で名前 → 形に戻すので、名前が全部あり、重ならない
{
  const ja = JSON.parse(readFileSync(join(ROOT, "src/locales/ja/common.json"), "utf8"));
  const { SLIT_FORMS } = await import("../../src/utils/analogyScenario.js");
  const names = SLIT_FORMS.map((f) => ja.aiPredictionTab?.analogy?.scenario?.forms?.[f]?.name);
  assert.ok(names.every((x) => typeof x === "string" && x), `形の名前（aiPredictionTab.analogy.scenario.forms.*.name）が ja に無い: ${names}`);
  assert.equal(new Set(names).size, names.length, `形の名前が重なる: ${names}`);
}

// 3. 本番のビルドに入らない: main.jsx を本番と同じ置き換え（import.meta.env の旗）と木の刈り込み（rollup）で
// 組み、旗の無いビルドに撮影用の頁の import が残らず、旗 "1" のビルドには分岐の中の動的 import として残ることを見る
// （本文の字でなく、組んだ結果の振る舞い。main.jsx 以外の import は外のまま）
async function buildMain(flag) {
  const entry = join(ROOT, "src", "main.jsx");
  const { rollup } = await import("rollup");
  const { transformWithEsbuild } = await import("vite");
  const bundle = await rollup({
    input: entry,
    onwarn: () => {},
    plugins: [
      {
        name: "main-only",
        resolveId: (id, importer) => (importer ? { id, external: true } : null),
        transform: (code, id) =>
          transformWithEsbuild(code, id, {
            loader: "jsx",
            jsx: "automatic",
            define: { "import.meta.env.VITE_SNS_CAPTURE": flag === undefined ? "undefined" : JSON.stringify(flag) },
          }),
      },
    ],
  });
  const { output } = await bundle.generate({ format: "es" });
  await bundle.close();
  return output.map((o) => o.code ?? "").join("\n");
}
const SNS_IMPORT = /import\(\s*['"]\.\/snsCapture\/F01Capture\.jsx['"]\s*\)/;
const prodBuild = await buildMain(undefined);
assert.doesNotMatch(
  prodBuild,
  /snsCapture/,
  "旗の無い本番のビルドに撮影用の頁（snsCapture）が残る。main.jsx の分岐を import.meta.env.VITE_SNS_CAPTURE === '1' で閉じる",
);
assert.match(prodBuild, /createRoot/, "旗の無いビルドで本番の画面を描く分岐が消えた");
const captureBuild = await buildMain("1");
assert.match(
  captureBuild,
  SNS_IMPORT,
  "旗 VITE_SNS_CAPTURE=1 のビルドに撮影用の頁の動的 import が無い",
);
assert.match(
  captureBuild,
  /\/sns-capture\//,
  "撮影用の頁は /sns-capture/ の道でだけ描く（旗が立っても本番の道では描かない）",
);
const otherFlag = await buildMain("0");
assert.doesNotMatch(otherFlag, /snsCapture/, "旗が \"1\" 以外のビルドに撮影用の頁が残る");
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
