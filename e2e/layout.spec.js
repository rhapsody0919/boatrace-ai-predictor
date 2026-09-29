import { test, expect } from "@playwright/test";

/**
 * 画面幅ごとのレイアウト崩れを機械的に検知する。
 *
 * 背景: 2026-09-25時点でE2Eはすべて既定ビューポート（1280x720）だけで走っており、
 * モバイル幅も広いPC幅も一度も検証されていなかった（setViewportSize・devices[]・
 * config の viewport の使用がいずれも0件）。モバイルファーストのPWAを標榜しながら
 * 主戦場が未検証で、実際にトップページのブログ一覧が1440px以上で右側に
 * 大きく空白を作る状態が放置されていた。
 *
 * このファイルだけ playwright.config.js の layout-* プロジェクトで
 * 375 / 768 / 1024 / 1440 / 1920px を横断して実行する
 * （既存の smoke.spec.js は従来どおり既定ビューポートで1回だけ）。
 * 幅は「メディアクエリの境界」と「レイアウトが切り替わる帯の中」の両方を通す。
 * 375/1440/1920 の3軸だけにしていたとき、769〜1255px の帯で列が落ちる崩れを
 * まるごと見逃した（ADR-0073）。
 *
 * 検知するもの:
 *   1. 横スクロールの発生（要素が画面幅を超えている）
 *   2. グリッドの空トラック（幅を持つ列の数 > 実アイテム数。右側に空白が残る）
 *   3. グリッドの使い残し（箱の幅 −（トラック合計 + gap合計）が大きい。
 *      トラックの上限を固定pxで抑えると列数の刻みが粗くなり、列は余っていないのに
 *      箱の中に空きが残る。2 だけでは素通りする）
 *
 * 「見た目が美しいか」は判定しない。どれも「箱の幅に対して中身が足りていない」
 * という構造的な事実で、閾値のチューニングなしに判定できるものだけを対象にする。
 */

const PAGES = [
  "/",
  "/about",
  "/accuracy",
  "/winning-technique",
  "/races",
  "/hit-races",
  "/blog",
  "/faq",
  "/how-to-use",
  "/racers",
  // 会場ガイド一覧は en / zh-TW / ko のみ（config/languages.js の
  // LANGUAGE_ONLY_PATHS）。ja の "/venues" はルートが無く "/" へ
  // リダイレクトされるため、実在する "/en/venues" を見る
  "/en/venues",
  "/today",
  // 横長のテーブル（出走表・全艇比較）を持つ導線は、モバイルで横あふれを
  // 起こすリスクが最も高い。日付は smoke.spec.js と同じ実データを使う
  "/races/2026-08-11",
  "/race/2026-09-21-02-05",
  "/racer/4320",
];

/** グリッドの空トラックとみなす最小の余白。gapや端数の誤差を除くための閾値 */
const TRAILING_GAP_THRESHOLD_PX = 40;

/** 横スクロールの許容誤差（スクロールバー・小数丸めの分） */
const OVERFLOW_TOLERANCE_PX = 2;

async function gotoAndSettle(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Supabase由来のカード・バッジが描画される前に測ると、アイテム数が0のまま
  // 判定してしまう。通信が終わらないページもあるためタイムアウトは許容する
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch((error) => {
      if (error.name !== "TimeoutError") throw error;
    });
  await expect(page.locator(".app-header")).toBeVisible();
}

test.describe("レイアウト: 横スクロールが発生しない", () => {
  for (const path of PAGES) {
    test(`${path} で横スクロールが出ない`, async ({ page }) => {
      await gotoAndSettle(page, path);

      const overflow = await page.evaluate((tolerance) => {
        const de = document.documentElement;
        if (de.scrollWidth <= de.clientWidth + tolerance) return null;

        // はみ出している要素を特定して、原因が分かる形で報告する
        const culprits = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > de.clientWidth + tolerance) {
            culprits.push({
              tag: el.tagName.toLowerCase(),
              cls: (typeof el.className === "string" ? el.className : "").slice(
                0,
                60,
              ),
              right: Math.round(r.right),
              width: Math.round(r.width),
            });
          }
        }
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          culprits: culprits.slice(0, 8),
        };
      }, OVERFLOW_TOLERANCE_PX);

      expect(overflow, JSON.stringify(overflow, null, 2)).toBeNull();
    });
  }
});

