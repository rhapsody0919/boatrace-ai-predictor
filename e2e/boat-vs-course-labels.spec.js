import { test, expect } from "./fixtures.js";
import {
  closeSrcLoader,
  liveSupabase,
  loadSrc,
  srcFixedT,
} from "./src-modules.js";

/**
 * 展開予測の的中は艇番で判定する（BOA-708）。予測が「枠なりを前提に N号艇が勝つ」という
 * 艇の予測のため。一方で、艇番を「Nコース」と書いていた表記が、前付けのあったレースで
 * 誤表示になっていた。表記は艇番にし、前付けで艇番とコースが違うときだけ進入コースを添える。
 */

const tab = (page, label) =>
  page.locator(".race-tabs-btn", { hasText: new RegExp(`^${label}$`) });

test.describe("艇番とコースの表記（BOA-708）", () => {
  // 関数の検査は src/ をテストの側（Node）で読む（e2e/src-modules.js。build した束の preview でも通るように）
  test.afterAll(closeSrcLoader);

  test("前付けのあったレースでは、AI予想タブに1着の艇の進入コースを添える", async ({
    page,
  }) => {
    test.slow();
    // 2026-08-13 桐生2R: 6号艇が1コースに入って1着（予想は1号艇の逃げ → 艇番で判定して外れ）
    await page.goto("/race/2026-08-13-01-02", {
      waitUntil: "domcontentloaded",
    });
    await tab(page, "AI予想").click();
    const note = page.locator(".result-verify-entry-note");
    await expect(note).toContainText("1着の6号艇は1コースから進入しました", {
      timeout: 60000,
    });
  });

  test("艇番どおりのコースから勝ったレースでは、進入コースの注記を出さない", async ({
    page,
  }) => {
    test.slow();
    // 2026-09-27 戸田11R: 1号艇が1コースから1着
    await page.goto("/race/2026-09-27-02-11", {
      waitUntil: "domcontentloaded",
    });
    await tab(page, "AI予想").click();
    await expect(page.locator(".turn-pattern-summary").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.locator(".result-verify-entry-note")).toHaveCount(0);
  });

  test("的中のシェア文は艇番で書き、進入が違うときだけコースを添える", async () => {
    const texts = await (async () => {
      const { generateTurnHitShareText } = await loadSrc("/src/utils/share.js");
      // /hit-races は ja 専用なので ja の文面で確かめる（BOA-754 で文面を locale に移した）
      const t = await srcFixedT("ja");
      const share = (race) => generateTurnHitShareText(race, t);
      const base = { venue: "津", raceNo: 6, date: "2026-08-11" };
      return {
        frontRunner: share({
          ...base,
          winnerBoat: 4,
          winnerEntryCourse: 2,
        }),
        sameCourse: share({
          ...base,
          winnerBoat: 1,
          winnerEntryCourse: 1,
        }),
        unknown: share({
          ...base,
          winnerBoat: 3,
          winnerEntryCourse: null,
        }),
      };
    })();
    expect(texts.frontRunner).toContain("4号艇が2コースから1着");
    expect(texts.sameCourse).toContain("1号艇が1着");
    expect(texts.sameCourse).not.toContain("コースから");
    expect(texts.unknown).toContain("3号艇が1着");
    for (const text of Object.values(texts)) {
      expect(text).not.toContain("コースが先頭");
    }
  });

  test("1着の艇の進入コースは actual_course を優先し、無ければ entry_course で補う", async () => {
    const values = await (async () => {
      const { winnerEntryCourseOf } = await loadSrc(
        "/src/utils/raceOutcome.js",
      );
      return [
        // 確定済み（Kファイル同期後）: actual_course を使う
        winnerEntryCourseOf({ rank1: 4, actual_course_4: 2 }, 3),
        // 当日（同期前）: entry_course で補う
        winnerEntryCourseOf({ rank1: 4, actual_course_4: null }, 2),
        // どちらも無い: 出さない
        winnerEntryCourseOf({ rank1: 4 }, null),
        // 結果が無い
        winnerEntryCourseOf(null, 2),
      ];
    })();
    expect(values).toEqual([2, 2, null, null]);
  });

  // 本番の Supabase に出さず、テストの側で fetch を差し替えて「.in() を500件ずつに分けて読み、つなぐ」ことを確かめる。
  // 以前はブラウザで dataService を読み、録画の応答で確かめていた。build した束では /src を読めないので形を変えた。
  // 500件の .in() の URL を本番が受け付けること（400 にならない）は、本番データの実行（E2E_LIVE）でだけ本番に当てて確かめる
  test("的中レース一覧の全期間（1500件超）でも、1着の艇の進入コースを取れる", async () => {
    const { dataService } = await loadSrc("/src/services/dataService.js");
    // 全期間（14日）を開いたときと同じ規模。1本の .in() では URL が長すぎて 400 になっていた
    const ids = ["2026-08-13-01-02"];
    for (let day = 1; day <= 14; day += 1) {
      for (let venue = 1; venue <= 24; venue += 1) {
        for (let race = 1; race <= 12; race += 1) {
          ids.push(
            `2026-08-${String(day).padStart(2, "0")}-${String(venue).padStart(2, "0")}-${String(race).padStart(2, "0")}`,
          );
        }
      }
    }
    const requested = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const inIds =
        /^in\.\((.*)\)$/
          .exec(url.searchParams.get("race_id") ?? "")?.[1]
          .split(",") ?? [];
      let rows;
      if (url.pathname.endsWith("/rest/v1/race_results")) {
        requested.push(inIds.length);
        rows = [
          // 確定済み: actual_course を使う
          { race_id: "2026-08-13-01-02", rank1: 6, actual_course_6: 1 },
          // 同期前: actual_course が無いので race_start_timings の entry_course で補う
          { race_id: "2026-08-01-01-01", rank1: 2, actual_course_2: null },
        ].filter((r) => inIds.includes(r.race_id));
      } else if (url.pathname.endsWith("/rest/v1/race_start_timings")) {
        rows = inIds.includes("2026-08-01-01-01")
          ? [{ race_id: "2026-08-01-01-01", boat_number: 2, entry_course: 3 }]
          : [];
      } else {
        throw new Error(`想定外の通信: ${url.pathname}`);
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    let courses;
    try {
      courses = await dataService.getRaceWinnerCourses(ids.slice(0, 1600));
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(courses["2026-08-13-01-02"]).toEqual({ boat: 6, course: 1 });
    expect(courses["2026-08-01-01-01"]).toEqual({ boat: 2, course: 3 });
    // 1600件を1本で読まず、500件以下ずつに分けて全部を読む
    expect(Math.max(...requested)).toBeLessThanOrEqual(500);
    expect(requested.reduce((a, b) => a + b, 0)).toBe(1600);

    // 本番データの実行では、500件の .in() を本番に1本だけ当てて、URL の長さで 400 にならないことを確かめる
    if (process.env.E2E_LIVE === "1") {
      const res = await fetch(
        `${liveSupabase.url}/rest/v1/race_results?select=race_id&race_id=in.(${ids.slice(0, 500).join(",")})&limit=1`,
        {
          headers: {
            apikey: liveSupabase.key,
            Authorization: `Bearer ${liveSupabase.key}`,
          },
        },
      );
      expect(res.status).toBe(200);
    }
  });

  test("イン崩れの表は、比べる列と基準の列をどちらも1号艇で書く", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/accuracy", { waitUntil: "domcontentloaded" });
    const details = page.locator(".vas-venue-details");
    await details.locator("summary").click({ timeout: 60000 });
    const headers = details.locator("thead th");
    await expect(headers.nth(1)).toHaveText(
      "イン崩れ注意（高）ラベル時に1号艇が負けた割合",
    );
    await expect(headers.nth(2)).toHaveText(
      "会場全体で1号艇が負けた割合の平均",
    );
  });

  test("的中率ページの展開予測の説明は、1着の艇で判定すると書く", async ({
    page,
  }) => {
    test.slow();
    await page.goto("/accuracy", { waitUntil: "domcontentloaded" });
    const note = page.locator(".turn-accuracy-hero-note");
    await expect(note).toContainText("いずれかの艇が実際に1着になった割合", {
      timeout: 60000,
    });
    await expect(page.locator("body")).not.toContainText("1着コースと一致");
  });
});
