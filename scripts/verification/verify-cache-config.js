/**
 * キャッシュ設定の整合性検証
 * Cache-Control ヘッダーと更新頻度の対応を確認
 *
 * 本文の字は読まない。各 Edge Function を import し、偽の Supabase（fetch の差し替え）で成功の応答を作って
 * Cache-Control を見る。ボット向け HTML（api/_lib/botPage.js）は成功時のヘッダー（SUCCESS_HEADERS）を見る。
 * 鍵・DB には繋がない（Supabase の URL・鍵は偽の値にし、偽の場所以外への fetch は例外にする）。
 */

// キャッシュ設定の定義
const CACHE_PATTERNS = {
  // 毎日1回更新（バッチ実行）
  DAILY_BATCH: {
    name: "毎日1回更新（バッチ実行）",
    expectedMaxAge: 86400,
    expectedSWR: 3600,
    examples: ["accuracy_cache", "race_history_cache", "outcome-distribution"],
  },
  // リアルタイム更新
  REALTIME: {
    name: "リアルタイム/頻繁更新",
    expectedMaxAge: 300,
    expectedSWR: 60,
    examples: ["races/today"],
  },
};

const FAKE_SUPABASE = "https://fake-supabase.invalid";
// Edge Function の成功の応答に要る偽の行（表・RPC ごと）
const FAKE_ROWS = {
  "/rest/v1/accuracy_cache": [{ data: { total: 1 } }],
  "/rest/v1/race_history_cache": [{ data: { days: [] } }],
  "/rest/v1/outcome_distribution": [
    { first_boat: 1, second_boat: 2, third_boat: 3, count_90days: 1, probability: 1, avg_payout: 100, total_races: 1, last_updated: "2026-11-01" },
  ],
  "/rest/v1/rpc/get_today_races": [],
};

// 各 Edge Function の成功の応答の Cache-Control を作る（画面と同じ要求を送る）
const handlerCacheControl = (rel, query) => async () => {
  const { default: handler } = await import(`../../${rel}`);
  const res = await handler(new Request(`https://www.boat-ai.jp/${rel}${query}`));
  if (res.status !== 200) throw new Error(`成功の応答にならない（${res.status}）`);
  return res.headers.get("Cache-Control");
};

// Edge Function のマッピング（ファイル → [期待のパターン, 成功の応答の Cache-Control を取る関数]）
const EDGE_FUNCTIONS = {
  "api/accuracy/index.js": [CACHE_PATTERNS.DAILY_BATCH, handlerCacheControl("api/accuracy/index.js", "")],
  "api/race-history/summary.js": [CACHE_PATTERNS.DAILY_BATCH, handlerCacheControl("api/race-history/summary.js", "?days=90")],
  "api/outcome-distribution/index.js": [
    CACHE_PATTERNS.DAILY_BATCH,
    handlerCacheControl("api/outcome-distribution/index.js", "?venue_code=1"),
  ],
  "api/races/today.js": [CACHE_PATTERNS.REALTIME, handlerCacheControl("api/races/today.js", "")],
  // ボット向け HTML の関数（ADR 0089）。材料の api/races/today.js と同じ s-maxage・swr
  "api/_lib/botPage.js": [
    CACHE_PATTERNS.REALTIME,
    async () => (await import("../../api/_lib/botPage.js")).SUCCESS_HEADERS["Cache-Control"],
  ],
};

// 偽の Supabase。Edge Function が import 時に読む URL・鍵を偽の値にし、fetch は偽の場所の表だけに答える
function installFakeSupabase() {
  process.env.VITE_SUPABASE_URL = FAKE_SUPABASE;
  process.env.SUPABASE_URL = FAKE_SUPABASE;
  process.env.VITE_SUPABASE_ANON_KEY = "fake-anon-key";
  process.env.SUPABASE_ANON_KEY = "fake-anon-key";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.origin !== FAKE_SUPABASE) throw new Error(`偽の Supabase の外への fetch: ${url.origin}`);
    const rows = FAKE_ROWS[url.pathname];
    if (!rows) throw new Error(`偽の Supabase に無い表: ${url.pathname}`);
    return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

async function verifyCacheConfig() {
  console.log("🔍 キャッシュ設定検証を開始します\n");

  let hasErrors = false;

  installFakeSupabase();
  const consoleError = console.error;
  for (const [filePath, [expectedPattern, readCacheControl]] of Object.entries(EDGE_FUNCTIONS)) {
    try {
      // Cache-Control ヘッダーを成功の応答から取る（失敗の応答の console.error は黙らせる）
      console.error = () => {};
      let cacheControl;
      try {
        cacheControl = await readCacheControl();
      } finally {
        console.error = consoleError;
      }
      if (!cacheControl) {
        console.log(`❌ ${filePath}`);
        console.log(`   Cache-Control ヘッダーが見つかりません\n`);
        hasErrors = true;
        continue;
      }

      const maxAgeMatch = cacheControl.match(/s-maxage=(\d+)/);
      const swrMatch = cacheControl.match(/stale-while-revalidate=(\d+)/);

      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : null;
      const swr = swrMatch ? parseInt(swrMatch[1]) : null;

      // 検証
      const isMaxAgeCorrect = maxAge === expectedPattern.expectedMaxAge;
      const isSwrCorrect = swr === expectedPattern.expectedSWR;

      if (isMaxAgeCorrect && isSwrCorrect) {
        console.log(`✅ ${filePath}`);
        console.log(
          `   パターン: ${expectedPattern.name} (s-maxage=${maxAge}, swr=${swr})\n`,
        );
      } else {
        console.log(`⚠️  ${filePath}`);
        console.log(`   期待: ${expectedPattern.name}`);
        console.log(
          `        s-maxage=${expectedPattern.expectedMaxAge}, swr=${expectedPattern.expectedSWR}`,
        );
        console.log(`   実際: s-maxage=${maxAge}, swr=${swr}\n`);
        hasErrors = true;
      }
    } catch (error) {
      console.log(`❌ ${filePath}`);
      console.log(`   エラー: ${error.message}\n`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("\n❌ キャッシュ設定に不整合があります");
    process.exit(1);
  } else {
    console.log("\n✅ キャッシュ設定は正しく統一されています");
  }
}

verifyCacheConfig();