/**
 * 開いているページの全グリッドを見て「箱の幅に対して中身が足りていない」ものを返す。
 *
 * 2種類の無駄を見る。どちらも「箱の幅に対して中身が足りていない」という
 * 構造的な事実で、見た目の好みの判定ではない。
 *
 *   (a) 空トラック: 幅を持つ列の数 > 実アイテム数。
 *       repeat(auto-fill, ...) はアイテムが足りなくても列の枠を作るため、
 *       カード3枚に対して5列分の枠ができて右に空白が残る。
 *       repeat(3, ...) のような固定列数でも、アイテムが列数を下回れば同じことが
 *       起きる（BOA-460）。
 *
 *   (b) 使い残し（slack）: グリッドの箱の幅 −（トラック合計 + gap合計）。
 *       トラックの上限を固定pxにすると列数の刻みが粗くなり、
 *       「列は余っていないのに箱の中に大きな空きが残る」状態になる。
 *       (a)だけでは検知できない（列数 ≤ アイテム数なら素通りするため）。
 */
async function inspectGrids(page) {
  return page.evaluate((threshold) => {
    const found = [];
    let gridsChecked = 0;

    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display !== "grid" && cs.display !== "inline-grid") continue;

      // レイアウトされていない要素では gridTemplateColumns が解決前の
      // 指定値（"repeat(auto-fit, minmax(280px, 1fr))" 等）のまま返る。
      // px値に解決されているものだけを対象にする
      const raw = cs.gridTemplateColumns.split(" ").filter(Boolean);
      if (raw.some((t) => !/^-?[\d.]+px$/.test(t))) continue;

      // repeat(auto-fit, ...) が潰したトラックは 0px として残るが、
      // 場所を取らないので列としては数えない
      const tracks = raw.map(parseFloat).filter((n) => n > 0);
      if (tracks.length < 2) continue;

      const items = [...el.children].filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (items.length === 0) continue;

      gridsChecked += 1;

      const gridRect = el.getBoundingClientRect();
      const gap = parseFloat(cs.columnGap) || 0;
      const used =
        tracks.reduce((a, b) => a + b, 0) + gap * (tracks.length - 1);
      const slack = Math.round(gridRect.width - used);
      const emptyTracks = tracks.length - items.length;

      const cls = (typeof el.className === "string" ? el.className : "").slice(
        0,
        60,
      );
      const base = {
        cls,
        columns: tracks.length,
        items: items.length,
        gridWidth: Math.round(gridRect.width),
      };

      if (emptyTracks > 0) {
        const lastRight = Math.max(
          ...items.map((c) => c.getBoundingClientRect().right),
        );
        const trailingGap = Math.round(gridRect.right - lastRight);
        if (trailingGap >= threshold) {
          found.push({ ...base, kind: "空トラック", trailingGap });
          continue;
        }
      }

      if (slack >= threshold) {
        found.push({ ...base, kind: "使い残し", slack });
      }
    }
    return { found, gridsChecked };
  }, TRAILING_GAP_THRESHOLD_PX);
}

function expectNoWastedGrids(result) {
  expect(
    result.found,
    `グリッドの箱の幅に対して中身が足りていません` +
      `（このページで検査したグリッド: ${result.gridsChecked}個）。\n` +
      `「空トラック」なら、アイテム数より多い列を作らない\n` +
      `（repeat(auto-fill, ...) は auto-fit に。固定列数 repeat(N, ...) は、\n` +
      `列数の上限を保ったまま余った列を潰す形にする。実例:\n` +
      `src/components/digest/DigestCardGrid.css の\n` +
      `repeat(auto-fit, minmax(calc((100% - gap * (N-1)) / N), 1fr))）、\n` +
      `「使い残し」ならトラックの上限を固定pxで抑えるのをやめて\n` +
      `minmax(..., 1fr) に戻し、箱の幅は max-width で絞ってください:\n` +
      JSON.stringify(result.found, null, 2),
  ).toEqual([]);
}

