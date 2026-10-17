// 送る前のリンク先の表示の確認（sns-pdca-loop tasks 10、ADR 0091）の再現テスト。Chromium はモック（外部接続なし）。
// 本番の画面での確認は手で: node scripts/maintenance/verify-sns-headless.js --live <race_id>（未ログインの Chromium で本番を開く）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createChromiumHeadless } from "../../api/_lib/snsHeadless.js";
import {
  checkPublicDisplay,
  createMockHeadless,
} from "../../api/_lib/snsDeadlineQueue.js";
import { SCREEN_MARKERS, SCREEN_TABS } from "../lib/snsScreenMarkers.js";

function fakeBrowser({ visible = [], finalUrl } = {}) {
  const log = {
    launches: 0,
    contexts: 0,
    closedContexts: 0,
    routes: [],
    closed: false,
    gotos: [],
  };
  const browser = {
    async newContext(options) {
      log.contexts += 1;
      log.contextOptions = options;
      return {
        async addInitScript(fn, arg) {
          log.initScripts = [
            ...(log.initScripts ?? []),
            { source: String(fn), arg },
          ];
        },
        async route(pattern) {
          log.routes.push(String(pattern));
        },
        async newPage() {
          let current;
          return {
            async goto(url) {
              current = finalUrl ?? url;
              log.gotos.push(url);
            },
            url: () => current,
            evaluate: async (fn) => {
              log.evaluated = [...(log.evaluated ?? []), String(fn)];
            },
            screenshot: async (options) => {
              log.screenshots = [...(log.screenshots ?? []), options];
              return Buffer.from("png");
            },
            locator: (selector) => ({
              first: () => ({
                waitFor: async () => {
                  if (!visible.includes(selector)) throw new Error("timeout");
                },
                isVisible: async () => visible.includes(selector),
                evaluate: async (fn, arg) => {
                  log.labels = [...(log.labels ?? []), { selector, arg }];
                },
                scrollIntoViewIfNeeded: async () => {},
                screenshot: async (options) => {
                  log.elementShots = [
                    ...(log.elementShots ?? []),
                    { selector, options },
                  ];
                  return Buffer.from("element");
                },
              }),
            }),
          };
        },
        async close() {
          log.closedContexts += 1;
        },
      };
    },
    async close() {
      log.closed = true;
      log.browserCloses = (log.browserCloses ?? 0) + 1;
    },
  };
  return {
    log,
    launch: async () => {
      log.launches += 1;
      return browser;
    },
  };
}

const URL_SONAR =
  "https://www.boat-ai.jp/race/2026-10-16-11-12?tab=sonar&utm_source=x&utm_medium=social&utm_campaign=race-full&utm_content=d1";

test("印の表: race-sonar・today は2つずつの data-testid、許すタブは sonar だけ", () => {
  assert.deepEqual(Object.keys(SCREEN_MARKERS), ["race-sonar", "today"]);
  for (const key of ["race-sonar", "today"])
    assert.ok(
      SCREEN_MARKERS[key].length === 2 &&
        SCREEN_MARKERS[key].every((s) => /^\[data-testid="[a-z-]+"\]$/.test(s)),
    );
  assert.deepEqual(SCREEN_TABS, ["sonar"]);
});

test("Chromium は開くたびに起動して閉じ、新しい context で開き、解析のタグを止め、見えた印だけを返す（--single-process は context を閉じるとブラウザごと終わる、2026-10-17）", async () => {
  const fake = fakeBrowser({ visible: [SCREEN_MARKERS["race-sonar"][0]] });
  const headless = createChromiumHeadless({ launch: fake.launch });
  for (let i = 0; i < 2; i++) {
    const result = await headless.inspect({
      url: URL_SONAR,
      context: { storageState: null },
      requiredSelectors: SCREEN_MARKERS["race-sonar"],
    });
    assert.equal(result.finalUrl, URL_SONAR);
    assert.deepEqual(result.visibleSelectors, [
      SCREEN_MARKERS["race-sonar"][0],
    ]);
  }
  assert.equal(fake.log.launches, 2);
  assert.equal(fake.log.contexts, 2);
  assert.equal(fake.log.browserCloses, 2);
  assert.equal(fake.log.contextOptions.storageState, undefined);
  assert.match(fake.log.routes[0], /google-analytics/);
  await headless.close();
  // ログイン状態を持ち込む呼び出しは断る
  await assert.rejects(
    headless.inspect({
      url: URL_SONAR,
      context: { storageState: { cookies: [] } },
      requiredSelectors: [],
    }),
    /未ログイン/,
  );
});

