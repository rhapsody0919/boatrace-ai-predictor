/**
 * 依存の向きの規則（dependency-cruiser の forbidden。相対 import の辺、BOA-1428）。
 * 判定の純関数は lintBaselines.js。ここは規則の宣言だけ。
 */
// 固定の版（package.json の devDependencies と同じ。lintDepTree.js が node_modules の bin を直に起こし版を照らす、CI03・BOA-1492）
const DEPENDENCY_CRUISER = "dependency-cruiser@16.10.4";

const UI_DIRS = "components|pages|hooks";
const CONST_DIRS = "constants|config|data";
const DOMAIN_QUERY = "^src/services/([A-Za-z]+)Queries[0-9]*\\.js$";

const forbidden = [
  {
    name: "services-no-ui",
    severity: "error",
    from: { path: "^src/services/" },
    to: { path: `^src/(${UI_DIRS})/` },
  },
  {
    name: "utils-no-up",
    severity: "error",
    from: { path: "^src/utils/" },
    to: { path: `^src/(${UI_DIRS}|services)/` },
  },
  {
    name: "hooks-no-ui",
    severity: "error",
    from: { path: "^src/hooks/" },
    to: { path: "^src/(components|pages)/" },
  },
  {
    name: "components-no-pages",
    severity: "error",
    from: { path: "^src/components/" },
    to: { path: "^src/pages/" },
  },
  {
    name: "src-no-node",
    severity: "error",
    from: { path: "^src/" },
    to: { path: "^(scripts|api)/", pathNot: "^scripts/lib/pure/" },
  },
  {
    // 画面は DB クライアントを直に読まない（データ層 src/services/<領域>Queries*.js 経由。DM00、設計図 §10）。
    // supabaseClient.js と、同等の @supabase/supabase-js の直 import の両方
    name: "ui-no-supabase-client",
    severity: "error",
    from: { path: `^src/(${UI_DIRS})/` },
    to: { path: "^src/services/supabaseClient\\.js$|(^|/)node_modules/@supabase/" },
  },
  {
    name: "api-no-ui-data",
    severity: "error",
    from: { path: "^(api/|middleware\\.js$)" },
    to: { path: `^src/(${UI_DIRS}|services)/` },
  },
  {
    name: "lib-no-entry",
    severity: "error",
    from: { path: "^scripts/lib/" },
    to: { path: "^(scripts/(?!lib/)|api/)" },
  },
  {
    // 別の領域の Queries を直接読まない。領域の間は core*.js を通す（AGENTS.md「構造と依存の向き」）。
    // 2026-11-25 まで prediction・meet を誰からでも許していたが、跨ぐ辺が0になったので外した
    name: "domain-direct",
    severity: "error",
    from: { path: DOMAIN_QUERY },
    to: {
      path: "^src/services/([A-Za-z]+)Queries[0-9]*\\.js$",
      pathNot: ["^src/services/$1Queries[0-9]*\\.js$"],
    },
  },
  {
    // 計算層 src/pure は自分と定数（constants・config・data）だけを読む
    name: "pure-no-up",
    severity: "error",
    from: { path: "^src/pure/" },
    to: { path: "^src/", pathNot: `^src/(pure|${CONST_DIRS})/` },
  },
  {
    // 定数（constants・config・data）は何も上を読まない
    name: "constants-no-up",
    severity: "error",
    from: { path: `^src/(${CONST_DIRS})/` },
    to: { path: "^src/", pathNot: `^src/(${CONST_DIRS})/` },
  },
  {
    // Node 側（scripts・api・middleware）から src は計算層・定数・訳だけ（Vite の構文 import.meta.* は Node で落ちる）。
    // 試験（verify-*.js・verifyData/）は画面とデータ層の関数を直に試すので除く
    name: "node-to-src",
    severity: "error",
    from: {
      path: "^(scripts|api)/|^middleware\\.js$",
      pathNot: "^scripts/maintenance/(verify-[^/]+|verifyData/.+)$",
    },
    to: { path: "^src/", pathNot: `^src/(pure|${CONST_DIRS}|locales)/` },
  },
  {
    name: "no-circular",
    severity: "error",
    from: {},
    to: { circular: true },
  },
];

const options = {
  doNotFollow: { path: "node_modules" },
  exclude: { path: "(^|/)(node_modules|dist|sns-video-studio)(/|$)" },
};

module.exports = { DEPENDENCY_CRUISER, forbidden, options };