test.describe("レイアウト: グリッドの幅が無駄になっていない", () => {
  for (const path of PAGES) {
    test(`${path} のグリッドに使われていない幅が無い`, async ({ page }) => {
      await gotoAndSettle(page, path);
      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});

/**
 * BOA-460 の再現テスト。
 *
 * `/today` のカードは固定列数（480px以上で2列・1024px以上で3列）で並ぶため、
 * 枚数が列数を下回るセクションでは右側に空の列が残っていた
 * （1440pxで718px分の空白）。「まくりが利く選手」は該当が0〜数件の日があり、
 * 実データがたまたま1〜2件になった日だけ上の検査が落ちるため、`src/` を
 * 一切触っていないPRが赤くなった。
 *
 * CSS側は be62d3e3（PR #876）で直っている（auto-fit + 上限列数で割った最小幅）。
 * このテストはその振る舞いを固定するためのもので、実装方法には依存しない
 * （「カードが列数を下回っても右側に幅が余らない」だけを見る）。
 *
 * 再発の検知を実データの巡り合わせに任せないよう、応答をセクションごとに
 * 絞って枚数を固定する。日付も生成済みの過去日に固定する（当日は早朝バッチの
 * 前だと未生成で、ページがカードを出さないため検査が空振りする）。過去日の行は
 * 消えない（generate-morning-digest.js の delete は同じ digest_date だけを消す）。
 */
const DIGEST_FIXED_DATE = "2026-09-22";

/** morning_digest_rows の応答を、セクションごとに先頭 `perSection` 行だけに絞る */
async function capDigestRowsPerSection(page, perSection) {
  await page.route(/\/rest\/v1\/morning_digest_rows/, async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    const kept = [];
    const counts = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const seen = counts.get(row.section) ?? 0;
      if (seen >= perSection) continue;
      counts.set(row.section, seen + 1);
      kept.push(row);
    }
    await route.fulfill({ response, json: kept });
  });
}

test.describe("レイアウト: /today はカードが列数より少なくても幅を余らせない（BOA-460）", () => {
  // 1・2枚は上限列数（480px以上2列・1024px以上3列）を下回る側、3枚は1024px以上で
  // ちょうど、6枚（「もっと見る」の手前まで）は上限を超えて2行になる側（BOA-528）
  for (const perSection of [1, 2, 3, 6]) {
    test(`セクションのカードが${perSection}枚のとき空トラックが出ない`, async ({
      page,
    }) => {
      await capDigestRowsPerSection(page, perSection);
      await gotoAndSettle(page, `/today?date=${DIGEST_FIXED_DATE}`);
      // networkidle はデータが届いた合図にならない。goto が遅いと、Supabase への
      // 要求を出す前に一度 idle になり、その後の waitForLoadState は即座に返る。
      // 2026-09-28/29 の手元実行で、カードが描画される前に数えて0枚になった（BOA-528）
      await expect(page.locator(".digest-grid").first()).toBeVisible({
        timeout: 30000,
      });

      // 絞り込みが効いていない・カードが1枚も出ていない状態で
      // 「空トラックが無い」と判定してしまうのを防ぐ（無言の空振り対策）
      const itemCounts = await page.evaluate(() =>
        [...document.querySelectorAll(".digest-grid")].map(
          (grid) =>
            [...grid.children].filter((child) => {
              const rect = child.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length,
        ),
      );
      expect(
        itemCounts.length,
        `.digest-grid が描画されていません（${DIGEST_FIXED_DATE} のダイジェストが読めていない可能性）`,
      ).toBeGreaterThan(0);
      expect(
        Math.max(...itemCounts),
        `カード枚数が${perSection}枚に絞れていません: ${JSON.stringify(itemCounts)}`,
      ).toBeLessThanOrEqual(perSection);
      expect(
        itemCounts,
        `${perSection}枚のセクションが1つも無く、検査が空振りしています: ${JSON.stringify(itemCounts)}`,
      ).toContain(perSection);

      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});

/**
 * 直前情報タブ（BOA-485）。上の PAGES はレース詳細を既定タブのまま測るため、
 * 直前情報タブの「この枠からの進入コース」カード（艇番・横棒・要約の3列グリッド）と
 * 展示進入の行を含む表は検査の対象外だった。タブを開いた状態で同じ2つの検査を通す。
 * 横棒が要約列に押されて潰れていないか（幅が残っているか）も見る
 */
test.describe("レイアウト: 直前情報タブ（この枠からの進入コース）", () => {
  const RACE = "/race/2026-09-26-08-02";

  test("横スクロールが出ず、グリッドの幅も無駄にならず、横棒が潰れない", async ({
    page,
  }) => {
    await gotoAndSettle(page, RACE);
    await page.click('[role="tab"]:has-text("直前情報")');
    const card = page.getByTestId("entry-course-dist");
    await expect(card.locator(".ecd-seg").first()).toBeVisible({
      timeout: 30000,
    });
    // 6艇ぶんの取得が出揃ってから測る（1艇目の棒が出た時点では他艇が
    // 読み込み中のことがある。CIで実際にそのタイミングを踏んだ）
    await expect(card.locator(".drt-skeleton")).toHaveCount(0, {
      timeout: 30000,
    });

    const layout = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        overflow: de.scrollWidth - de.clientWidth,
        bars: [...document.querySelectorAll(".ecd-row .ecd-bar")].map((bar) =>
          Math.round(bar.getBoundingClientRect().width),
        ),
      };
    });
    expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(
      OVERFLOW_TOLERANCE_PX,
    );
    expect(layout.bars).toHaveLength(6);
    // 375pxでも棒として読める幅がある（艇番28px＋要約104pxを除いた残り）
    for (const width of layout.bars) expect(width).toBeGreaterThan(120);

    expectNoWastedGrids(await inspectGrids(page));
  });
});

/**
 * BOA-527 の再現テスト。
 *
 * `/hit-races` のカード（`.race-cards-grid`）は `repeat(auto-fill, minmax(280px, 1fr))`
 * で並んでいた。`auto-fill` はカードが足りなくても列の枠を作るため、当日の的中が
 * 列数より少ない日だけ右側に空の列が残り（1920px: 6列にカード5枚で右307px）、
 * 上の PAGES の検査が本番データの巡り合わせで落ちていた。
 *
 * 件数を固定して検査するため、「今日」の予想データの応答を生成済みの過去日
 * （HIT_RACES_FIXED_DATE）の行に差し替え、そのうち展開予測が的中したレースを
 * 先頭から `hits` 件だけ残す（検査するのは既定の「今日」タブのグリッド）。
 *
 * 的中の判定は HitRaces.jsx の extractHitRaces と同じ
 * （unified の turnPrediction のパターンに、実際の1着コースが含まれる）。
 * getPredictions はまず Edge API（`/api/predictions/{date}`。dev では vite.config.js が
 * 本番へ転送する）を読み、空・失敗なら Supabase の races への直接クエリに落ちる。
 * どちらの経路でも「今日」が固定日の的中だけになるよう、両方を差し替える。
 */
const HIT_RACES_FIXED_DATE = "2026-09-22";

/** 展開予測の的中か（HitRaces.jsx の extractHitRaces と同じ判定） */
function isTurnPredictionHit(turn, rank1) {
  if (!turn || !rank1) return false;
  return (turn.patterns || [turn]).some((p) => p.winnerCourse === rank1);
}

/** Edge API の races 要素 */
function isEdgeRaceHit(race) {
  return isTurnPredictionHit(
    race.predictions?.unified?.turnPrediction,
    race.result?.rank1,
  );
}

/** Supabase races 直接クエリの行 */
function isSupabaseRowHit(row) {
  const unified = (row.predictions || []).find((p) => p.model_id === "unified");
  const result = Array.isArray(row.race_results)
    ? row.race_results[0]
    : row.race_results;
  return isTurnPredictionHit(
    unified?.feature_contributions?.turnPrediction,
    result?.rank1,
  );
}

/**
 * 「今日」の予想データ応答を、固定日の的中レース先頭 `hits` 件（"all" なら全件）に
 * 差し替える。当日以外の日付はそのまま通す（「今日」タブのグリッドには影響しない）。
 * 返り値の `available` に固定日の的中件数が入る（ケースを作れたかの確認用）
 */
async function serveFixedHitRaces(page, hits) {
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const state = { available: null };
  const pick = (hitRows) => {
    state.available = hitRows.length;
    return hits === "all" ? hitRows : hitRows.slice(0, hits);
  };

  await page.route(`**/api/predictions/${todayJst}*`, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = `/api/predictions/${HIT_RACES_FIXED_DATE}`;
    const response = await route.fetch({ url: url.toString() });
    const body = await response.json();
    const races = pick((body.races || []).filter(isEdgeRaceHit));
    await route.fulfill({ response, json: { ...body, races } });
  });

  await page.route(/\/rest\/v1\/races\?.*race_date=eq\./, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("race_date") !== `eq.${todayJst}`) {
      await route.fallback();
      return;
    }
    url.searchParams.set("race_date", `eq.${HIT_RACES_FIXED_DATE}`);
    const response = await route.fetch({ url: url.toString() });
    const rows = await response.json();
    const kept = pick(
      (Array.isArray(rows) ? rows : []).filter(isSupabaseRowHit),
    );
    await route.fulfill({ response, json: kept });
  });
  return state;
}

