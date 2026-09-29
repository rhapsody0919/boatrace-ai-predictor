import { test, expect } from "./fixtures.js";
import fs from "node:fs";
import { parseLiveOddsPage } from "../scripts/lib/liveOdds.js";

/**
 * オッズ一覧タブのライブ取得（BOA-487）の固定。
 *
 * ライブ API（/api/odds/live）と race_odds のスナップショットは route でモックし、ページの時計を
 * レースの締切前に固定する（公式・DBの状態に左右されない）。出走表などタブ以外は本番の Supabase を読む。
 *
 * - 成功: 「最新 13:55 取得 公式更新 8:14 [更新]」に差し替わる
 * - 取得中: スナップショットを出したまま「最新オッズを取得中… いまは○取得の値」
 * - 失敗: スナップショットのまま「最新の取得に失敗しました」＋再取得。スナップショットも無ければ InlineFetchError
 * - 票0: 「票なし」。全艇票0なら注記
 * - 締切後: ライブ取得しない
 * - 更新ボタン: 取り直して差し替える
 */

const RACE = "2026-09-28-03-08"; // 江戸川8R（締切 14:24）
const BEFORE_DEADLINE = new Date("2026-09-28T13:55:00+09:00");
const AFTER_DEADLINE = new Date("2026-09-28T14:40:00+09:00");

const FIX = (n) =>
  fs.readFileSync(
    new URL(`../scripts/lib/__fixtures__/odds/${n}`, import.meta.url),
    "utf8",
  );
const PARSED = {
  tf: parseLiveOddsPage("tf", FIX("oddstf-zero-votes-2026-09-28-03-08.html")),
  "3t": parseLiveOddsPage(
    "3t",
    FIX("odds3t-predeadline-2026-09-29-21-02.html"),
  ),
  "3f": parseLiveOddsPage("3f", FIX("odds3f-2026-09-19-05-01.html")),
  "2tf": parseLiveOddsPage("2tf", FIX("odds2tf-2026-09-19-05-01.html")),
  k: parseLiveOddsPage("k", FIX("oddsk-2026-09-19-05-01.html")),
};

const liveBody = (page, overrides = {}) => ({
  ok: true,
  raceId: RACE,
  page,
  fetchedAt: "2026-09-28T04:55:10Z", // 13:55 JST
  officialUpdatedAt: PARSED[page].officialUpdatedAt ?? "08:14",
  final: false,
  data: PARSED[page].data,
  ...overrides,
});

// 締切30分前（13:54 JST）のスナップショット1行
const SNAPSHOT_ROW = (() => {
  const t3 = parseLiveOddsPage("3t", FIX("odds3t-2026-09-19-05-01.html")).data
    .trifectaAll;
  const row = {
    captured_at: "2026-09-28T04:54:00Z",
    trifecta_all: t3,
    trio_all: null,
    exacta_all: null,
    quinella_all: null,
    wide_all: null,
  };
  for (let n = 1; n <= 6; n++) {
    row[`odds_win_${n}`] = n === 4 ? null : 2 + n;
    row[`odds_place_${n}_low`] = 1.1;
    row[`odds_place_${n}_high`] = 1.9;
  }
  return row;
})();

