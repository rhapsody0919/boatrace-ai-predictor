/**
 * verify-racer-snapshot-plan.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-racer-snapshot-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  adaptCopiedRacerHtml,
  sourceChangedDuringCopy,
  RACER_SNAPSHOT_TEMPLATE_VERSION,
} from "../../lib/racerSnapshotPlan.js";

let check, completedHtml, loadGenerator, NOW, hoursAgo, okStatus, copiedPage, ctx;

const okPage = {
  goto: async () => {},
  waitForSelector: async () => {},
  getAttribute: async () => "index",
  content: async () => completedHtml(),
};

const runAt = async (generate) => {
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    return await generate(async () => okPage, "http://localhost");
  } finally {
    Date.now = realNow;
  }
};

function scene1() {
  {
    const r = adaptCopiedRacerHtml(
      copiedPage('<img src="/assets/chunk-ABC.js?v=1">'),
      ctx,
    );
    check(
      "写し: このビルドに無い参照が1つでもあれば写さない",
      !r.ok && r.reason.includes("/assets/chunk-ABC.js"),
      JSON.stringify(r),
    );
  }
  {
    const r = adaptCopiedRacerHtml(copiedPage('<img src="/logo-gone.png">'), ctx);
    check(
      "写し: /assets 以外の固定名（public/）も照合する",
      !r.ok && r.reason.includes("/logo-gone.png"),
    );
  }
  {
    // 本番に無い番号は catch-all で 200 の SPA の外枠（約5KB）が返る（2026-11-05 実測 /ai-snapshots/racer/0001.html）
    const spaShell =
      '<!doctype html><html><head><script type="module" src="/assets/main-OLD8.js"></script></head><body><div id="root"></div></body></html>';
    check(
      "写し: 200 の SPA の外枠は写さない",
      !adaptCopiedRacerHtml(spaShell, ctx).ok,
    );
    check(
      "写し: noindex は写さない",
      !adaptCopiedRacerHtml(
        copiedPage().replace(
          "<head>",
          '<head><meta name="robots" content="noindex, follow">',
        ),
        ctx,
      ).ok,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・completedHtml・loadGenerator・NOW・hoursAgo・okStatus・copiedPage・ctx） */
export function runRacerSnapshotPlanScenes1(env) {
  ({ check, completedHtml, loadGenerator, NOW, hoursAgo, okStatus, copiedPage, ctx } = env);
  scene1();
}

async function scene2() {
  // 本番以外（RACER_SNAPSHOT_LIMIT の Preview）は写さず描く。status.json も読まない
  {
    const writes = [];
    const generate = loadGenerator({ env: { VERCEL_ENV: "preview" }, writes });
    const page = {
      goto: async () => {},
      waitForSelector: async () => {},
      getAttribute: async () => "index",
      content: async () => completedHtml(),
    };
    const r = await generate(async () => page, "http://localhost");
    check(
      "Preview: 写さず描く（fetch を呼ばない）",
      r.mode === "render" && r.rendered === 1 && r.copied === 0,
    );
  }
  // 写す元の status.json が取れなければ全員を描く（今までの動き）
  {
    const writes = [];
    const generate = loadGenerator({
      ids: ["1111", "2222"],
      env: { VERCEL_ENV: "production" },
      fetchImpl: async () => ({ status: 503, text: async () => "" }),
      writes,
    });
    const page = {
      goto: async () => {},
      waitForSelector: async () => {},
      getAttribute: async () => "index",
      content: async () => completedHtml(),
    };
    const r = await generate(async () => page, "http://localhost");
    check(
      "status.json が 503: 全員を描く",
      r.mode === "render" && r.rendered === 2 && r.copied === 0,
    );
  }
  // ---- /code-review の指摘の再現（PR #2286） ----
  check(
    "sourceChangedDuringCopy: 読み直せない（null）なら写したまま",
    sourceChangedDuringCopy(null) === null,
  );
  check(
    "sourceChangedDuringCopy: 同じ版なら写したまま",
    sourceChangedDuringCopy(okStatus()) === null,
  );
  check(
    "sourceChangedDuringCopy: 版が変わった・止まった・racer が消えたら描き直す",
    sourceChangedDuringCopy(
      okStatus({ templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION + 1 }),
    ) !== null &&
      sourceChangedDuringCopy(okStatus({ fatalError: "boom" })) !== null &&
      sourceChangedDuringCopy({ generatedAt: hoursAgo(1) }) !== null,
  );
}