test("前のブラウザが落ちても、次は新しいブラウザで開く（2026-10-17 本番: /today の後の図が4枚とも browser has been closed）", async () => {
  // @sparticuz/chromium（--single-process）と同じく、context を閉じるとブラウザが終わる偽物
  let launches = 0;
  const launch = async () => {
    launches += 1;
    const fake = fakeBrowser({ visible: SCREEN_MARKERS.today });
    const browser = await fake.launch();
    let dead = false;
    return {
      async newContext(options) {
        if (dead)
          throw new Error(
            "browser.newContext: Target page, context or browser has been closed",
          );
        const context = await browser.newContext(options);
        return {
          ...context,
          close: async () => {
            dead = true;
          },
        };
      },
      async close() {
        if (dead) throw new Error("Target closed");
      },
    };
  };
  const headless = createChromiumHeadless({ launch });
  for (let i = 0; i < 3; i++) {
    const result = await headless.inspect({
      url: "https://www.boat-ai.jp/today",
      context: { storageState: null },
      requiredSelectors: SCREEN_MARKERS.today,
    });
    assert.deepEqual(result.visibleSelectors, SCREEN_MARKERS.today);
  }
  assert.equal(launches, 3);
});

test("1回の実行で開く回数に上限があり、起動の失敗は同じ実行の中で繰り返さない", async () => {
  const fake = fakeBrowser({ visible: SCREEN_MARKERS["race-sonar"] });
  const headless = createChromiumHeadless({
    launch: fake.launch,
    maxInspections: 2,
  });
  const call = () =>
    headless.inspect({
      url: URL_SONAR,
      context: { storageState: null },
      requiredSelectors: [],
    });
  await call();
  await call();
  await assert.rejects(call(), /public_check_budget/);
  let launches = 0;
  const broken = createChromiumHeadless({
    launch: async () => {
      launches += 1;
      throw new Error("Failed to launch");
    },
  });
  const brokenCall = () =>
    broken.inspect({
      url: URL_SONAR,
      context: { storageState: null },
      requiredSelectors: [],
    });
  await assert.rejects(brokenCall(), /Failed to launch/);
  await assert.rejects(brokenCall(), /Failed to launch/);
  assert.equal(launches, 1);
});

test("checkPublicDisplay: ?tab=sonar は通し、他のタブ・他のクエリは止め、印が欠けるかリダイレクトされたら止める", async () => {
  const queue = (url) => ({ public_url: url, screen_key: "race-sonar" });
  const all = createMockHeadless({
    visibleSelectors: SCREEN_MARKERS["race-sonar"],
  });
  await checkPublicDisplay(queue(URL_SONAR), all, SCREEN_MARKERS);
  await assert.rejects(
    checkPublicDisplay(
      queue(URL_SONAR.replace("tab=sonar", "tab=odds")),
      all,
      SCREEN_MARKERS,
    ),
    /public_url_invalid/,
  );
  await assert.rejects(
    checkPublicDisplay(queue(`${URL_SONAR}&debug=1`), all, SCREEN_MARKERS),
    /public_url_invalid/,
  );
  const one = createMockHeadless({
    visibleSelectors: [SCREEN_MARKERS["race-sonar"][0]],
  });
  await assert.rejects(
    checkPublicDisplay(queue(URL_SONAR), one, SCREEN_MARKERS),
    /public_component_missing/,
  );
  const moved = createMockHeadless({
    visibleSelectors: SCREEN_MARKERS["race-sonar"],
    finalUrl: "https://www.boat-ai.jp/",
  });
  await assert.rejects(
    checkPublicDisplay(queue(URL_SONAR), moved, SCREEN_MARKERS),
    /public_component_missing/,
  );
  await assert.rejects(
    checkPublicDisplay(
      { public_url: URL_SONAR, screen_key: "unknown" },
      all,
      SCREEN_MARKERS,
    ),
    /public_check_unconfigured/,
  );
});

// 手で本番を確かめる（CI では走らない）
const liveRace = process.argv[process.argv.indexOf("--live") + 1];
if (process.argv.includes("--live") && liveRace) {
  test(`本番: /race/${liveRace}?tab=sonar で印が見える`, async () => {
    const headless = createChromiumHeadless();
    try {
      const url = `https://www.boat-ai.jp/race/${liveRace}?tab=sonar&utm_source=x&utm_medium=social&utm_campaign=race-full&utm_content=headless-check`;
      await checkPublicDisplay(
        { public_url: url, screen_key: "race-sonar" },
        headless,
        SCREEN_MARKERS,
      );
    } finally {
      await headless.close();
    }
  });
}

