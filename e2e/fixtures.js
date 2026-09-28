import { test as base, expect } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalUrl, harKey, LOCAL_ORIGIN_PLACEHOLDER } from "./har-merge.js";

/**
 * E2Eの通信と時計を「録画時点」に固定する共通fixture（BOA-466、ADR-0077）。
 *
 * ## なぜ要るか
 *
 * E2Eは本番Supabase（/rest/v1/*）と /api/*（vite のプロキシで本番へ転送）に
 * 直結していたため、同じコードでも当日のデータと実行時刻で結果が変わった
 * （PRごとの実行で直近30回中14回失敗）。フロントは new Date() を約70箇所で使い、
 * 「本日開催中の未終了レース」が無い時間帯はテストが skip していた。
 *
 * ## 3つのモード
 *
 *   replay（既定）  e2e/recordings/api.har から応答を返し、ブラウザ時計を録画時刻に固定する。
 *                   録画に無い /rest/v1/*・/api/* は abort（素通ししない）。
 *                   それ以外の外部ホスト（GA・フォント等）も abort する
 *   record          E2E_RECORD=1。本番へ繋いだまま、テストごとに応答を HAR に書き出す。
 *                   時計は global-setup が決めた録画時刻に固定する（replay と同じURLになるように）
 *   live            E2E_LIVE=1。従来どおり本番データ・実時刻で実行する（定期実行用）
 *
 * ## 個別の page.route との関係
 *
 * HAR の再生は context に登録する。spec 側の page.route は page に登録されるため
 * context より先に評価され、そちらが優先される（Playwright の仕様）。
 * page.route で route.fallback() / continue() した場合は context の HAR に落ちる。
 */

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const RECORDINGS_DIR = path.join(repoRoot, "e2e", "recordings");
export const HAR_PATH = path.join(RECORDINGS_DIR, "api.har");
export const META_PATH = path.join(RECORDINGS_DIR, "meta.json");
/** 応答本文（内容の sha1 を名前にしたファイル）。api.har の content._file から参照する */
export const BODIES_DIR = path.join(RECORDINGS_DIR, "bodies");
/** record モードで global-setup が今回の録画時刻を入れる環境変数（ワーカーに引き継がれる） */
export const RECORDED_AT_ENV = "E2E_RECORDED_AT";
/**
 * record モードで context ごとの HAR を書き出すファイル名の接頭辞（testInfo.outputPath 配下）。
 * 1テストで context を複数作る場合があるため連番を付ける
 */
export const RAW_HAR_PREFIX = "api-recording-";
/** record モードで、replay 時に止められる外部通信を書き出すファイル名の接頭辞 */
export const RAW_EXTERNAL_PREFIX = "external-requests-";
let recordSeq = 0;

export const E2E_MODE =
  process.env.E2E_LIVE === "1"
    ? "live"
    : process.env.E2E_RECORD === "1"
      ? "record"
      : "replay";

/** 録画・再生の対象。Supabase REST と、ローカルdevサーバー経由の /api/* */
export const RECORDED_URL =
  /^https:\/\/[^/]+\.supabase\.co\/rest\/v1\/|^http:\/\/localhost:\d+\/api\//;

const isLocal = (url) => /^http:\/\/localhost:\d+\//.test(url);
const isNonNetwork = (url) => /^(data|blob|about|chrome-extension):/.test(url);