async function setup(
  page,
  {
    now = BEFORE_DEADLINE,
    snapshots = [SNAPSHOT_ROW],
    live,
    final = null,
    race = RACE,
  } = {},
) {
  await page.clock.setFixedTime(now);
  const calls = [];
  await page.route("**/rest/v1/race_odds**", (route) =>
    route.fulfill({ json: snapshots }),
  );
  // 締切時オッズ（公式、BOA-496）。後から登録した route が優先される（race_odds** にも一致するため分ける）
  await page.route("**/rest/v1/race_odds_final**", (route) =>
    route.fulfill({ json: final ? [final] : [] }),
  );
  await page.route("**/api/odds/live**", async (route) => {
    const p = new URL(route.request().url()).searchParams.get("page");
    calls.push(p);
    const body = live ? await live(p, calls) : liveBody(p);
    return route.fulfill({ json: body });
  });
  await page.goto(`/race/${race}`, { waitUntil: "domcontentloaded" });
  await page
    .locator(".race-tabs-btn", { hasText: "オッズ一覧" })
    .click({ timeout: 60000 });
  return { calls, status: page.getByTestId("odds-live-status") };
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe("オッズ一覧のライブ取得（BOA-487）", () => {
  test.slow();

  test("成功: 単勝・複勝と3連単を並列に取り、最新と公式更新時刻に差し替わる", async ({
    page,
  }) => {
    const { calls, status } = await setup(page);
    await expect(status).toContainText("最新");
    await expect(status).toContainText("公式更新 8:14");
    await expect(status).toContainText("13:55 取得");
    await expect(status.getByRole("button", { name: "更新" })).toBeVisible();
    // 開いたときは単勝・複勝、3連単、3連単の表の「2単」に使う2連単を取る
    expect([...new Set(calls)].sort()).toEqual(["2tf", "3t", "tf"]);
    // 3連単の票0は「票なし」
    await expect(page.locator(".rol-odds.is-no-votes").first()).toContainText(
      "票なし",
    );
    // ファン評価1周目: 「最新」の真下の「2単」はライブの2連単（スナップショットの値・「-」にしない）
    const exacta12 = PARSED["2tf"].data.exactaAll["1-2"].toFixed(1);
    await expect(
      page.locator(".rol-block").first().locator(".rol-col").first(),
    ).toContainText(`2単${exacta12}`);

    // 他の券種はチップを切り替えたときに取る
    await page.getByRole("tab", { name: "3連複" }).click();
    await expect(status).toContainText("最新");
    expect(calls).toContain("3f");
  });

  test("単勝・複勝: 票0の艇は「票なし」、全艇票0なら注記", async ({ page }) => {
    const allZero = {
      win: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, 0])),
      place: Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((n) => [n, { low: 0, high: 0 }]),
      ),
    };
    let tfCount = 0;
    const { status } = await setup(page, {
      live: (p) => {
        if (p !== "tf") return liveBody(p);
        tfCount++;
        return tfCount === 1
          ? liveBody("tf", { data: allZero })
          : liveBody("tf");
      },
    });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    await expect(status).toContainText("公式更新");
    const table = page.locator(".rol-win-table");
    await expect(table.locator("tbody tr")).not.toHaveCount(0);
    await expect(page.locator(".rol-callout")).toContainText(
      "票がまだ入っていません",
    );
    await expect(table).toContainText("票なし");
    await expect(table).not.toContainText("0.0");
  });

  test("取得中はスナップショットを出したまま、取得時刻を示す", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { status } = await setup(page, {
      live: async (p) => {
        await gate;
        return liveBody(p);
      },
    });
    await expect(status).toContainText("最新オッズを取得中… いまは");
    await expect(status).toContainText("13:54 取得（締切30分前）");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    release();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("失敗: スナップショットの値を出し、再取得で差し替わる", async ({
    page,
  }) => {
    let fail = true;
    const { status } = await setup(page, {
      live: (p) =>
        fail
          ? { ok: false, reason: "fetch_failed", retryAfterSec: 10 }
          : liveBody(p),
    });
    await expect(status).toContainText("最新の取得に失敗しました");
    await expect(status).toContainText("13:54 取得（締切30分前）の値を表示中");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    fail = false;
    await status.getByRole("button", { name: "再取得" }).click();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("失敗かつスナップショットも無い: InlineFetchError", async ({ page }) => {
    await setup(page, {
      snapshots: [],
      live: () => ({
        ok: false,
        reason: "upstream_http_503",
        retryAfterSec: 10,
      }),
    });
    await expect(page.locator(".inline-fetch-error")).toContainText(
      "最新のオッズを取得できませんでした",
    );
  });

  test("スナップショットが無くてもライブ値だけで表を出す", async ({ page }) => {
    const { status } = await setup(page, { snapshots: [] });
    await expect(status).toContainText("公式更新 8:14");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    // ファン評価2周目: 最新の点もスナップショットと同じ「締切○分前」（13:55:10 取得、締切 14:24）
    await expect(page.locator(".rol-trend-item.is-live")).toContainText(
      "最新（締切29分前）",
    );
  });

  test("更新ボタン: 取り直して差し替える（自動では取り直さない）", async ({
    page,
  }) => {
    const { calls, status } = await setup(page, {
      live: (p, all) =>
        liveBody(p, {
          officialUpdatedAt:
            all.filter((c) => c === p).length > 1 ? "13:58" : "08:14",
        }),
    });
    await expect(status).toContainText("公式更新 8:14");
    const before = calls.filter((c) => c === "3t").length;
    await status.getByRole("button", { name: "更新" }).click();
    await expect(status).toContainText("公式更新 13:58");
    expect(calls.filter((c) => c === "3t").length).toBe(before + 1);
  });

  test("締切後のレースはライブ取得しない", async ({ page }) => {
    const { calls, status } = await setup(page, { now: AFTER_DEADLINE });
    await expect(status).toContainText("13:54 取得（締切30分前）の値");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    expect(calls).toEqual([]);
    await expect(status.getByRole("button")).toHaveCount(0);
  });

  // /code-review の指摘の再現: 単勝が全艇 null の行が最新でも、単勝の値を持つ直前の行を出す
  // （全艇 null の行を「最新」とみなして、表を全て「-」にしない）
  test("単勝・複勝（スナップショット）: 単勝が全艇 null の最新行より、値を持つ行を使う", async ({
    page,
  }) => {
    const nullWinRow = { ...SNAPSHOT_ROW, captured_at: "2026-09-28T05:19:00Z" };
    for (let n = 1; n <= 6; n++) {
      nullWinRow[`odds_win_${n}`] = null;
      nullWinRow[`odds_place_${n}_low`] = null;
      nullWinRow[`odds_place_${n}_high`] = null;
    }
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, nullWinRow],
    });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    await expect(status).toContainText("13:54 取得（締切30分前）の値");
    const table = page.locator(".rol-win-table");
    await expect(table).toContainText("3.0");
    await expect(table).toContainText("1.1-1.9");
    // この行でも4号艇の単勝は null（票0か未取得か区別できない）→「-」＋注記
    await expect(page.locator(".rol-callout")).toContainText(
      "票なし（または未取得）",
    );
  });

  // ---- ファン評価1周目の指摘の再現テスト ----

  test("締切後: スナップショットは公式表示の遅れの注記を付け、「締切時点」と断定しない", async ({
    page,
  }) => {
    const atDeadline = { ...SNAPSHOT_ROW, captured_at: "2026-09-28T05:24:10Z" };
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, atDeadline],
    });
    await expect(status).toContainText("14:24 取得（締切直前）の値");
    await expect(status).toContainText(
      "締切時オッズ・確定の払戻とは一致しないことがあります",
    );
    await expect(status).not.toContainText("締切時点");
  });

  test("推移パネル: スナップショットの時点は「締切○分前」と書く", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE });
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    await expect(page.locator(".rol-trend-label").first()).toHaveText(
      "締切30分前",
    );
  });

  test("更新: CDN から同じ応答が返ったら「変化なし」を出す", async ({
    page,
  }) => {
    const { status } = await setup(page);
    await expect(status).toContainText("公式更新 8:14");
    await status.getByRole("button", { name: "更新" }).click();
    await expect(page.getByTestId("odds-live-unchanged")).toContainText(
      "変化なし",
    );
  });

  test("スナップショットが無いときの取得中は、時間がかかることを示す", async ({
    page,
  }) => {
    let release;
    const gate = new Promise((r) => (release = r));
    const { status } = await setup(page, {
      snapshots: [],
      live: async (p) => {
        await gate;
        return liveBody(p);
      },
    });
    await expect(status).toContainText("10秒ほどかかります");
    release();
    await expect(status).toContainText("公式更新 8:14");
  });

  test("スナップショットで票0（保存時にキーが落ちた組み合わせ）は「-」でなく「票なし」", async ({
    page,
  }) => {
    const row = {
      ...SNAPSHOT_ROW,
      trifecta_all: { ...SNAPSHOT_ROW.trifecta_all },
    };
    delete row.trifecta_all["6-5-4"];
    await setup(page, { now: AFTER_DEADLINE, snapshots: [row] });
    await expect(
      page.getByRole("button", { name: "6-5-4 票なし" }),
    ).toBeVisible();
  });

  test("375px: 3連単の列の下の「合成」「2単」が2行に割れない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, { now: AFTER_DEADLINE });
    await expect(page.locator(".rol-col-foot").first()).toBeVisible();
    const broken = await page.$$eval(".rol-col-foot > span", (spans) =>
      spans
        .filter(
          (s) =>
            s.getClientRects().length > 1 ||
            s.getBoundingClientRect().height > 20,
        )
        .map((s) => s.textContent),
    );
    expect(broken).toEqual([]);
  });

  // BOA-552: 合成が100倍超（3桁）の列だけ値が次の行に落ち、同じブロックの「2単」が列ごとに段違いになっていた。
  // 既存の上のテストは1号艇ブロック（小さい値）しか通らず検知できなかったため、全列を大きな値にして見る。
  // 4桁（合成1000.0）・5桁（2単12345.6）は、360px（Androidで多い幅）・320pxで見出しとくっつく／隣の列へ
  // はみ出す指摘があった（ファン評価1周目）
  for (const [label, trifectaOdds, exactaOdds] of [
    ["3桁", 999.9, 963.7], // 合成＝250.0（3着4艇の調和平均）
    ["4〜5桁", 4000.0, 12345.6], // 合成＝1000.0
    ["5桁のマス", 40000.0, 12345.6], // 3連単のマス自体が5桁（ファン評価2周目: マスが折れて段違い）
  ]) {
    for (const width of [375, 360, 320]) {
      test(`${width}px: 合成・2単が${label}でも、見出しと値が離れて1行に収まり、列ごとに段違いにならない`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 812 });
        const trifecta = Object.fromEntries(
          Object.keys(SNAPSHOT_ROW.trifecta_all).map((k) => [k, trifectaOdds]),
        );
        const exacta = Object.fromEntries(
          Object.keys(PARSED["2tf"].data.exactaAll).map((k) => [
            k,
            exactaOdds,
          ]),
        );
        await setup(page, {
          now: AFTER_DEADLINE,
          snapshots: [
            { ...SNAPSHOT_ROW, trifecta_all: trifecta, exacta_all: exacta },
          ],
        });
        await expect(page.locator(".rol-col-foot").first()).toBeVisible();
        const problems = await page.$$eval(".rol-block", (blocks) =>
          blocks.flatMap((block, bi) => {
            const feet = [...block.querySelectorAll(".rol-col")].map((col) =>
              [...col.querySelectorAll(".rol-col-foot")].map((f) => {
                const [head, value] = f.querySelectorAll("span");
                const h = head.getBoundingClientRect();
                const v = value.getBoundingClientRect();
                const box = f.getBoundingClientRect();
                return {
                  text: f.textContent,
                  sameLine: h.top === v.top,
                  apart: v.left - h.right >= 1,
                  inside: h.left >= box.left - 0.5 && v.right <= box.right + 0.5,
                  top: Math.round(box.top),
                };
              }),
            );
            const out = [];
            for (const col of feet) {
              for (const f of col) {
                if (!f.sameLine) out.push(`block${bi} 2行: ${f.text}`);
                if (!f.apart) out.push(`block${bi} くっつき: ${f.text}`);
                if (!f.inside) out.push(`block${bi} はみ出し: ${f.text}`);
              }
            }
            // オッズのマスが折り返さない（艇番と値が同じ行）
            for (const cell of block.querySelectorAll(".rol-odds")) {
              const b = cell.querySelector(".rol-odds-badges").getBoundingClientRect();
              const v = cell.querySelector(".rol-odds-value").getBoundingClientRect();
              if (v.top >= b.bottom - 1 || v.left < b.right) {
                out.push(`block${bi} マスが折れる: ${cell.textContent}`);
              }
              if (v.right > cell.getBoundingClientRect().right + 0.5) {
                out.push(`block${bi} マスからはみ出し: ${cell.textContent}`);
              }
            }
            // 「合成」の行、「2単」の行がそれぞれブロック内で同じ高さ
            for (const row of [0, 1]) {
              const tops = new Set(feet.map((col) => col[row]?.top));
              if (tops.size > 1) out.push(`block${bi} 行${row} 段違い`);
            }
            return out;
          }),
        );
        expect(problems).toEqual([]);
      });
    }
  }

  test("3連複・2連複・拡連複: 推移の見出しとボタン名は「1=2=3」、3連単は「1-2-3」（BOA-552）", async ({
    page,
  }) => {
    await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [
        {
          ...SNAPSHOT_ROW,
          trio_all: PARSED["3f"].data.trioAll,
          quinella_all: PARSED["2tf"].data.quinellaAll,
          wide_all: PARSED.k.data.wideAll,
        },
      ],
    });
    const title = page.locator(".rol-trend-title");
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    await expect(title).toHaveText("1-2-3 のオッズ推移");
    for (const [tab, name] of [
      ["3連複", "1=2=3"],
      ["2連複", "1=2"],
      ["拡連複", "1=2"],
    ]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.getByRole("button", { name: new RegExp(`^${name} `) }).click();
      await expect(title).toHaveText(`${name} のオッズ推移`);
    }
  });

  // ---- ファン評価2周目の指摘の再現テスト ----

  test("拡連複（スナップショット）: キーの無い組があってもページが落ちず「票なし」", async ({
    page,
  }) => {
    const wide = { ...PARSED.k.data.wideAll };
    delete wide["3-5"];
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [{ ...SNAPSHOT_ROW, wide_all: wide }],
    });
    await page.getByRole("tab", { name: "拡連複" }).click();
    await expect(
      page.getByRole("button", { name: "3=5 票なし" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("単勝・複勝（スナップショット）: 単勝の null は「票なし」と断定せず「-」と注記", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    const row4 = page.locator(".rol-win-table tbody tr").filter({
      has: page.locator(".rol-boat-badge", { hasText: /^4$/ }),
    });
    await expect(row4.locator("td").first()).toHaveText("-");
    await expect(page.locator(".rol-win-table")).not.toContainText("票なし");
    await expect(page.locator(".rol-callout")).toContainText(
      "票なし（または未取得）",
    );
  });

  test("取得中→最新で、主に出す時刻が戻らない（取得時刻を主に、公式更新は補足）", async ({
    page,
  }) => {
    const { status } = await setup(page);
    await expect(status.locator("b")).toHaveText("13:55 取得");
    await expect(status.locator(".rol-status-sub").first()).toContainText(
      "公式更新 8:14",
    );
  });

  // BOA-497 の /code-review 指摘の再現: getRaceMotorMaintenanceBreakdown の戻り値が
  // { state, rows } に変わった後も、直前情報の is_absent から欠場艇を除く（配列のまま読むと
  // .filter で落ち、欠場艇のブロックが「票なし」で残る）
  test("欠場艇（直前情報の is_absent）は3連単の1着ブロックから除く", async ({
    page,
  }) => {
    await page.route(
      (url) =>
        url.pathname.endsWith("/rest/v1/exhibition_data") &&
        (url.searchParams.get("select") ?? "").includes("is_absent"),
      (route) =>
        route.fulfill({
          json: [1, 2, 3, 4, 5, 6].map((n) => ({
            boat_number: n,
            exhibition_time: n === 6 ? null : 6.7,
            tilt: n === 6 ? null : 0,
            adjustment_weight: 0,
            propeller_change: null,
            parts_changed: null,
            today_weight: 52,
            prev_race_no: null,
            prev_entry_course: null,
            prev_start_timing: null,
            prev_finish_rank: null,
            exhibition_course: n === 6 ? null : n,
            is_absent: n === 6,
            updated_at: "2026-09-28T04:50:00Z",
          })),
        }),
    );
    await setup(page, { now: AFTER_DEADLINE });
    await expect(page.locator(".rol-block").first()).toBeVisible();
    await expect(page.locator(".rol-block")).toHaveCount(5);
  });

  test("締切90分より前の当日レース: いつ出るかと公式オッズへの導線を示す", async ({
    page,
  }) => {
    const { calls } = await setup(page, {
      now: new Date("2026-09-28T12:30:00+09:00"),
      snapshots: [],
    });
    const note = page.getByTestId("odds-before-window");
    await expect(note).toContainText("締切90分前から");
    await expect(note.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.boatrace.jp/owpc/pc/race/oddstf?rno=8&jcd=03&hd=20260928",
    );
    expect(calls).toEqual([]);
  });
});