test("screenshot（/today の画像、tasks 19b）: スマホ幅の上部 4:5 を3倍で、未ログインの context で撮る。印が見えなければ撮らない・回数の上限は inspect と共通", async () => {
  const TODAY = "https://www.boat-ai.jp/today";
  const fake = fakeBrowser({ visible: SCREEN_MARKERS.today });
  const headless = createChromiumHeadless({
    launch: fake.launch,
    maxInspections: 2,
  });
  const shot = await headless.screenshot({
    url: TODAY,
    requiredSelectors: SCREEN_MARKERS.today,
  });
  assert.equal(String(shot.png), "png");
  assert.deepEqual(fake.log.contextOptions, {
    viewport: { width: 390, height: 488 },
    deviceScaleFactor: 3,
    storageState: undefined,
  });
  assert.deepEqual(fake.log.screenshots, [{ type: "png" }]);
  assert.ok(fake.log.routes.some((r) => r.includes("google-analytics")));
  await headless.inspect({
    url: TODAY,
    context: { storageState: null },
    requiredSelectors: SCREEN_MARKERS.today,
  });
  assert.deepEqual(fake.log.contextOptions.viewport, {
    width: 390,
    height: 844,
  });
  await assert.rejects(
    headless.screenshot({
      url: TODAY,
      requiredSelectors: SCREEN_MARKERS.today,
    }),
    /public_check_budget/,
  );

  const missing = fakeBrowser({ visible: [SCREEN_MARKERS.today[0]] });
  await assert.rejects(
    createChromiumHeadless({ launch: missing.launch }).screenshot({
      url: TODAY,
      requiredSelectors: SCREEN_MARKERS.today,
    }),
    /screenshot_component_missing/,
  );
  assert.equal(missing.log.screenshots, undefined);
  // 撮れなくてもブラウザは閉じる（次は新しいブラウザで開く）
  assert.equal(missing.log.browserCloses, 1);
});

test("screenshot: 撮る前に Cookie の同意を「拒否」で記録し、帯が出ていれば撮らない。フォントの読み込みを待ってから撮る（2026-10-16 画像の不具合）", async () => {
  const { CONSENT_KEY } = await import("../../api/_lib/snsHeadless.js");
  const TODAY = "https://www.boat-ai.jp/today";
  const fake = fakeBrowser({ visible: SCREEN_MARKERS.today });
  await createChromiumHeadless({ launch: fake.launch }).screenshot({
    url: TODAY,
    requiredSelectors: SCREEN_MARKERS.today,
  });
  assert.equal(CONSENT_KEY, "boatai:cookie-consent");
  assert.deepEqual(
    fake.log.initScripts.map((s) => s.arg),
    [CONSENT_KEY],
  );
  assert.match(
    fake.log.initScripts[0].source,
    /localStorage\.setItem\(key, "rejected"\)/,
  );
  assert.ok(fake.log.evaluated.some((f) => f.includes("document.fonts.ready")));
  // 帯が出ていれば撮らない
  const covered = fakeBrowser({
    visible: [...SCREEN_MARKERS.today, ".cookie-consent"],
  });
  await assert.rejects(
    createChromiumHeadless({ launch: covered.launch }).screenshot({
      url: TODAY,
      requiredSelectors: SCREEN_MARKERS.today,
    }),
    /screenshot_overlay_visible/,
  );
  assert.equal(covered.log.screenshots, undefined);
  // 同意のキーは画面の側（analytics.js）と同じ
  const analytics = await readFile(
    new URL("../../src/utils/analytics.js", import.meta.url),
    "utf8",
  );
  assert.match(analytics, new RegExp(`CONSENT_KEY = "${CONSENT_KEY}"`));
});

test("screenshot の element・label（龍神ソナーの図、2026-10-16）: 要素の先頭に見出しを差し込み、その要素だけを撮る。要素が見えなければ撮らない", async () => {
  const URL_RACE = "https://www.boat-ai.jp/race/2026-10-16-19-12?tab=sonar";
  const fake = fakeBrowser({
    visible: [...SCREEN_MARKERS["race-sonar"], ".af-hep .af-dark"],
  });
  const shot = await createChromiumHeadless({ launch: fake.launch }).screenshot(
    {
      url: URL_RACE,
      requiredSelectors: SCREEN_MARKERS["race-sonar"],
      viewport: { width: 390, height: 844 },
      element: ".af-hep .af-dark",
      label: "下関12R 22:45締切",
    },
  );
  assert.equal(String(shot.png), "element");
  assert.deepEqual(fake.log.labels, [
    { selector: ".af-hep .af-dark", arg: "下関12R 22:45締切" },
  ]);
  assert.deepEqual(fake.log.elementShots, [
    { selector: ".af-hep .af-dark", options: { type: "png" } },
  ]);
  assert.equal(fake.log.screenshots, undefined);
  const hidden = fakeBrowser({ visible: SCREEN_MARKERS["race-sonar"] });
  await assert.rejects(
    createChromiumHeadless({ launch: hidden.launch }).screenshot({
      url: URL_RACE,
      requiredSelectors: SCREEN_MARKERS["race-sonar"],
      element: ".af-hep .af-dark",
    }),
    /screenshot_component_missing/,
  );
});