async function scene3() {
  {
    // 写している間に alias が版2（全員を描き直した版）へ切り替わった → 写した HTML を捨て、全員を描く
    const writes = [];
    const removed = [];
    let statusReads = 0;
    const generate = loadGenerator({
      ids: ["1111", "2222"],
      env: { VERCEL_ENV: "production" },
      distFiles: [
        "/assets/main-NEW1.js",
        "/assets/main-NEW2.css",
        "/favicon.ico",
      ],
      writes,
      removed,
      fetchImpl: async (url) => {
        if (String(url).endsWith("/status.json")) {
          statusReads += 1;
          const s =
            statusReads === 1
              ? okStatus()
              : okStatus({
                  templateVersion: RACER_SNAPSHOT_TEMPLATE_VERSION + 1,
                });
          return { status: 200, text: async () => JSON.stringify(s) };
        }
        return { status: 200, text: async () => copiedPage() };
      },
    });
    const r = await runAt(generate);
    check(
      "指摘2: 写している間に版が変わったら写したものを消して全員を描く",
      r.mode === "render" &&
        r.copied === 0 &&
        r.rendered === 2 &&
        removed.length === 2 &&
        r.decisionReason.includes("版が変わった") &&
        r.renderedAt === new Date(NOW).toISOString(),
      JSON.stringify({ ...r, removed }),
    );
  }
  {
    // 1人の書き込みが失敗しても段全体を止めず、その選手は描く側へ
    const writes = [];
    let firstCopyWrite = true;
    const generate = loadGenerator({
      ids: ["1111", "2222"],
      env: { VERCEL_ENV: "production" },
      distFiles: [
        "/assets/main-NEW1.js",
        "/assets/main-NEW2.css",
        "/favicon.ico",
      ],
      writes,
      writeFile: (file, html) => {
        if (String(file).endsWith("1111.html") && firstCopyWrite) {
          firstCopyWrite = false;
          throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
        }
        writes.push([file, html]);
      },
      fetchImpl: async (url) =>
        String(url).endsWith("/status.json")
          ? { status: 200, text: async () => JSON.stringify(okStatus()) }
          : { status: 200, text: async () => copiedPage() },
    });
    const r = await runAt(generate);
    check(
      "指摘3: 写した HTML の書き込みの失敗で段を止めず、その選手だけ描く",
      r.mode === "copy" &&
        r.copied === 1 &&
        r.rendered === 1 &&
        r.copyFailures["書き込みの失敗: ENOSPC"] === 1,
      JSON.stringify(r),
    );
  }
}

async function scene4() {
  {
    // 取得の失敗の理由に undici の err.cause.code を残す
    const generate = loadGenerator({
      ids: ["1111"],
      env: { VERCEL_ENV: "production" },
      writes: [],
      fetchImpl: async (url) => {
        if (String(url).endsWith("/status.json"))
          return { status: 200, text: async () => JSON.stringify(okStatus()) };
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNREFUSED" },
        });
      },
    });
    const r = await runAt(generate);
    check(
      "指摘4: 取得の失敗の理由に原因の code を残す",
      r.copyFailures["取得の失敗: TypeError ECONNREFUSED"] === 1,
      JSON.stringify(r.copyFailures),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・completedHtml・loadGenerator・NOW・hoursAgo・okStatus・copiedPage・ctx） */
export async function runRacerSnapshotPlanScenes2(env) {
  ({ check, completedHtml, loadGenerator, NOW, hoursAgo, okStatus, copiedPage, ctx } = env);
  await scene2();
  await scene3();
  await scene4();
}