test.describe("レイアウト: /hit-races は的中が列数より少なくても幅を余らせない（BOA-527）", () => {
  // 1〜3件は、1440px（4列）・1920px（6列）の列数を下回る側。
  // "all" は列数以上（固定日の的中全件。表示は先頭8件に絞られる）
  for (const hits of [1, 2, 3, "all"]) {
    const label = hits === "all" ? "多数" : `${hits}件`;
    test(`的中が${label}のとき空トラックが出ない`, async ({ page }) => {
      const state = await serveFixedHitRaces(page, hits);
      await gotoAndSettle(page, "/hit-races");

      const grid = page.locator(".hit-races-section .race-cards-grid");
      await expect(
        grid,
        `.race-cards-grid が描画されていません（${HIT_RACES_FIXED_DATE} への差し替えが効いていない可能性）`,
      ).toBeVisible({ timeout: 30000 });

      // 固定日の的中が足りない・差し替えが効かず本番の当日データのまま検査する、
      // という空振りを防ぐ
      expect(
        state.available,
        `${HIT_RACES_FIXED_DATE} の的中が足りず、${label}のケースを作れません`,
      ).toBeGreaterThanOrEqual(hits === "all" ? 9 : hits);
      await expect(grid.locator(":scope > *")).toHaveCount(
        hits === "all" ? 8 : hits,
      );

      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});

/**
 * BOA-528 の再現テスト（/blog のカテゴリ絞り込み）。
 *
 * `/blog` の記事一覧（`.blog-grid`）は `repeat(auto-fill, minmax(320px, 1fr))` で
 * 並んでいた。上の PAGES は「すべて」（121件）のまま測るため列が埋まって通るが、
 * カテゴリで絞ると件数が列数を下回る（「リスク管理」1件・「実績分析」2件・
 * 「上級者向け」3件）。1440px以上は3列なので、1件のカテゴリで右に2列分の空白が残る。
 *
 * 記事はバンドルされた静的データ（src/data/blogPosts.js）なので、本番データにも
 * 通信にも依存しない。カテゴリを全部押して、そのたびにグリッドを検査する。
 */
test.describe("レイアウト: /blog はカテゴリで絞って件数が列数より少なくても幅を余らせない（BOA-528）", () => {
  test("どのカテゴリでも空トラックが出ない", async ({ page }) => {
    await gotoAndSettle(page, "/blog");
    const grid = page.locator(".blog-grid");
    await expect(grid.locator(":scope > *").first()).toBeVisible();

    const buttons = page.locator(".category-filter button");
    const total = await buttons.count();
    expect(total, "カテゴリのボタンが見つかりません").toBeGreaterThan(1);

    const counts = {};
    const found = [];
    // 先頭は「すべて」。PAGES の検査で見ているので飛ばす
    for (let i = 1; i < total; i += 1) {
      const button = buttons.nth(i);
      const category = (await button.textContent()).trim();
      await button.click();
      await expect(button).toHaveClass(/active/);
      counts[category] = await grid.locator(":scope > *").count();
      const result = await inspectGrids(page);
      for (const f of result.found) found.push({ category, ...f });
    }

    // 件数の少ないカテゴリが無くなると、このテストは何も検査しなくなる
    // （無言の空振り対策）。1440px以上の3列を下回るカテゴリが残っていることを確かめる
    expect(
      Math.min(...Object.values(counts)),
      `列数を下回るカテゴリがありません: ${JSON.stringify(counts)}`,
    ).toBeLessThanOrEqual(2);

    expectNoWastedGrids({ found, gridsChecked: total - 1 });
  });
});
