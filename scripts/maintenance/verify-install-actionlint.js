/**
 * actionlint・shellcheck の取得（install-actionlint.js）の取り直しの検証。ネットワークには繋がない（偽の fetch と sleep）。
 *
 *   (a) 判定（shouldRetryFetch）: 403・429・5xx・ECONNRESET・ETIMEDOUT は取り直す。404 などの
 *       取り直しても変わらない失敗、符号の無い例外は取り直さない
 *   (b) 間隔（retryDelayMs）: 失敗のたびに広がる
 *   (c) 殻（fetchWithRetry）: 一時的な失敗の後に成功すれば本体を返す／回数を使い切れば失敗／
 *       404 は1回で失敗／本体の読み込みの途中の切断も取り直す／失敗の文は「取得に失敗しました（理由: URL」で始まる
 *
 * 2026-11-18: master の Quality Gates が GitHub Releases の HTTP 403 の1回で落ち、定時の release が止まった。
 *
 * 使い方: node scripts/maintenance/verify-install-actionlint.js
 */
import {
  FETCH_MAX_ATTEMPTS,
  errorCode,
  fetchWithRetry,
  retryDelayMs,
  shouldRetryFetch,
} from "./install-actionlint.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "✅" : "❌"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const URL_ = "https://example.invalid/tool.tar.gz";
const okRes = (text) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer,
});
const httpRes = (status) => ({ ok: false, status });
const netError = (code) =>
  Object.assign(new TypeError("fetch failed"), { cause: { code } });

/** steps を順に返す偽の fetch。関数なら呼び、例外はそのまま投げる */
function fakeIo(steps) {
  const calls = [];
  const sleeps = [];
  const logs = [];
  return {
    calls,
    sleeps,
    logs,
    opts: {
      fetchImpl: async (url) => {
        calls.push(url);
        const step = steps[calls.length - 1];
        if (step instanceof Error) throw step;
        return step;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      log: (line) => logs.push(line),
    },
  };
}

async function caught(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e;
  }
}

// (a) 判定
for (const status of [403, 429, 500, 502, 503, 504, 599]) {
  check(shouldRetryFetch({ status }) === true, `(a) HTTP ${status} は取り直す`);
}
for (const status of [400, 401, 404, 410, 422, 600]) {
  check(
    shouldRetryFetch({ status }) === false,
    `(a) HTTP ${status} は取り直さない`,
  );
}
for (const code of ["ECONNRESET", "ETIMEDOUT"]) {
  check(shouldRetryFetch({ code }) === true, `(a) ${code} は取り直す`);
}
for (const code of ["ENOTFOUND", "ERR_INVALID_URL", null]) {
  check(
    shouldRetryFetch({ code }) === false,
    `(a) 符号 ${code} は取り直さない`,
  );
}
check(shouldRetryFetch() === false, "(a) 何も無ければ取り直さない");
check(
  errorCode(netError("ECONNRESET")) === "ECONNRESET" &&
    errorCode(Object.assign(new Error("x"), { code: "ETIMEDOUT" })) ===
      "ETIMEDOUT" &&
    errorCode(new Error("x")) === null,
  "(a) 例外の符号は cause.code・code の順に読み、無ければ null",
);

// (b) 間隔
const delays = Array.from({ length: FETCH_MAX_ATTEMPTS - 1 }, (_, i) =>
  retryDelayMs(i + 1),
);
check(
  same(delays, [5000, 15000, 45000]),
  "(b) 間隔は 5秒・15秒・45秒と広がる",
  JSON.stringify(delays),
);

// (c) 殻
{
  const io = fakeIo([httpRes(403), netError("ECONNRESET"), okRes("body")]);
  const body = await fetchWithRetry("actionlint", URL_, io.opts);
  check(
    body.toString() === "body" &&
      io.calls.length === 3 &&
      same(io.sleeps, [5000, 15000]) &&
      io.logs.length === 2 &&
      io.logs.every((l) => !l.includes("❌")),
    "(c) 403・ECONNRESET の後に成功すれば本体を返す（3回目、待ちは2回、途中の行に ❌ を出さない）",
    JSON.stringify({
      calls: io.calls.length,
      sleeps: io.sleeps,
      logs: io.logs,
    }),
  );
}
{
  const io = fakeIo(Array.from({ length: 10 }, () => httpRes(403)));
  const e = await caught(fetchWithRetry("actionlint", URL_, io.opts));
  check(
    e !== null &&
      e.message ===
        `actionlint: 取得に失敗しました（HTTP 403: ${URL_}、${FETCH_MAX_ATTEMPTS}回試行）` &&
      io.calls.length === FETCH_MAX_ATTEMPTS &&
      io.sleeps.length === FETCH_MAX_ATTEMPTS - 1,
    "(c) 403 が続けば上限の回数で失敗する",
    `${e?.message} calls=${io.calls.length}`,
  );
}
{
  const io = fakeIo([httpRes(404), okRes("body")]);
  const e = await caught(fetchWithRetry("shellcheck", URL_, io.opts));
  check(
    e !== null &&
      e.message === `shellcheck: 取得に失敗しました（HTTP 404: ${URL_}）` &&
      io.calls.length === 1 &&
      io.sleeps.length === 0,
    "(c) 404 は取り直さず1回で失敗する（文は前と同じ）",
    `${e?.message} calls=${io.calls.length}`,
  );
}
{
  const io = fakeIo([new TypeError("fetch failed"), okRes("body")]);
  const e = await caught(fetchWithRetry("actionlint", URL_, io.opts));
  check(
    e !== null &&
      e.message === `actionlint: 取得に失敗しました（fetch failed: ${URL_}）` &&
      io.calls.length === 1,
    "(c) 符号の無い例外は取り直さず、元の文を付けて失敗する",
    `${e?.message} calls=${io.calls.length}`,
  );
}
{
  const broken = {
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      throw netError("ECONNRESET");
    },
  };
  const io = fakeIo([broken, okRes("body")]);
  const body = await fetchWithRetry("actionlint", URL_, io.opts);
  check(
    body.toString() === "body" && io.calls.length === 2,
    "(c) 本体の読み込みの途中の切断も取り直す",
  );
}
{
  const io = fakeIo(Array.from({ length: 10 }, () => netError("ETIMEDOUT")));
  const e = await caught(fetchWithRetry("actionlint", URL_, io.opts));
  check(
    e !== null &&
      e.message ===
        `actionlint: 取得に失敗しました（ETIMEDOUT: ${URL_}、${FETCH_MAX_ATTEMPTS}回試行）`,
    "(c) ETIMEDOUT が続けば符号つきの文で失敗する",
    e?.message,
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 件の検証が失敗しました`);
  process.exit(1);
}
console.log("\n✅ install-actionlint の取り直しの検証はすべて通りました");