function readJson(file, hint) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} を読めません（${hint}）: ${error.message}`);
  }
}

let cachedNow;
/**
 * テストが「今」として扱う時刻。replay/record では録画時刻、live では実時刻。
 * spec 側で当日の日付を組み立てるときは new Date() ではなくこれを使う
 * （ブラウザ側の時計と Node 側の時計がずれると、別の日付を見に行ってしまう）。
 */
export function e2eNow() {
  if (E2E_MODE === "live") return new Date();
  if (!cachedNow) {
    const recordedAt =
      E2E_MODE === "record"
        ? process.env[RECORDED_AT_ENV]
        : readJson(
            META_PATH,
            "録画がありません。npm run test:e2e:record で撮り直してください",
          ).recordedAt;
    cachedNow = new Date(recordedAt);
    if (Number.isNaN(cachedNow.getTime())) {
      throw new Error(
        `録画時刻が不正です: ${recordedAt}（record モードは global-setup が設定する）`,
      );
    }
  }
  return cachedNow;
}

/** JST の YYYY-MM-DD（e2eNow 基準） */
export function e2eTodayJST() {
  return new Date(e2eNow().getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

let cachedReplayHar;
/**
 * 録画はローカルのオリジンを LOCAL_ORIGIN_PLACEHOLDER で保存している
 * （devサーバーのポートはworktreeごとに変わるため）。今回の baseURL に置き換えた
 * コピーを test-results 配下に作り、routeFromHAR にはそれを渡す。
 */
function replayHar(testInfo) {
  if (cachedReplayHar) return cachedReplayHar;
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL)
    throw new Error("playwright.config.js の use.baseURL が未設定です");
  let text;
  try {
    text = readFileSync(HAR_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `${HAR_PATH} を読めません（録画がありません。npm run test:e2e:record で撮り直してください）: ${error.message}`,
    );
  }
  const file = path.join(
    testInfo.project.outputDir,
    ".replay",
    `api-${process.pid}.har`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  const har = JSON.parse(
    text.replaceAll(LOCAL_ORIGIN_PLACEHOLDER, new URL(baseURL).origin),
  );
  // 本文は content._file（api.har からの相対パス）で参照している。
  // コピー先から読めるよう絶対パスに直す
  for (const entry of har.log.entries) {
    const content = entry.response.content;
    if (content._file) content._file = path.join(RECORDINGS_DIR, content._file);
  }
  writeFileSync(file, JSON.stringify(har));
  const keys = new Set(
    har.log.entries.map((e) =>
      harKey(e.request.method, e.request.url, e.request.postData?.text),
    ),
  );
  cachedReplayHar = { file, keys };
  return cachedReplayHar;
}

/**
 * context に録画の再生（または録画）と時計の固定を適用する。
 * fixture を通らずに browser.newContext() で作った context にも呼ぶこと。
 */
export async function applyRecording(context, testInfo) {
  if (E2E_MODE === "live") return;

  // setFixedTime は Date だけを固定し、setTimeout 等のタイマーは実時間で進める。
  // 既存の待機（waitFor・アニメーション・リトライ間隔）はそのまま動く
  await context.clock.setFixedTime(e2eNow());

  if (E2E_MODE === "record") {
    const seq = recordSeq++;
    // replay では止める外部通信を記録し、global-teardown が一覧で報告する
    const external = new Set();
    context.on("request", (request) => {
      const url = request.url();
      if (!isLocal(url) && !isNonNetwork(url) && !RECORDED_URL.test(url)) {
        external.add(new URL(url).origin);
      }
    });
    // テスト終了時にまだ応答を受け取り切っていないリクエストは、HAR に本文無しで
    // 残る（実測で1回の録画に26件）。context を閉じる前に受け取り切るのを待つ
    const inflight = new Set();
    context.on("request", (request) => {
      if (RECORDED_URL.test(request.url())) inflight.add(request);
    });
    context.on("requestfinished", (request) => inflight.delete(request));
    context.on("requestfailed", (request) => inflight.delete(request));
    inflightByContext.set(context, inflight);
    context.on("close", () => {
      writeFileSync(
        testInfo.outputPath(`${RAW_EXTERNAL_PREFIX}${seq}.json`),
        JSON.stringify([...external]),
      );
    });
    await context.routeFromHAR(
      testInfo.outputPath(`${RAW_HAR_PREFIX}${seq}.har`),
      {
        url: RECORDED_URL,
        update: true,
        updateContent: "embed",
        updateMode: "minimal",
      },
    );
    return;
  }

  const { file, keys } = replayHar(testInfo);
  await context.routeFromHAR(file, {
    url: RECORDED_URL,
    notFound: "abort",
  });
  // 録画に無くて abort されるリクエストを覚えておき、テストが落ちたときに出す
  // （「録画漏れ」と「実バグ」を切り分けるため）
  const misses = new Set();
  missesByContext.set(context, misses);
  // HAR の対象外で、ローカルdevサーバー以外へ出ていく通信（GA・外部フォント・
  // 外部画像等）も止める。登録順が後の route が先に評価されるため、
  // 対象URLは fallback で HAR 側へ回す
  await context.route(
    (url) =>
      RECORDED_URL.test(url.href) ||
      (!isLocal(url.href) && !isNonNetwork(url.href)),
    (route) => {
      const request = route.request();
      if (!RECORDED_URL.test(request.url())) {
        return route.abort("blockedbyclient");
      }
      // in.(...) の並びを録画側と揃える（har-merge.js の canonicalUrl）。
      // fallback で URL を差し替えると、後ろの routeFromHAR はその URL で引く
      const url = canonicalUrl(request.url());
      const key = harKey(request.method(), url, request.postData());
      if (!keys.has(key)) {
        misses.add(`${request.method()} ${url}`);
        // fixture を通らない context（browser.newContext）の分もその場で見られるように
        if (process.env.E2E_DEBUG_MISSES) {
          console.log(`[e2e replay] 録画に無い: ${request.method()} ${url}`);
        }
      }
      return url === request.url() ? route.fallback() : route.fallback({ url });
    },
  );
}

const missesByContext = new WeakMap();
const inflightByContext = new WeakMap();
const INFLIGHT_WAIT_MS = 30000;

async function waitForInflight(context) {
  const inflight = inflightByContext.get(context);
  if (!inflight) return;
  const deadline = Date.now() + INFLIGHT_WAIT_MS;
  while (inflight.size > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (inflight.size > 0) {
    console.warn(
      `[e2e record] ${inflight.size}件の応答が${INFLIGHT_WAIT_MS / 1000}秒以内に届かず、録画から外れます`,
    );
  }
}

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    await applyRecording(context, testInfo);
    await use(context);
    await waitForInflight(context);
    // 落ちたテストでだけ出す。E2E_DEBUG_MISSES=1 なら通ったテストでも出す
    const misses = missesByContext.get(context);
    if (
      misses?.size &&
      (process.env.E2E_DEBUG_MISSES ||
        testInfo.status !== testInfo.expectedStatus)
    ) {
      const body = [...misses].join("\n");
      console.log(
        `[e2e replay] 録画に無く abort したリクエスト（${testInfo.title}）:\n${body}`,
      );
      await testInfo.attach("録画に無いリクエスト", {
        body,
        contentType: "text/plain",
      });
    }
  },
});

export { expect };
