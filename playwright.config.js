import { defineConfig } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

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

// 既定（replay）は e2e/recordings/ の録画を再生し、時計を録画時刻に固定する。
// E2E_LIVE=1 で本番データ・実時刻、E2E_RECORD=1 で撮り直し（e2e/fixtures.js、ADR-0077）
const isReplay = process.env.E2E_LIVE !== "1" && process.env.E2E_RECORD !== "1";

// replay では、フロントが叩く Supabase のオリジンを録画時と揃える
// （HAR はURLの完全一致で引くため）。Vite は既存の環境変数を .env より優先する。
// 録画の本体は GitHub Release にあり、ここ（設定の読み込み時）ではまだ取得していないので、
// ポインタ（e2e/recording.json）から読む。E2E_RECORDING_SOURCE=local（手元で撮った録画を
// そのまま再生する）のときは e2e/recordings/meta.json から読む。
// anon キーは上書きしない。録画に無い通信は本番へ素通しするため、実キーが要る（ADR-0077）
function replayServerEnv() {
  if (!isReplay) return undefined;
  const local = process.env.E2E_RECORDING_SOURCE === "local";
  const file = local ? "e2e/recordings/meta.json" : "e2e/recording.json";
  let source;
  try {
    source = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `${file} を読めません（E2Eの録画が無い）: ${error.message}`,
    );
  }
  return { ...process.env, VITE_SUPABASE_URL: source.supabaseOrigin };
}

const explicitPort = process.env.PW_PORT;
const port = explicitPort || String(derivePortFromCwd());

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.js",
  globalTeardown: "./e2e/global-teardown.js",
  // 本番Supabaseに直接接続するため、DB応答の揺らぎで読み込み待ちが伸びる。
  // 既定の5秒expect・30秒テストではDBが少し遅いだけで大量に失敗するため余裕を持たせる
  timeout: 60000,
  expect: { timeout: 15000 },
  // smoke.spec.jsには個別のtimeout指定が多数あり上記の延長が効かないため、CIでは
  // 1回だけリトライする。実行のたびに別のテストが単発で落ちる原因は、CDN・RPCの
  // コールドスタートで1回目だけ遅れることで、2回目はキャッシュが温まり通る。
  // 2回続けて落ちるものは本物の不具合として失敗のまま残る
  retries: process.env.CI ? 1 : 0,
  // JSONも出すのは、skipされたテストを機械的に数えるため。
  // データ依存の test.skip() が常に真になると、そのテストは無言で無効化され、
  // 「テストがある」まま何も検証しない状態が続く。実際に320px横スクロールの
  // テスト7個が、selectUpcomingRace が常に false を返すせいで長期間skipされ、
  // 誰も気づいていなかった（3b6ef2ce）。
  // scripts/maintenance/check-e2e-skips.js がこのJSONを読む。
  reporter: [["list"], ["json", { outputFile: "e2e-results.json" }]],
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
      // acceptance/ は playwright.acceptance.config.js で別に走らせる（PRゲート外）
      testIgnore: [/layout\.spec\.js/, /acceptance\//],
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
    // E2E_SERVER=preview は vite build 済みの dist を vite preview で配る（BOA-769 B の実験。
    // dev はリクエストのたびに変換するので CI の CPU を食う）。build は呼び出し側で先に済ませる
    command:
      process.env.E2E_SERVER === "preview"
        ? `npx vite preview --port ${port} --strictPort`
        : `npm run dev -- --port ${port} --strictPort`,
    env: replayServerEnv(),
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