/**
 * 締切時オッズ（公式、BOA-496）の固定。race_odds_final を route でモックする。
 *
 * - あり: 表は締切時オッズだけ（記録値と混ぜない）。状態の1行は「締切時オッズ（公式）｜14:24 締切｜BOATRACE公式から取得」、
 *   更新ボタンなし
 * - 一部の券種だけ: 取れた券種は締切時オッズ、取れなかった券種は従来の表示（記録値と注記）。3連単の表の「2単」は、
 *   締切時の2連単が無ければ「-」（記録値を混ぜない）
 * - なし: 従来の表示のまま
 * - 推移: 最後の点は「締切時（公式）」、0分前の記録は外す、最後の区間は点線、パネルの下に注記
 */
// BOA-547: 締切直後〜締切時オッズ（公式）の保存（締切5分後〜最大60分後）までは記録値の表示になり、保存後に
// 締切時オッズへ入れ替わる。その間は、あとで切り替わることを予告する
test.describe("締切時オッズへの切り替えの予告（BOA-547）", () => {
  test.slow();

  test("締切後1時間以内で締切時オッズがまだ無い: 予告を出す", async ({
    page,
  }) => {
    const { status } = await setup(page, { now: AFTER_DEADLINE }); // 締切16分後
    await expect(status).toContainText("13:54 取得");
    const pending = page.getByTestId("odds-final-pending");
    await expect(pending).toContainText("開き直すと切り替わります");
    // 長い注意書きに埋もれないよう、状態の1行の先頭に置く（ファン評価1周目 P3）
    await expect(status.locator(":scope > *").first()).toHaveAttribute(
      "data-testid",
      "odds-final-pending",
    );
  });

  test("この券種の記録が無くても、締切後1時間以内なら予告を出す（ファン評価1周目 P2）", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE }); // スナップショットは3連単・単勝複勝だけ
    await page.getByRole("tab", { name: "2連単" }).click();
    await expect(page.locator(".rol-no-data")).toBeVisible();
    await expect(page.getByTestId("odds-final-pending")).toBeVisible();
  });

  test("記録が1つも無いレースの締切後: 「発走が近づくと」と書かず、予告を出す（ファン評価1周目 P2）", async ({
    page,
  }) => {
    await setup(page, { now: AFTER_DEADLINE, snapshots: [] });
    const body = page.getByTestId("odds-empty-body");
    await expect(body).toContainText("開き直すと切り替わります");
    await expect(body).not.toContainText("発走が近づくと");
  });

  test("締切時オッズの保存を始めた日以降で、1時間を過ぎても無い: 取得できなかったと書く（ファン評価1周目 P3）", async ({
    page,
  }) => {
    const { status } = await setup(page, {
      race: "2026-09-29-16-12", // 児島12R（締切 16:50）
      now: new Date("2026-09-29T18:00:00+09:00"),
    });
    await expect(status).toContainText("取得できませんでした");
    await expect(page.getByTestId("odds-final-pending")).toHaveCount(0);
  });

  test("締切から1時間を過ぎた（取り直しの期間が終わった）: 予告を出さない", async ({
    page,
  }) => {
    const { status } = await setup(page, {
      now: new Date("2026-09-28T15:30:00+09:00"),
    });
    await expect(status).toContainText("取得");
    await expect(page.getByTestId("odds-final-pending")).toHaveCount(0);
    // 保存を始める前（9/28）のレースは「取得できませんでした」とも書かない
    await expect(page.getByTestId("odds-final-unavailable")).toHaveCount(0);
  });
});

