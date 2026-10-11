/**
 * verify-render-with-fresh-page.js - ブログのスナップショット生成で、ページが1つ落ちても
 * 後続の記事を取りこぼさないこと（scripts/lib/renderWithFreshPage.js）の検証。
 *
 * 2026-10-11 の本番ビルドで、ページが落ちたあと同じページを使い続けた後続の3記事
 * （player-data-analysis・betting-strategy・beginner-basics）がすべて
 * "Target page, context or browser has been closed" で失敗した。偽のページで同じ落ち方を再現する。
 * さらに Preview では、Vercel の Chromium が単一プロセスで動くためブラウザごと落ち、作り直しの newPage も
 * 失敗してブログの生成全体が止まった。偽のブラウザでこれも再現する（createPageOpener）。
 */
import {
  createPageOpener,
  renderWithFreshPage,
} from "../lib/renderWithFreshPage.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 偽のページ。crashOn に入った記事を描くとページが落ち、以後そのページは何も描けない
function makeBrowser({ crashOn = new Set(), failAlways = new Set() } = {}) {
  let opened = 0;
  const openPage = async () => {
    opened += 1;
    let closed = false;
    return {
      isClosed: () => closed,
      close: async () => {
        if (closed) throw new Error("already closed");
        closed = true;
      },
      async draw(id) {
        if (closed)
          throw new Error("Target page, context or browser has been closed");
        if (failAlways.has(id)) throw new Error(`render failed: ${id}`);
        if (crashOn.has(id)) {
          crashOn.delete(id); // 一度だけ落ちる（描画中のクラッシュ）
          closed = true;
          throw new Error("Target page, context or browser has been closed");
        }
      },
    };
  };
  return { openPage, opened: () => opened };
}

const ids = Array.from({ length: 12 }, (_, i) => `post-${i + 1}`);
const render = async (page, id) => page.draw(id);

{
  const b = makeBrowser({ crashOn: new Set(["post-3"]) });
  const r = await renderWithFreshPage(ids, {
    concurrency: 1,
    openPage: b.openPage,
    render,
  });
  check(
    "ページが落ちても後続の記事は全部描ける（修正前は post-4 以降が全部失敗した）",
    r.succeeded.length === 12 && r.failed.length === 0,
    JSON.stringify(r.failed),
  );
}

{
  const b = makeBrowser({ crashOn: new Set(["post-2", "post-7"]) });
  const r = await renderWithFreshPage(ids, {
    concurrency: 4,
    openPage: b.openPage,
    render,
  });
  check(
    "4並列で2ページが落ちても12件すべて描け、重複も抜けも無い",
    r.failed.length === 0 &&
      new Set(r.succeeded).size === 12 &&
      r.succeeded.length === 12,
    JSON.stringify(r),
  );
}

{
  const b = makeBrowser({ failAlways: new Set(["post-5"]) });
  const r = await renderWithFreshPage(ids, {
    concurrency: 2,
    openPage: b.openPage,
    render,
  });
  check(
    "何度描いても失敗する記事は、再試行1回のあと失敗として返す（黙って成功にしない）",
    r.failed.length === 1 &&
      r.failed[0].item === "post-5" &&
      r.failed[0].error === "render failed: post-5" &&
      r.succeeded.length === 11,
    JSON.stringify(r.failed),
  );
}

{
  const b = makeBrowser();
  await renderWithFreshPage(ids, {
    concurrency: 3,
    openPage: b.openPage,
    render,
  });
  check(
    "失敗が無ければページは並列の数だけ開く（作り直しは失敗したときだけ）",
    b.opened() === 3,
    `opened=${b.opened()}`,
  );
}

// 単一プロセスの Chromium: crashOn の記事を描くとブラウザごと落ち、そのブラウザの newPage も以後失敗する
function makeSingleProcessLauncher({ crashOn = new Set() } = {}) {
  let launches = 0;
  const launch = async () => {
    launches += 1;
    let connected = true;
    const pages = [];
    return {
      isConnected: () => connected,
      close: async () => {
        if (!connected) throw new Error("browser already closed");
        connected = false;
      },
      newPage: async () => {
        if (!connected) {
          throw new Error(
            "browser.newPage: Target page, context or browser has been closed",
          );
        }
        let pageClosed = false;
        const page = {
          isClosed: () => pageClosed || !connected,
          close: async () => {
            if (pageClosed || !connected) throw new Error("already closed");
            pageClosed = true;
          },
          async draw(id) {
            if (!connected || pageClosed) {
              throw new Error(
                "Target page, context or browser has been closed",
              );
            }
            if (crashOn.has(id)) {
              crashOn.delete(id);
              connected = false; // ブラウザごと落ちる
              throw new Error(
                "Target page, context or browser has been closed",
              );
            }
          },
        };
        pages.push(page);
        return page;
      },
    };
  };
  return { launch, launches: () => launches };
}

{
  const l = makeSingleProcessLauncher({ crashOn: new Set(["post-4"]) });
  const opener = createPageOpener(l.launch);
  const r = await renderWithFreshPage(ids, {
    concurrency: 4,
    openPage: opener.openPage,
    render,
  });
  await opener.close();
  check(
    "ブラウザごと落ちても起動し直して12件すべて描ける（修正前は newPage が失敗して生成全体が止まった）",
    r.failed.length === 0 && new Set(r.succeeded).size === 12,
    JSON.stringify(r.failed),
  );
  check(
    "4並列で同時に落ちたことに気づいても、起動し直すのは1回だけ",
    l.launches() === 2,
    `launches=${l.launches()}`,
  );
}

{
  const l = makeSingleProcessLauncher();
  const opener = createPageOpener(l.launch);
  await renderWithFreshPage(ids, {
    concurrency: 4,
    openPage: opener.openPage,
    render,
  });
  await opener.close();
  check(
    "落ちなければブラウザは1回だけ起動する",
    l.launches() === 1,
    `launches=${l.launches()}`,
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
