import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalUrl,
  DROP_RESPONSE_HEADERS,
  harKey,
  LOCAL_ORIGIN_PLACEHOLDER,
} from "./har-merge.js";

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
 * page.route で route.fallback() した場合は context の HAR に落ちる。
 * route.continue() と route.fetch() は context のルートを飛ばして本番へ直接出るため、
 * 使わない（実応答を加工したいときは fetchRecorded を使う）。
 * 録画時も同じ順序なので、page.route が差し替えた応答は録画に入らない。
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
/** record モードで、対象を絞った実行（部分録画）かどうか（global-setup が入れる） */
export const RECORD_PARTIAL_ENV = "E2E_RECORD_PARTIAL";
/**
 * record モードで、取った応答を1件ずつ置く場所（全ワーカーで共有）。
 * 同じリクエストは最初に取った応答を以降の全テストに返し、ここに残ったものを
 * global-teardown が束ねる
 */
export const RECORD_CACHE_DIR = path.join(
  repoRoot,
  "test-results",
  ".e2e-record-cache",
);
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
  const keys = new Map(
    har.log.entries.map((e) => [
      harKey(e.request.method, e.request.url, e.request.postData?.text),
      e,
    ]),
  );
  cachedReplayHar = { file, keys };
  return cachedReplayHar;
}

/** 録画・再生した応答を、route.fulfill と spec の両方で使える形にする */
function toResponse(status, headersArray, body) {
  const headers = Object.fromEntries(
    headersArray
      // 本文は展開済みなので、圧縮・長さのヘッダーは実体と食い違う
      .filter((h) => !DROP_RESPONSE_HEADERS.has(h.name.toLowerCase()))
      .map((h) => [h.name.toLowerCase(), h.value]),
  );
  return {
    status: () => status,
    headers: () => headers,
    body: async () => body,
    text: async () => body.toString("utf8"),
    json: async () => JSON.parse(body.toString("utf8")),
    fulfillOptions: () => ({ status, headers, body }),
  };
}

function entryToResponse(entry) {
  const content = entry.response.content;
  const body = content._file
    ? readFileSync(content._file)
    : Buffer.from(
        content.text ?? "",
        content.encoding === "base64" ? "base64" : "utf8",
      );
  return toResponse(entry.response.status, entry.response.headers, body);
}

/**
 * record モード: そのリクエストの応答を返す。同じリクエスト（メソッド + 正規化したURL +
 * POST本文）は、録画の中で最初に取った応答を以降の全テストに返す。
 *
 * テストごとに本番から取り直すと、録画に20分かかる間にデータが変わり（レースが終わる等）、
 * 束ねた録画は「一覧は古い時点・詳細は取っていない」という食い違いを持つ。
 * 再生では一覧に出たレースを開いても詳細が録画に無く、abort された（実測: イン崩れ
 * 演出のテスト2件）。録画中も「1つのURLには1つの応答」に揃えておけば、
 * 録画時に通った経路と再生時の経路が一致する。
 */
async function recordThrough(request, fetchResponse) {
  const key = harKey(
    request.method(),
    canonicalUrl(request.url()),
    request.postData(),
  );
  const file = path.join(
    RECORD_CACHE_DIR,
    `${createHash("sha1").update(key).digest("hex")}.har`,
  );
  const readCached = () =>
    entryToResponse(JSON.parse(readFileSync(file, "utf8")).log.entries[0]);
  if (existsSync(file)) return readCached();

  const response = await fetchResponse();
  const body = await response.body();
  // 本番DBの一時的な失敗（statement timeout の500等）は録画に固定しない。
  // このテストにはそのまま返し、次に同じリクエストが来たら取り直す
  if (response.status() >= 500) {
    return toResponse(response.status(), response.headersArray(), body);
  }
  const mimeType = response.headers()["content-type"] ?? "";
  const isText = /json|text|javascript/.test(mimeType);
  const entry = {
    startedDateTime: new Date().toISOString(),
    request: {
      method: request.method(),
      url: request.url(),
      headers: [],
      ...(request.postData() ? { postData: { text: request.postData() } } : {}),
    },
    response: {
      status: response.status(),
      headers: response.headersArray(),
      content: isText
        ? { mimeType, text: body.toString("utf8") }
        : { mimeType, text: body.toString("base64"), encoding: "base64" },
    },
  };
  // 別のワーカーが同じリクエストを同時に取っていることがある。一時ファイルから
  // link で置く（既にあれば EEXIST で失敗する＝先に置かれた応答を正とする）
  mkdirSync(RECORD_CACHE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ log: { entries: [entry] } }));
  try {
    linkSync(tmp, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readCached();
  } finally {
    rmSync(tmp, { force: true });
  }
  return entryToResponse(entry);
}

/**
 * spec の page.route で「実応答を取ってから加工する」ときに route.fetch() の代わりに使う。
 *
 * route.fetch() はブラウザの通信経路を通らずに直接ネットワークへ出るため、
 * context の routeFromHAR では再生されない（再生時に本番へ出ようとする）。
 * 録画時は取った応答を録画に入れ、再生時は録画から同じ応答を返す。
 *
 * 戻り値は status() / headers() / body() / text() / json() を持つ。
 * APIResponse そのものではないので、route.fulfill には { response } ではなく
 * status・headers を明示して渡すこと。
 */
export async function fetchRecorded(route) {
  const request = route.request();
  if (E2E_MODE === "live") return route.fetch();
  if (E2E_MODE === "record") return recordThrough(request, () => route.fetch());

  const url = canonicalUrl(request.url());
  const entry = replayHar(test.info()).keys.get(
    harKey(request.method(), url, request.postData()),
  );
  if (!entry) {
    throw new Error(
      `録画に無いリクエストです（npm run test:e2e:record で撮り直してください）: ${request.method()} ${url}`,
    );
  }
  return entryToResponse(entry);
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
    // テスト終了時にまだ応答を受け取っていないリクエストは、context が閉じると
    // 録画されずに終わる（別のテストがそのURLを必要としても録画に無くなる）。
    // context を閉じる前に受け取り切るのを待つ
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
    // 録画は routeFromHAR の update ではなく、context の route で本番から取って書き出す。
    // update は page.route が fulfill した応答（spec が差し替えた 500 や、件数を絞った
    // スタブ）まで録画してしまい、同じURLを見る別のテストの再生を汚した
    // （実測: morning_digest_rows を1枚に絞った応答が、2枚のテストに返った）。
    // context の route は page.route より後に評価されるので、spec が差し替えた
    // リクエストはここに来ない
    await context.route(RECORDED_URL, async (route) => {
      const request = route.request();
      let response;
      try {
        response = await recordThrough(request, () => route.fetch());
      } catch (error) {
        // 本番側の失敗（切断・タイムアウト）は録画せず、ブラウザにも失敗として返す。
        // テスト終了で context が閉じた場合も同じ経路に来る
        await route.abort().catch(() => {});
        console.warn(
          `[e2e record] 取得に失敗したため録画しません: ${request.method()} ${request.url()} (${error.message})`,
        );
        return;
      }
      await route.fulfill(response.fulfillOptions()).catch(() => {});
    });
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
