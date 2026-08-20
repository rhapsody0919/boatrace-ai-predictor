#!/usr/bin/env node
// トークンのコントラスト自動検証（ADR 0017）
// design-tokens.css の意味トークンの組み合わせが WCAG AA（通常テキスト4.5:1）を
// 満たすかを検証する。外部依存なし、Node単体で完結する。

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(__dirname, "../../src/styles/design-tokens.css");

// 検証する「背景トークン × 文字トークン」の組み合わせ
// 龍神レーダーのブランド刷新で新設した意味トークンが対象
const PAIRS = [
  { bg: "--surface-page", fg: "--text-primary", label: "ページ背景 × 本文" },
  {
    bg: "--surface-page",
    fg: "--text-secondary",
    label: "ページ背景 × 補助テキスト",
  },
  { bg: "--surface-card", fg: "--text-primary", label: "カード背景 × 本文" },
  {
    bg: "--surface-card",
    fg: "--text-secondary",
    label: "カード背景 × 補助テキスト",
  },
  {
    bg: "--surface-page",
    fg: "--brand-accent-primary",
    label: "ページ背景 × 金アクセント",
  },
  {
    bg: "--surface-page",
    fg: "--brand-accent-secondary",
    label: "ページ背景 × 銀アクセント",
  },
  {
    bg: "--surface-card",
    fg: "--brand-accent-primary",
    label: "カード背景 × 金アクセント",
  },
  {
    bg: "--surface-card",
    fg: "--brand-accent-secondary",
    label: "カード背景 × 銀アクセント",
  },
  {
    bg: "--surface-card",
    fg: "--podium-bronze-text",
    label: "カード背景 × 銅（3着）",
  },
];

const AA_NORMAL_TEXT = 4.5;

function extractBlock(css, selector) {
  // `selector { ... }` を1つ抜き出す（ネストなし前提、design-tokens.cssの構造に合わせた簡易パーサ）
  const start = css.indexOf(selector);
  if (start === -1) return null;
  const braceStart = css.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  return null;
}

function parseDeclarations(block) {
  const map = {};
  if (!block) return map;
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(block))) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

function resolveValue(name, scopeMap, fallbackMap, seen = new Set()) {
  if (seen.has(name)) throw new Error(`循環参照を検出: ${name}`);
  seen.add(name);
  const raw = scopeMap[name] ?? fallbackMap[name];
  if (raw === undefined) throw new Error(`未定義のトークン: ${name}`);
  const varMatch = raw.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    return resolveValue(varMatch[1], scopeMap, fallbackMap, seen);
  }
  return raw;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

function checkTheme(themeName, scopeMap, baseMap) {
  console.log(`\n=== ${themeName} ===`);
  let hasFailure = false;
  for (const pair of PAIRS) {
    const bgHex = resolveValue(pair.bg, scopeMap, baseMap);
    const fgHex = resolveValue(pair.fg, scopeMap, baseMap);
    const ratio = contrastRatio(bgHex, fgHex);
    const pass = ratio >= AA_NORMAL_TEXT;
    if (!pass) hasFailure = true;
    const status = pass ? "OK  " : "FAIL";
    console.log(
      `[${status}] ${pair.label.padEnd(20, "　")} ${bgHex} / ${fgHex} = ${ratio.toFixed(2)}:1（基準 ${AA_NORMAL_TEXT}:1）`,
    );
  }
  return hasFailure;
}

function main() {
  const css = readFileSync(TOKENS_PATH, "utf-8");
  const rootBlock = extractBlock(css, ":root {");
  const darkBlock = extractBlock(css, '[data-theme="dark"] {');
  const lightBlock = extractBlock(css, '[data-theme="light"] {');

  const rootMap = parseDeclarations(rootBlock);
  const darkMap = { ...rootMap, ...parseDeclarations(darkBlock) };
  const lightMap = { ...rootMap, ...parseDeclarations(lightBlock) };

  let hasFailure = false;
  hasFailure = checkTheme("ライトテーマ", lightMap, rootMap) || hasFailure;
  hasFailure = checkTheme("ダークテーマ", darkMap, rootMap) || hasFailure;

  console.log("");
  if (hasFailure) {
    console.error(
      `✗ WCAG AA基準（${AA_NORMAL_TEXT}:1）を満たさない組み合わせがあります。トークン値を調整してください。`,
    );
    process.exit(1);
  } else {
    console.log("✓ すべての組み合わせがWCAG AA基準を満たしています。");
  }
}

main();
