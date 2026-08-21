#!/usr/bin/env node
/**
 * CSSクラス名衝突検出スクリプト（BOA-207）
 *
 * boatAIはViteでCSSを全ページ分1つのバンドルに結合しており、CSS Modules等の
 * スコープ機構を使っていない。そのため異なるページ専用CSSファイルが同じ
 * セレクタを定義していると、ビルド順（インポート順）次第で意図しない側の
 * 宣言が勝ってしまう事故が過去に複数件発生した（BOA-206対応中に5件発見）。
 *
 * このスクリプトは src/ 配下の全CSSファイルをパースし、同一セレクタが
 * 複数ファイルに存在し、かつ宣言しているプロパティ値が食い違っているものを
 * 「衝突」として報告する。同じ値を重複定義しているだけ（意図的な共有スタイル）
 * は無害なので対象外にする。
 *
 * 使い方: npm run check:css-collisions
 */

import postcss from "postcss";
import { readFileSync } from "fs";
import { glob } from "fs/promises";

const IGNORE_SELECTORS = new Set([
  // 疑似要素セレクタや汎用要素セレクタは対象外にする
  "*",
  "html",
  "body",
  "a",
  "button",
  "code",
]);

async function main() {
  const files = [];
  for await (const f of glob("src/**/*.css")) {
    files.push(f);
  }
  files.sort();

  // selector -> file -> { prop: value }
  const bySelector = new Map();

  for (const file of files) {
    const css = readFileSync(file, "utf-8");
    let root;
    try {
      root = postcss.parse(css, { from: file });
    } catch (e) {
      console.error(`⚠️  パース失敗: ${file}: ${e.message}`);
      continue;
    }

    root.walkRules((rule) => {
      // @keyframes内のfrom/to/0%等は各アニメーション名にスコープされており、
      // 他の@keyframesと衝突しないため対象外にする
      if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") {
        return;
      }

      // コンマ区切りの複合セレクタは個別に分解して扱う
      const selectors = rule.selector
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const selector of selectors) {
        if (IGNORE_SELECTORS.has(selector)) continue;
        // 単純なクラスセレクタ（.foo, .foo.bar, .foo .bar等）のみ対象。
        // 属性セレクタや:has()等の複雑なものは誤検知が多いのでスキップしない
        // （素朴に文字列一致で扱う）。

        if (!bySelector.has(selector)) bySelector.set(selector, new Map());
        const byFile = bySelector.get(selector);
        if (!byFile.has(file)) byFile.set(file, {});
        const props = byFile.get(file);

        rule.walkDecls((decl) => {
          // 同一ファイル内で同じセレクタが複数回出てくる場合は後勝ち
          // （実際のCSSカスケードと同じ挙動）
          props[decl.prop] = decl.value;
        });
      }
    });
  }

  const collisions = [];
  for (const [selector, byFile] of bySelector) {
    if (byFile.size < 2) continue;

    const fileList = [...byFile.keys()];
    const propUnion = new Set();
    for (const props of byFile.values()) {
      Object.keys(props).forEach((p) => propUnion.add(p));
    }

    const conflictingProps = [];
    for (const prop of propUnion) {
      const values = new Set();
      for (const props of byFile.values()) {
        if (prop in props) values.add(props[prop]);
      }
      if (values.size > 1) {
        conflictingProps.push({ prop, values: [...values] });
      }
    }

    if (conflictingProps.length > 0) {
      collisions.push({ selector, files: fileList, conflictingProps });
    }
  }

  if (collisions.length === 0) {
    console.log("✓ CSSクラス名の衝突は検出されませんでした。");
    return;
  }

  console.log(
    `⚠️  ${collisions.length}件のセレクタ衝突を検出しました（値が食い違っているもののみ）:\n`,
  );

  for (const c of collisions) {
    console.log(`【${c.selector}】`);
    console.log(`  定義ファイル: ${c.files.join(", ")}`);
    for (const { prop, values } of c.conflictingProps) {
      console.log(`  - ${prop}: ${values.join("  vs  ")}`);
    }
    console.log("");
  }

  console.log(
    `合計 ${collisions.length} 件。詳細は docs/reference/css-scoping.md を参照。`,
  );
  process.exitCode = 1;
}

main();
