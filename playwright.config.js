import { defineConfig } from "@playwright/test";
import { createHash } from "node:crypto";

// このマシンでは複数のgit worktreeが並行してdevサーバーを起動する運用のため、
// 既定ポート5173を全worktreeで共有すると、reuseExistingServer:true経由で
// 「別worktreeの（時に.env.local未配置でSupabase未接続の壊れた）サーバー」に
// 誤接続し、Supabase依存の全テストがデータ空("データが見つかりません")で
// 一貫して失敗する事故が繰り返し発生した（2026-08-29 / 2026-09-16再発）。
// PW_PORT未指定時はworktreeの絶対パスから決定的にポートを算出し、
// worktreeごとに自然に分散させる。
function derivePortFromCwd() {
  const hash = createHash("sha256").update(process.cwd()).digest();
  return 40000 + (hash.readUInt16BE(0) % 10000);
}

const explicitPort = process.env.PW_PORT;
const port = explicitPort || String(derivePortFromCwd());

export default defineConfig({
  testDir: "./e2e",
  // 本番Supabaseに直接接続するため、DB応答の揺らぎで読み込み待ちが伸びる。
  // 既定の5秒expect・30秒テストではDBが少し遅いだけで大量に失敗するため余裕を持たせる
  timeout: 60000,
  expect: { timeout: 15000 },
  // smoke.spec.jsには個別のtimeout指定が多数あり上記の延長が効かないため、CIでは
  // 1回だけリトライする。実行のたびに別のテストが単発で落ちる原因は、CDN・RPCの
  // コールドスタートで1回目だけ遅れることで、2回目はキャッシュが温まり通る。
  // 2回続けて落ちるものは本物の不具合として失敗のまま残る
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  // 2026-09-25まで、E2Eは既定ビューポート（1280x720）だけで走っており、
  // モバイル幅も広いPC幅も一度も検証されていなかった。モバイルファーストのPWAを
  // 標榜しながら主戦場が未検証で、実際にトップページのブログ一覧が1440px以上で
  // 右側に大きく空白を作る状態が放置されていた（ADR-0073）。
  //
  // 既存の smoke 側は従来どおり1回だけ走らせ（ビューポートも変えない。
  // レスポンシブ分岐の前提が変わって既存テストが揺れるのを避ける）、
  // 幅を横断するのは layout.spec.js だけにする。smoke の934件のうち792件は
  // venue-guide-data.spec.js のデータ検証でブラウザを使わないため多軸化しても
  // 意味が無く、対象になるのは smoke.spec.js の142件だけ。それを3軸に広げても
  // 得られるのは主に「モバイルでも同じ要素が見えるか」で、レイアウト崩れの
  // 検知は専用テストのほうが直接的かつ具体的に失敗理由を出せる。
  projects: [
    {
      name: "smoke",
      testIgnore: /layout\.spec\.js/,
    },
    {
      name: "layout-mobile",
      testMatch: /layout\.spec\.js/,
      use: {
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
    // 768 / 1024 は App.css のメディアクエリの境界。ここを飛ばすと、
    // 「3列に必要な幅に届かず列が落ちる」帯の崩れを見逃す（実際に見逃した）
    {
      name: "layout-tablet",
      testMatch: /layout\.spec\.js/,
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: "layout-laptop",
      testMatch: /layout\.spec\.js/,
      use: { viewport: { width: 1024, height: 768 } },
    },
    {
      name: "layout-desktop",
      testMatch: /layout\.spec\.js/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "layout-wide",
      testMatch: /layout\.spec\.js/,
      use: { viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // PW_PORTを明示指定した場合のみ既存サーバーの再利用を許可する
    // （開発者が意図的に指定した前提）。無指定時は上記の自動導出ポートで
    // 必ず新規起動し、他worktreeのサーバーへの誤接続を構造的に防ぐ。
    // ポートが衝突した場合は--strictPortにより起動失敗という分かりやすい
    // エラーになる（サイレントな誤接続よりはるかに気づきやすい）。
    reuseExistingServer: Boolean(explicitPort) && !process.env.CI,
    timeout: 30000,
  },
});