test.describe("締切時オッズ（公式、BOA-496）", () => {
  test.slow();

  // 締切時オッズ: 記録（スナップショット）と区別できるよう、値を変えて作る
  const bump = (map, add) =>
    Object.fromEntries(
      Object.entries(map).map(([k, v]) => [
        k,
        typeof v === "number"
          ? Math.round((v + add) * 10) / 10
          : { low: v.low + add, high: v.high + add },
      ]),
    );
  const FINAL_T3 = bump(SNAPSHOT_ROW.trifecta_all, 1);
  const FINAL_EXACTA = bump(PARSED["2tf"].data.exactaAll, 2);
  const FINAL_ROW = {
    captured_at: "2026-09-28T05:31:00Z",
    win_all: { 1: 1.3, 2: 3.2, 3: 6.0, 4: 0, 5: 27.3, 6: 18.2 },
    place_all: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((n) => [n, { low: 1.0 + n, high: 2.0 + n }]),
    ),
    trifecta_all: FINAL_T3,
    trio_all: bump(PARSED["3f"].data.trioAll, 1),
    exacta_all: FINAL_EXACTA,
    quinella_all: bump(PARSED["2tf"].data.quinellaAll, 1),
    wide_all: bump(PARSED.k.data.wideAll, 1),
  };
  // 締切直前（0分前）の記録
  const AT_DEADLINE_ROW = {
    ...SNAPSHOT_ROW,
    captured_at: "2026-09-28T05:24:10Z",
    trifecta_all: bump(SNAPSHOT_ROW.trifecta_all, 0.5),
  };

  test("あり: 表は締切時オッズだけ。状態の1行は公式・締切時刻・出典で、更新ボタンなし", async ({
    page,
  }) => {
    const { calls, status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, AT_DEADLINE_ROW],
      final: FINAL_ROW,
    });
    await expect(status).toHaveAttribute("data-state", "final");
    await expect(status).toContainText("締切時オッズ（公式）");
    await expect(status).toContainText("14:24 締切");
    await expect(status).toContainText("BOATRACE公式から取得");
    await expect(status).not.toContainText("取得（締切");
    await expect(status.getByRole("button")).toHaveCount(0);
    expect(calls).toEqual([]);
    const v123 = FINAL_T3["1-2-3"].toFixed(1);
    await expect(
      page.getByRole("button", { name: `1-2-3 ${v123}`, exact: true }),
    ).toBeVisible();
    // 「2単」も締切時オッズ（記録の行には2連単が無い）
    await expect(
      page.locator(".rol-block").first().locator(".rol-col").first(),
    ).toContainText(`2単${FINAL_EXACTA["1-2"].toFixed(1)}`);
  });

  test("あり（単勝・複勝）: 票0は「票なし」、「未取得」の注記は出さない", async ({
    page,
  }) => {
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      final: FINAL_ROW,
    });
    await page.getByRole("tab", { name: "単勝・複勝" }).click();
    await expect(status).toContainText("締切時オッズ（公式）");
    const table = page.locator(".rol-win-table");
    await expect(table).toContainText("27.3");
    await expect(table).toContainText("5.0-6.0");
    const row4 = table.locator("tbody tr").filter({
      has: page.locator(".rol-boat-badge", { hasText: /^4$/ }),
    });
    await expect(row4.locator("td").first()).toHaveText("票なし");
    await expect(page.locator(".rol-callout")).toHaveCount(0);
    // ファン評価2周目 P2: 締切時オッズの表の上に「締切前は票が少なく…ずれる」を出さない
    await expect(page.locator(".rol-guide")).not.toContainText("締切前");
  });

  test("一部の券種だけ: 取れなかった券種は従来の表示。3連単の「2単」は記録値を混ぜず「-」", async ({
    page,
  }) => {
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [
        {
          ...SNAPSHOT_ROW,
          exacta_all: PARSED["2tf"].data.exactaAll,
          wide_all: PARSED.k.data.wideAll,
        },
      ],
      final: {
        ...FINAL_ROW,
        exacta_all: null,
        wide_all: null,
      },
    });
    await expect(status).toContainText("締切時オッズ（公式）");
    await expect(
      page.locator(".rol-block").first().locator(".rol-col").first(),
    ).toContainText("2単-");
    // ファン評価1周目 P2: 「2単」が「-」の理由と、表示が切り替わる理由を示す
    await expect(page.getByTestId("odds-final-missing")).toContainText(
      "2連単の締切時オッズ（公式）は取得できなかった",
    );
    await page.getByRole("tab", { name: "拡連複" }).click();
    await expect(status).not.toHaveAttribute("data-state", "final");
    await expect(status).toContainText("13:54 取得（締切30分前）の値");
    await expect(status).toContainText(
      "締切時オッズ・確定の払戻とは一致しないことがあります",
    );
    await expect(page.getByTestId("odds-final-missing")).toContainText(
      "この券種は締切時オッズ（公式）を取得できなかった",
    );
  });

  test("なし: 従来の表示（記録値と注記）のまま", async ({ page }) => {
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, AT_DEADLINE_ROW],
      final: null,
    });
    await expect(status).not.toHaveAttribute("data-state", "final");
    await expect(status).toContainText("14:24 取得（締切直前）の値");
    await expect(page.getByTestId("odds-final-missing")).toHaveCount(0);
  });

  test("推移: 最後の点は「締切時（公式）」、0分前の記録を外し、最後の区間は点線、注記を出す", async ({
    page,
  }) => {
    await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [SNAPSHOT_ROW, AT_DEADLINE_ROW],
      final: FINAL_ROW,
    });
    await page
      .getByRole("button", {
        name: `1-2-3 ${FINAL_T3["1-2-3"].toFixed(1)}`,
        exact: true,
      })
      .click();
    const labels = page.locator(".rol-trend-label");
    await expect(labels).toHaveText(["締切30分前", "締切時（公式）"]);
    await expect(page.locator(".rol-trend-item.is-official")).toContainText(
      FINAL_T3["1-2-3"].toFixed(1),
    );
    await expect(page.locator(".rol-trend")).not.toContainText("締切直前");
    await expect(page.locator(".rol-sparkline-official-line")).toHaveCount(1);
    // ファン評価1周目 P3: 点は長さ0の丸い線端（circle だと横に引き伸ばされて楕円になる）
    await expect(page.locator("line.rol-sparkline-official")).toHaveCount(1);
    await expect(page.getByTestId("odds-trend-note")).toContainText(
      "その時点に取得した公式表示です",
    );
  });

  // ファン評価で3回出た指摘の再現（BOA-547）: 推移の最後の点（締切時・公式）と「締切時（公式）」のマスの横位置が
  // ずれる（375px では2段目の左端に落ちる）。点とマスが同じ列に並ぶことを 375・768・1440px で固定する
  for (const width of [375, 768, 1440]) {
    test(`推移: ${width}px で折れ線の点と値のマスの横位置がそろう（最後の点＝締切時（公式））`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      const snaps = [
        "2026-09-28T04:24:00Z",
        "2026-09-28T04:54:00Z",
        "2026-09-28T05:09:00Z",
        "2026-09-28T05:14:00Z",
        "2026-09-28T05:19:00Z",
      ].map((captured_at, i) => ({
        ...SNAPSHOT_ROW,
        captured_at,
        trifecta_all: bump(SNAPSHOT_ROW.trifecta_all, 5 - i),
      }));
      await setup(page, {
        now: AFTER_DEADLINE,
        snapshots: [...snaps, AT_DEADLINE_ROW],
        final: FINAL_ROW,
      });
      await page
        .getByRole("button", {
          name: `1-2-3 ${FINAL_T3["1-2-3"].toFixed(1)}`,
          exact: true,
        })
        .click();
      await expect(page.locator(".rol-trend-item")).toHaveCount(6);
      const pos = await page.evaluate(() => {
        const center = (r) => r.left + r.width / 2;
        const items = [...document.querySelectorAll(".rol-trend-item")].map(
          (el) => {
            const r = el.getBoundingClientRect();
            return { x: center(r), top: Math.round(r.top) };
          },
        );
        const dot = document
          .querySelector("line.rol-sparkline-official")
          .getBoundingClientRect();
        const poly = document.querySelector(".rol-sparkline polyline");
        const svg = document.querySelector(".rol-sparkline");
        const svgRect = svg.getBoundingClientRect();
        const vbWidth = svg.viewBox.baseVal.width;
        const firstX = Number(
          poly.getAttribute("points").split(" ")[0].split(",")[0],
        );
        return {
          items,
          dotX: dot.left + dot.width / 2,
          firstX: svgRect.left + (firstX / vbWidth) * svgRect.width,
        };
      });
      const last = pos.items[pos.items.length - 1];
      // 全マスが1段に並ぶ
      expect(new Set(pos.items.map((i) => i.top)).size).toBe(1);
      // 最後の点と「締切時（公式）」のマス、最初の点と「締切60分前」のマスの中心のずれが6px以内
      expect(Math.abs(pos.dotX - last.x)).toBeLessThanOrEqual(6);
      expect(Math.abs(pos.firstX - pos.items[0].x)).toBeLessThanOrEqual(6);
    });
  }

  // /code-review 指摘の再現: 一部の券種だけの行をキャッシュすると、翌日には過去レースの7日TTLで返り続け、
  // 後から Cron が埋めた券種が出ない。一部だけの行は保存せず、全券種そろった行だけ保存する
  test("キャッシュ: 一部の券種だけの行は保存せず、全券種そろった行だけ保存する", async ({
    page,
  }) => {
    const cacheKey = `boatai:race-odds-final-v1-${RACE}`;
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      final: { ...FINAL_ROW, wide_all: null },
    });
    await expect(status).toContainText("締切時オッズ（公式）");
    expect(
      await page.evaluate((k) => localStorage.getItem(k), cacheKey),
    ).toBeNull();

    const page2 = await page.context().newPage();
    const second = await setup(page2, {
      now: AFTER_DEADLINE,
      final: FINAL_ROW,
    });
    await expect(second.status).toContainText("締切時オッズ（公式）");
    expect(
      await page2.evaluate((k) => localStorage.getItem(k), cacheKey),
    ).not.toBeNull();
  });

  test("記録が無くても締切時オッズだけで表を出す", async ({ page }) => {
    const { status } = await setup(page, {
      now: AFTER_DEADLINE,
      snapshots: [],
      final: FINAL_ROW,
    });
    await expect(status).toContainText("締切時オッズ（公式）");
    await expect(page.locator(".rol-block").first()).toBeVisible();
    // ファン評価1周目 P3: ○分前の記録が無いときは「○分前の値は…」の注記を出さない
    await page.getByRole("button", { name: /^1-2-3 / }).click();
    await expect(page.locator(".rol-trend-item.is-official")).toBeVisible();
    await expect(page.getByTestId("odds-trend-note")).toHaveCount(0);
  });
});
