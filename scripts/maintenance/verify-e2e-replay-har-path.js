#!/usr/bin/env node
/**
 * E2E の録画の再生（e2e/fixtures.js の replayHar）が、HAR のコピーを api.har と同じ場所に置き、
 * 本文の content._file を相対パスのまま渡していることを確かめる（#2102、Playwright 1.64）。
 *
 * Playwright 1.64 の routeFromHAR は、_file が HAR のある場所の外（絶対パスを含む）を指すと
 * 「HAR entry _file escapes base directory」で応答を返さない。1.59 までの置き方（コピーを
 * test-results 配下に置き、_file を絶対パスに直す）のままだと、全ての録画の応答が失敗して
 * 画面が空になり、E2E がデータ待ちで落ちる。
 *
 * 1. replayHarPath が api.har と同じディレクトリを返す
 * 2. 実際の Chromium で、同じ場所の相対パスは読め、別の場所から絶対パスで指すと読めない
 *    （Playwright の挙動の前提。上げ下げで変わったら気づけるように）
 * 本番・録画の本体には依存しない（一時ディレクトリに小さな HAR を作る）。
 * 2 は Playwright の Chromium が入っている所だけで行う（Quality Gates の verify は入れていない。
 * E2E のジョブと手元では入っている）。入っていなければ SKIP と出す。
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { HAR_PATH, replayHarPath } from "../../e2e/fixtures.js";

assert.equal(
  path.dirname(replayHarPath(12345)),
  path.dirname(HAR_PATH),
  "再生用の HAR のコピーは api.har と同じディレクトリに置く（_file の相対パスがそこから解決されるため）",
);

const BODY = '{"ok":true}';
const URL_ = "https://replay.example.test/data.json";

function harWith(file) {
  return {
    log: {
      version: "1.2",
      creator: { name: "verify", version: "1" },
      entries: [
        {
          startedDateTime: new Date(0).toISOString(),
          time: 0,
          request: {
            method: "GET",
            url: URL_,
            httpVersion: "HTTP/1.1",
            headers: [],
            queryString: [],
            cookies: [],
            headersSize: -1,
            bodySize: 0,
          },
          response: {
            status: 200,
            statusText: "OK",
            httpVersion: "HTTP/1.1",
            headers: [{ name: "content-type", value: "application/json" }],
            cookies: [],
            content: {
              size: BODY.length,
              mimeType: "application/json",
              _file: file,
            },
            redirectURL: "",
            headersSize: -1,
            bodySize: BODY.length,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        },
      ],
    },
  };
}

async function load(harFile) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.routeFromHAR(harFile, {
      url: /replay\.example\.test/,
      notFound: "abort",
    });
    const page = await context.newPage();
    const res = await page.goto(URL_).catch(() => null);
    return res ? await res.text() : null;
  } finally {
    await browser.close();
  }
}

if (!existsSync(chromium.executablePath())) {
  console.log(
    "OK: replayHarPath は api.har と同じ場所（SKIP: Playwright の Chromium が無いので routeFromHAR の実測は飛ばす）",
  );
  process.exit(0);
}

const dir = mkdtempSync(path.join(tmpdir(), "verify-replay-har-"));
try {
  const recordings = path.join(dir, "recordings");
  mkdirSync(path.join(recordings, "bodies"), { recursive: true });
  writeFileSync(path.join(recordings, "bodies", "a.json"), BODY);

  // 今の置き方: api.har と同じ場所のコピー、_file は相対パス
  const same = path.join(recordings, ".replay-api-1.har");
  writeFileSync(same, JSON.stringify(harWith("bodies/a.json")));
  assert.equal(await load(same), BODY, "同じ場所・相対パスの _file は読める");

  // 1.59 までの置き方: 別の場所のコピー、_file は絶対パス
  const other = path.join(dir, "test-results", ".replay", "api-1.har");
  mkdirSync(path.dirname(other), { recursive: true });
  writeFileSync(
    other,
    JSON.stringify(harWith(path.join(recordings, "bodies", "a.json"))),
  );
  assert.notEqual(
    await load(other),
    BODY,
    "別の場所から絶対パスで指す _file は読めない前提（Playwright 1.64）。読めるなら前提が変わったので fixtures.js の説明を見直す",
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  "OK: E2E の再生用 HAR は api.har と同じ場所に置き、_file を相対パスで読む",
);
