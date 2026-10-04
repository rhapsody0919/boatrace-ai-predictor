import { test, expect, e2eTodayJST, fetchRecorded } from "./fixtures.js";
import { contribution } from "./analogy-contribution-fixture.js";

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

/**
 * ページごとに「データが描画された」とみなす要素。gotoAndSettle はこれが見えるまで待つ。
 *
 * networkidle だけでは足りない。一度 idle に達すると以後の waitForLoadState は待たず、
 * マシンの負荷で goto が遅いと、データの要求を出す前に idle に達して計測に進み、
 * グリッドが0個のまま「崩れ無し」と判定していた（#936 の分析: goto 21.1秒 → idle 15ms →
 * 差し替え完了 25.7秒 → 計測 27.5秒で .digest-grid 0個）。
 * 静的なページ（/about・/faq・/how-to-use・/blog・/en/venues）は、データを待つ必要が無いので載せない。
 * 選んだ要素は 2026-09-29 の録画の再生で、各ページの主データとして描画されるものを実測した
 */
const READY_SELECTORS = {
  // スケルトン（VenueGridSkeleton）も .venue-grid-card を持つため、実物だけに付く修飾子で待つ（BOA-593）
  "/": ".venue-grid-card--open, .venue-grid-card--closed",
  "/accuracy": ".turn-accuracy-venue-table",
  "/winning-technique": ".winning-technique-table",
  "/races": ".dates-list .date-card",
  "/hit-races": ".race-cards-grid",
  "/racers": ".racer-compact-row, .racer-table",
  "/today": ".digest-grid",
  "/races/2026-08-11": ".venue-grid-card--open",
  "/race/2026-09-21-02-05": ".rbit-bar-row",
  "/racer/4320": ".racer-stat-cards-grid",
};

async function gotoAndSettle(page, path) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-header")).toBeVisible();
  const ready = READY_SELECTORS[path];
  if (ready) {
    // 表示の有無ではなく DOM に入ったかで見る（折りたたみ・幅ごとの出し分けで
    // 非表示になっている要素でも、データが届いたことは分かる）
    await expect(
      page.locator(ready).first(),
      `${path} の主データ（${ready}）が描画されていません`,
    ).toBeAttached({ timeout: 30000 });
  }
  // 主データの後に届く付随データ（バッジ・件数）も待つ。通信が終わらないページもあるため
  // タイムアウトは許容する（主データは上で確認済み）
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch((error) => {
      if (error.name !== "TimeoutError") throw error;
    });
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
    // route.fetch() は録画を通らないため、録画から同じ応答を返す fetchRecorded を使う
    const response = await fetchRecorded(route);
    const rows = await response.json();
    const kept = [];
    const counts = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const seen = counts.get(row.section) ?? 0;
      if (seen >= perSection) continue;
      counts.set(row.section, seen + 1);
      kept.push(row);
    }
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: kept,
    });
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
  // ブラウザの時計は録画時刻に固定されている（e2e/fixtures.js）。Node 側の「今日」も揃える
  const todayJst = e2eTodayJST();
  const state = { available: null };
  const pick = (hitRows) => {
    state.available = hitRows.length;
    return hits === "all" ? hitRows : hitRows.slice(0, hits);
  };

  await page.route(`**/api/predictions/${todayJst}*`, async (route) => {
    const url = new URL(route.request().url());
    url.pathname = `/api/predictions/${HIT_RACES_FIXED_DATE}`;
    // route.fetch() は録画を通らないため fetchRecorded を使う（ADR-0077）
    const response = await fetchRecorded(route, { url: url.toString() });
    const body = await response.json();
    const races = pick((body.races || []).filter(isEdgeRaceHit));
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: { ...body, races },
    });
  });

  await page.route(/\/rest\/v1\/races\?.*race_date=eq\./, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("race_date") !== `eq.${todayJst}`) {
      await route.fallback();
      return;
    }
    url.searchParams.set("race_date", `eq.${HIT_RACES_FIXED_DATE}`);
    const response = await fetchRecorded(route, { url: url.toString() });
    const rows = await response.json();
    const kept = pick(
      (Array.isArray(rows) ? rows : []).filter(isSupabaseRowHit),
    );
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: kept,
    });
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
 * 記事はバンドルされた静的データ（src/data/blog-posts/*.json）なので、本番データにも
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

/**
 * BOA-539 の再現テスト。
 *
 * `/guide`（src/pages/ContentHub.css）とホーム（src/components/race/VenueGrid.css）が、
 * 同じ詳細度の `.venue-grid` を別々に定義していた。CSSは全ページ分が1つのバンドルに
 * 結合され、ContentHub.css が後に来るため、ホームの会場グリッドに `/guide` 側の
 * `repeat(auto-fill, minmax(100px, 1fr))` が効いていた（修正前の実測: 1024pxで8列・
 * 1440pxで12列・1920pxで16列。VenueGrid.css の指定は4列）。
 * 読み込み順だけで決まるため、どのページから開いても同じ結果になる。ここでは
 * 両ページのCSSが確実に適用済みになる「/guide → SPA遷移でホーム」の順で測る。
 * `/guide` 側は `.guide-venue-grid` に改名して名前空間を分けた。
 *
 * 期待値は VenueGrid.css の指定（421px以上で4列、420px以下で3列、320px以下で2列）
 */
function expectedHomeVenueColumns(width) {
  if (width <= 320) return 2;
  if (width <= 420) return 3;
  return 4;
}

test.describe("レイアウト: ホームの会場グリッドに /guide の指定が効かない（BOA-539）", () => {
  test("/guide からSPA遷移で戻ったホームの会場グリッドが意図した列数になる", async ({
    page,
  }) => {
    await gotoAndSettle(page, "/guide");
    // /guide の会場リンク（24場）が描画され、ContentHub.css が適用済みであること
    await expect(
      page.locator('.venue-section a[href^="/blog/venue-"]'),
    ).toHaveCount(24);

    // ヘッダーのロゴは navigate("/") のSPA遷移（ページを再読み込みしない）
    await page.locator(".app-header .logo").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.locator(".venue-grid-card--open, .venue-grid-card--closed").first(),
    ).toBeAttached({ timeout: 30000 });

    const grid = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".venue-grid"));
      return {
        width: window.innerWidth,
        columns: cs.gridTemplateColumns.split(" ").filter(Boolean).length,
        gridTemplateColumns: cs.gridTemplateColumns,
      };
    });
    expect(grid.columns, JSON.stringify(grid)).toBe(
      expectedHomeVenueColumns(grid.width),
    );
  });
});

/**
 * BOA-570 の再現テスト。
 *
 * `/admin/rules`（src/pages/admin/AdminRules.css）と `/admin/sns-hub`
 * （src/pages/admin/SnsHubAdmin.css）が、同じ詳細度の `.tab-btn`・`.tab-content`・
 * `.loading-state`・`.error-state` を別々に定義していた。CSSは1つのバンドルに結合され、
 * SnsHubAdmin.css が後に来るため、`/admin/rules` のタブが SNSハブの青（#0ea5e9）になり、
 * AdminRules.css の @media の上書き（768px以下・480px以下の余白と文字サイズ）も
 * SNSハブの基本指定に負けて効いていなかった（修正前の実測: 768pxでタブの padding が
 * 9.6px 20px、文字 14.4px）。両画面ともクラス名に画面固有の接頭辞を付けて分けた。
 * 両方のCSSが適用済みになる「/admin/sns-hub → SPA遷移で /admin/rules」の順で測る。
 *
 * 期待値は各CSSファイルの指定そのもの:
 *   AdminRules.css  … アクティブの背景 #7c3aed。padding は 768px以下 0.5rem 1rem、
 *                      480px以下 0.4rem 0.75rem、それ以外 0.6rem 1.25rem
 *   SnsHubAdmin.css … padding は 480px以下 0.5rem 0.75rem、それ以外 0.6rem 1.25rem
 */
function expectedAdminRulesTabPadding(width) {
  if (width <= 480) return "6.4px 12px";
  if (width <= 768) return "8px 16px";
  return "9.6px 20px";
}

function expectedSnsHubTabPadding(width) {
  return width <= 480 ? "8px 12px" : "9.6px 20px";
}

const fulfillAdminJson = (body) => (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

test.describe("レイアウト: 管理画面2つのタブの指定が混ざらない（BOA-570）", () => {
  test("/admin/sns-hub からSPA遷移した /admin/rules のタブが AdminRules.css の指定になる", async ({
    page,
  }) => {
    // dev サーバーには Edge Function が無いので管理APIはスタブにする
    // （e2e/admin-rules-performance.spec.js と同じ）。predictions も空で返し、
    // 録画に無いリクエストを本番へ素通しさせない（BOA-551）
    await page.route(/\/api\/admin\/sns-hub\//, fulfillAdminJson({ data: [] }));
    await page.route(
      /\/api\/admin\/rules\/performance/,
      fulfillAdminJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 0, hits: 0, payout: 0 },
          by_rule: [],
          by_week: [],
        },
      }),
    );
    await page.route(/\/rest\/v1\/predictions\?/, fulfillAdminJson([]));

    const tabStyle = (selector) =>
      page.locator(selector).evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          width: window.innerWidth,
          padding: cs.padding,
          backgroundColor: cs.backgroundColor,
        };
      });

    await page.goto("/admin/sns-hub");
    const snsTab = await tabStyle(".sns-hub-tab-btn.active");
    expect(snsTab.padding, JSON.stringify(snsTab)).toBe(
      expectedSnsHubTabPadding(snsTab.width),
    );
    // SNSハブ側は自分の配色のまま（AdminRules.css の紫が漏れていない）
    expect(snsTab.backgroundColor).not.toBe("rgb(124, 58, 237)");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/rules");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\/rules$/);
    const rulesTab = await tabStyle(".admin-rules-tab-btn.active");
    expect(rulesTab.padding, JSON.stringify(rulesTab)).toBe(
      expectedAdminRulesTabPadding(rulesTab.width),
    );
    expect(rulesTab.backgroundColor, JSON.stringify(rulesTab)).toBe(
      "rgb(124, 58, 237)",
    );
  });

  /**
   * BOA-570 の最後の1件（.tab-navigation のleak）。
   *
   * AdminRules.css と SnsHubAdmin.css が同じ詳細度で `.tab-navigation` を
   * 定義しており（AdminRules.css は余白をタブ本体に、SnsHubAdmin.css は
   * `.tab-navigation-row` に置く設計）、CSSが1つのバンドルに結合され後に来る
   * 方が勝つため、AdminRules.css の margin-bottom: 1rem が /admin/sns-hub の
   * タブの下にも漏れていた（修正前の実測: /admin/sns-hub のタブ下の余白が
   * 本来の16pxから32pxに増える）。画面ごとに admin-rules- / sns-hub- の
   * 接頭辞を付けて分けた。
   *
   * 期待値は各CSSファイルの設計そのもの:
   *   AdminRules.css  … 余白はタブ本体(.admin-rules-tab-navigation)に1rem
   *   SnsHubAdmin.css … 余白は行(.tab-navigation-row)に1rem、タブ本体は0
   */
  test("/admin/sns-hub のタブ下の余白に AdminRules.css の margin-bottom が漏れない", async ({
    page,
  }) => {
    await page.route(/\/api\/admin\/sns-hub\//, fulfillAdminJson({ data: [] }));
    await page.route(
      /\/api\/admin\/rules\/performance/,
      fulfillAdminJson({
        startDate: "2026-01-16",
        data: {
          total: { samples: 0, hits: 0, payout: 0 },
          by_rule: [],
          by_week: [],
        },
      }),
    );
    await page.route(/\/rest\/v1\/predictions\?/, fulfillAdminJson([]));

    const marginBottom = (selector) =>
      page
        .locator(selector)
        .evaluate((el) => getComputedStyle(el).marginBottom);

    await page.goto("/admin/sns-hub");
    await expect(page.locator(".sns-hub-tab-navigation")).toBeVisible();
    expect(await marginBottom(".tab-navigation-row")).toBe("16px");
    expect(await marginBottom(".sns-hub-tab-navigation")).toBe("0px");

    await page.evaluate(() => {
      window.history.pushState({}, "", "/admin/rules");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await expect(page).toHaveURL(/\/admin\/rules$/);
    await expect(page.locator(".admin-rules-tab-navigation")).toBeVisible();
    expect(await marginBottom(".admin-rules-tab-navigation")).toBe("16px");
  });
});

/**
 * AI予想タブのアナロジー・ファインダー節（BOA-271 FR-1 寄与度）。上の PAGES はレース詳細を既定タブのまま
 * 測るため、節は検査の対象外。寄与度 API だけを固定値に差し替え（本番のテーブルに依存しない）、
 * 艇番比較の表とテーマの内訳を開いた状態で横スクロールとグリッドを見る
 */
test.describe("レイアウト: AI予想タブのアナロジー・ファインダー節", () => {
  const RACE = "/race/2026-09-26-08-02";

  test("艇番比較と内訳を開いても横スクロールが出ず、グリッドの幅も無駄にならない", async ({
    page,
  }) => {
    // 公開までは機能フラグで隠している。内部確認の印を立てて測る
    await page.addInitScript(() =>
      localStorage.setItem("boatai-user:analogy-finder-preview", "1"),
    );
    await page.route("**/api/analogy/contribution*", (route) => {
      const u = new URL(route.request().url());
      return route.fulfill({
        json: contribution({
          venue: Number(u.searchParams.get("venue")),
          grade: u.searchParams.get("grade"),
          round: u.searchParams.get("round"),
          target: Number(u.searchParams.get("target")),
        }),
      });
    });
    await gotoAndSettle(page, RACE);
    await page.click('[role="tab"]:has-text("AI予想")');
    const section = page.getByRole("region", {
      name: "アナロジー・ファインダー",
    });
    await expect(section).toBeVisible({ timeout: 30000 });
    await section.getByRole("checkbox", { name: "艇番で比較" }).check();
    await section.getByRole("button", { name: /選手・基礎成績/ }).click();
    await expect(section.getByRole("table")).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
    expectNoWastedGrids(await inspectGrids(page));
  });
});

// 会場のレース一覧カード（BOA-558 の6・BOA-586）。2026-09-24 桐生は準優勝戦（バッジ3つ）を含む
test.describe("レイアウト: 会場のレース一覧カード（出走表の列・モーターの行・見出しの高さ）", () => {
  test("6号艇の列が切れず、モーターの値が罫線に接さず、同じ段のカードの出走表の高さがそろう", async ({
    page,
  }) => {
    await page.goto("/races/2026-09-24/1", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".race-card .rcdt-table").first()).toBeVisible({
      timeout: 30000,
    });
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch((error) => {
        if (error.name !== "TimeoutError") throw error;
      });

    const m = await page.evaluate(() => {
      const cards = [
        ...document.querySelectorAll(".race-list-section .race-card"),
      ];
      return cards.map((card) => {
        const wrap = card.querySelector(".rcdt-table-wrapper");
        const table = card.querySelector(".rcdt-table");
        const lastBoat = table.querySelector("thead tr th:last-child");
        const motorRow = [...table.querySelectorAll("tbody tr")].find((tr) =>
          /モーター/.test(tr.textContent),
        );
        const gaps = motorRow
          ? [...motorRow.querySelectorAll("td.rcdt-cell")]
              .map((td) => {
                const value = td.querySelector(".drt-value > span");
                if (!value) return null;
                const a = td.getBoundingClientRect();
                const b = value.getBoundingClientRect();
                return Math.min(b.left - a.left, a.right - b.right);
              })
              .filter((g) => g !== null)
          : [];
        const c = card.getBoundingClientRect();
        return {
          // 6号艇の列が表の枠の中にある（BOA-559 の再発防止）
          overflow: wrap.scrollWidth - wrap.clientWidth,
          lastBoatRight: lastBoat.getBoundingClientRect().right,
          wrapRight: wrap.getBoundingClientRect().right,
          minMotorGap: gaps.length ? Math.min(...gaps) : null,
          rowTop: Math.round(c.top),
          tableTop: table.getBoundingClientRect().top - c.top,
        };
      });
    });

    expect(m.length).toBeGreaterThan(0);
    for (const [i, card] of m.entries()) {
      expect(
        card.overflow,
        `${i + 1}枚目: 出走表の横スクロール`,
      ).toBeLessThanOrEqual(1);
      expect(
        card.lastBoatRight,
        `${i + 1}枚目: 6号艇の列が枠の外`,
      ).toBeLessThanOrEqual(card.wrapRight + 0.5);
      if (card.minMotorGap !== null) {
        // 以前は 1024px で最小1.5px（「42.2%」が37pxのセルに34px）。%を小さくして2px以上にした
        expect(
          card.minMotorGap,
          `${i + 1}枚目: モーターの値の左右の余白`,
        ).toBeGreaterThanOrEqual(1.8);
      }
    }
    // 同じ段（上端がそろうカード）では、出走表の始まる高さもそろう。以前は 1024px で
    // バッジの数により見出しが1〜3段に折れ、最大67pxずれた
    const byRow = new Map();
    for (const card of m) {
      if (!byRow.has(card.rowTop)) byRow.set(card.rowTop, []);
      byRow.get(card.rowTop).push(card.tableTop);
    }
    for (const [top, tops] of byRow) {
      if (tops.length < 2) continue;
      expect(
        Math.max(...tops) - Math.min(...tops),
        `上端 ${top}px の段で出走表の高さがずれている`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

// 直前情報の展示情報カード（本番の不具合、2026-10-02）。スマホで表だけを calc(50% - 50vw) で
// 画面の端まで広げていたため、表がカードの左右の枠の外へ覆い被さり、端末によっては表が画面の
// 左端より外へ押し出されて行見出しの頭（「展示ST」→「示ST」）が切れた
for (const path of ["/race/2026-09-29-16-12", "/en/race/2026-09-29-16-12"]) {
  test.describe(`レイアウト: 直前情報の展示情報カード（${path.startsWith("/en") ? "en" : "ja"}）`, () => {
    // スマホは機種で幅が違い、320px 以下だけ別の余白の指定がある（RaceDetail.css・RaceDetailPage.css）。
    // layout-mobile（375px）のときは 320・390px も通す（PR #1135 で、#1127 を取り込む前の
    // ブランチの Preview がこの崩れのまま出た）
    test("表がカードの内側に収まり、行見出しが画面の左端で切れない", async ({
      page,
    }, testInfo) => {
      // 7つの幅でページを開き直すので、既定の 60 秒では足りないことがある
      test.slow();
      const widths =
        testInfo.project.name === "layout-mobile"
          ? [320, 375, 390, 520, 600, 700, 768]
          : [null];
      for (const width of widths) {
        if (width) await page.setViewportSize({ width, height: 812 });
        await checkBeforeInfoExhibitionCard(page, path, width);
      }
    });
  });
}

async function checkBeforeInfoExhibitionCard(page, path, width) {
  const at = width ? `${width}px: ` : "";
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page
    .locator(".race-tabs-btn")
    .filter({ hasText: /直前情報|Just Before/ })
    .first()
    .click({ timeout: 30000 });
  const table = page.locator(".rbi-card .drt-table").first();
  await expect(table).toBeVisible({ timeout: 30000 });
  const m = await table.evaluate((el) => {
    const card = el.closest(".rbi-card").getBoundingClientRect();
    const wrap = el.closest(".drt-table-wrapper").getBoundingClientRect();
    const labels = [...el.querySelectorAll(".drt-label-cell")].map(
      (c) => c.getBoundingClientRect().left,
    );
    const wrapEl = el.closest(".drt-table-wrapper");
    // 同じタブの、表を持たないカード（水面・展示タイム・進入など）
    const others = [...document.querySelectorAll(".rbi-card")]
      .filter((c) => !c.querySelector(".drt-table-wrapper") && c.offsetParent)
      .map((c) => {
        const r = c.getBoundingClientRect();
        return [r.left, r.right];
      });
    return {
      card: [card.left, card.right],
      wrap: [wrap.left, wrap.right],
      minLabelLeft: Math.min(...labels),
      vw: document.documentElement.clientWidth,
      tableOverflow: wrapEl.scrollWidth - wrapEl.clientWidth,
      tableVOverflow: wrapEl.scrollHeight - wrapEl.clientHeight,
      others,
    };
  });
  // 表（横スクロールの枠）はカードの左右の枠の内側にある
  expect(m.wrap[0], `${at}表の左端`).toBeGreaterThanOrEqual(m.card[0] - 0.5);
  expect(m.wrap[1], `${at}表の右端`).toBeLessThanOrEqual(m.card[1] + 0.5);
  // カードも画面からはみ出さない
  expect(m.card[0], `${at}カードの左端`).toBeGreaterThanOrEqual(-0.5);
  expect(m.card[1], `${at}カードの右端`).toBeLessThanOrEqual(m.vw + 0.5);
  // 行見出しの左端が画面とカードの内側にある（頭が切れない）
  expect(m.minLabelLeft, `${at}行見出し`).toBeGreaterThanOrEqual(
    Math.max(0, m.card[0]) - 0.5,
  );
  // 表の内側で縦にスクロールしない。375px で表 716px / 枠 630px と下の行（今節直線など）が
  // 内側で切れ、続きがあると気づけなかった（BOA-757）
  expect(
    m.tableVOverflow,
    `${at}展示情報の表の縦スクロール`,
  ).toBeLessThanOrEqual(1);
  if (!width) return;
  // 375〜767px: 6艇が表の横スクロール無しで入る（以前は 520px で表 531px / 表示枠 438px）。
  // 320px は対象外: 列の幅が 11px の文字の幅だけで決まり、CI（Linux のフォント）では 34px はみ出す
  // （Mac の Chromium・Preview では 312/312 で収まる）。表は横スクロールのヒント付きで読める。
  // 320px で横スクロールを無くすには列の中身を折る必要があり、仕様（FR-1 は 520・600・700px）の外
  if (width >= 375) {
    expect(
      m.tableOverflow,
      `${width}px: 展示情報の表の横スクロール`,
    ).toBeLessThanOrEqual(1);
  }
  // 767px 以下: ほかのカードは画面の左右 8px（docs/design/race-detail-ui-unify FR-1 案B）。
  // 768px は表の縦スクロールの境目を確かめるために通すだけ（BOA-757）
  if (width > 767) return;
  for (const [left, right] of m.others) {
    expect(left, `${width}px: カードの左の余白`).toBeCloseTo(8, 0);
    expect(m.vw - right, `${width}px: カードの右の余白`).toBeCloseTo(8, 0);
  }
}

// 横スクロールの手がかり（useHorizontalScrollHint）。右に残っている幅に合わせて出し方を変える
// （#1130 ファン評価で見送った P3 を共通部品で直したもの）。
// - 残り 12px 超: 「›」（押せる幅 44px 以上）と右端のフェード（.has-more）
// - 残り 1〜12px: 「›」は出さず、幅 12px の細いフェードだけ（data-hscroll-peek）
//   以前は 5px 残りでも 40px のフェードと「›」がほぼ見えている最後の列を覆い、4px 以下では何も出なかった。
//   境目を 24px にした版では、20px 残りで「›」が消えて最後の列が無いように見えた（PR #1169 ファン評価1周目）
// - 残り 1px 以下: 何も出さない
// このフックを使う画面ごとに、そのときの表示と、右端の手前 10px まで送った表示の両方を確かめる。
// 本番データの列幅ではたまたま境目を踏まないことがあるため、送る位置はテストで決める
const HSCROLL_SCREENS = [
  {
    name: "直前情報の展示情報",
    path: "/race/2026-09-29-16-12?tab=beforeInfo",
    ready: ".rbi-card .drt-table",
    // #1127 以降は 320px でも表が収まる（溢れていないときに手がかりを出さないことを確かめる）
  },
  {
    name: "今節の得点率早見",
    path: "/race/2026-09-29-16-12?tab=meet",
    ready: ".rmt-forecast-scroll table",
    mobileOnly: true,
  },
  {
    // このレースは中止で得点率早見が出ない。日別表だけを見る
    name: "今節の日別表",
    path: "/race/2026-09-21-02-05?tab=meet",
    ready: ".race-history-table-row",
    // 今節は本番 Supabase を2段で引き、表が出るまで1〜2分かかる日がある（race-detail-mobile.spec.js）。
    // 溢れるのはスマホ幅だけなので、そこだけで確かめる
    mobileOnly: true,
  },
  {
    name: "モーター情報の一覧とコース別成績",
    path: "/race/2026-09-29-16-12?tab=motor",
    ready: ".motor-ranking-row",
    // 行を押すと、そのモーターのコース別成績（MotorWakuStatsGrid）が開く
    open: async (page) => {
      // 会場内順位の列（#1153）は一覧の行が出たあとに足される。列が増える前に送ると、
      // 送ったあとに表が広がり、残りの幅が 20px・10px にならない（CI で 71px 残った）
      await expect(page.locator(".motor-venue-rank-head")).toBeVisible({
        timeout: 30000,
      });
      await checkHscrollHints(page, "モーター一覧");
      await page.locator(".motor-ranking-row").first().click();
      await expect(page.locator(".motor-waku-table")).toBeVisible({
        timeout: 30000,
      });
    },
  },
  {
    name: "枠別情報の全コース表",
    path: "/race/2026-09-29-16-12?tab=waku",
    ready: ".rwit-fold-summary",
    open: async (page) => {
      await page.locator(".rwit-fold-summary").first().click();
      await expect(page.locator(".rwit-grid-hscroll")).toBeVisible({
        timeout: 30000,
      });
    },
  },
];

test.describe("レイアウト: 横スクロールの手がかりは右に残っている幅に合わせて出す", () => {
  for (const screen of HSCROLL_SCREENS) {
    test(screen.name, async ({ page }, testInfo) => {
      test.skip(
        screen.mobileOnly && testInfo.project.name !== "layout-mobile",
        "スマホ幅でだけ溢れる画面",
      );
      test.slow();
      await page.goto(screen.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator(screen.ready).first()).toBeVisible({
        timeout: 90000,
      });
      if (screen.open) await screen.open(page);
      await checkHscrollHints(page, screen.name);
    });
  }
});

/** 画面にある .hscroll-hint を全部確かめる */
async function checkHscrollHints(page, label) {
  const hints = page.locator(".hscroll-hint");
  const count = await hints.count();
  expect(count, `${label}: 手がかりの箱`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const hint = hints.nth(i);
    if (!(await hint.isVisible())) continue;
    const at = `${label}[${i}]`;
    // そのときの表示。表がそろうまでは幅が変わるので、落ち着くまで読み直す
    await expect
      .poll(async () => hintMismatch(await readHint(hint)), {
        timeout: 15000,
        message: `${at}: そのときの表示`,
      })
      .toBe("");
    const { maxScroll } = await readHint(hint);
    if (maxScroll <= 30) continue;
    // 右端の手前 20px まで送る: まだ「›」を出す
    await readHint(hint, 20);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 残り20px` })
      .toMatchObject({
        remaining: 20,
        hasMore: true,
        moreButton: true,
        peek: null,
      });
    // 右端の手前 10px まで送る: 「›」は出さず、幅 12px の細いフェードだけ
    await readHint(hint, 10);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 残り10px` })
      .toMatchObject({
        remaining: 10,
        hasMore: false,
        moreButton: false,
        peek: "true",
        peekWidth: "12px",
      });
    // 右端まで送る: 何も出さない
    await readHint(hint, 0);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 右端` })
      .toMatchObject({ remaining: 0, hasMore: false, peek: null });
    await expectGlyphDisc(hint, ".hscroll-less", at);
    // 左端へ戻すと「›」が出る。押せる幅は 44px 以上（以前は 28px で押し損ねやすかった）
    await readHint(hint, null);
    await expect
      .poll(() => readHint(hint), { timeout: 5000, message: `${at}: 左端` })
      .toMatchObject({ hasMore: true, moreButton: true });
    expect(
      (await readHint(hint)).moreWidth,
      `${at}: 「›」の押せる幅`,
    ).toBeGreaterThanOrEqual(44);
    await expectGlyphDisc(hint, ".hscroll-more", at);
    // 押せる範囲を広げても、記号は以前と同じく端に寄せる。真ん中に置くと見出しの文字に
    // 寄って「ST›」のように続けて読めた（PR #1169 のレビュー）
    expect(
      (await readHint(hint)).moreGlyphFromRight,
      `${at}: 「›」の記号の位置`,
    ).toBeLessThanOrEqual(16);
  }
}

/**
 * 「›」「‹」の記号の後ろに面の色の円を敷いているか。左の列が固定されていない表では、記号の下を
 * 見出しの文字が流れて「枠番」の「枠」と一体に見えた（PR #1169 ファン評価1周目）
 */
async function expectGlyphDisc(hint, sel, at) {
  const bgImage = await hint.evaluate((el, s) => {
    const b = el.querySelector(`:scope > ${s}`);
    return b ? getComputedStyle(b).backgroundImage : null;
  }, sel);
  if (bgImage !== null) {
    expect(bgImage, `${at}: ${sel} の記号の下地`).toContain("radial-gradient");
  }
}

/** そのときの残りの幅に対して、出ている手がかりが合っていなければ食い違いを文で返す（合っていれば空文字） */
function hintMismatch(h) {
  // 境目の判定は丸める前の幅で行う（フックと同じ）
  const hasMore = h.remainingRaw > 12;
  const want = {
    hasMore,
    moreButton: hasMore,
    peek: !hasMore && h.remainingRaw > 1 ? "true" : null,
  };
  const got = { hasMore: h.hasMore, moreButton: h.moreButton, peek: h.peek };
  return JSON.stringify(want) === JSON.stringify(got)
    ? ""
    : `残り${h.remaining}px で ${JSON.stringify(got)}（期待 ${JSON.stringify(want)}）`;
}

/**
 * 手がかりの箱（.hscroll-hint）の状態を読む。fromEnd を渡すと先に横へ送る
 * （右端からの距離 px。null なら左端へ戻す）。
 * スクロールするのは箱そのもの（直前情報）か中の要素（モーター・今節）で、外枠にも overflow-x: auto が
 * 付いている画面がある。実際に溢れている要素を選び、どれも溢れていなければいちばん内側を使う
 */
async function readHint(hint, fromEnd) {
  return hint.evaluate((el, d) => {
    const boxes = [el, ...el.querySelectorAll("*")].filter((n) =>
      ["auto", "scroll"].includes(getComputedStyle(n).overflowX),
    );
    const box =
      boxes.find((n) => n.scrollWidth > n.clientWidth) ?? boxes.at(-1);
    if (d !== undefined) {
      box.scrollLeft = d === null ? 0 : box.scrollWidth - box.clientWidth - d;
    }
    const more = el.querySelector(":scope > .hscroll-more");
    return {
      remaining: Math.round(box.scrollWidth - box.clientWidth - box.scrollLeft),
      remainingRaw: box.scrollWidth - box.clientWidth - box.scrollLeft,
      maxScroll: box.scrollWidth - box.clientWidth,
      hasMore: el.classList.contains("has-more"),
      moreButton: Boolean(more),
      moreWidth: more ? more.getBoundingClientRect().width : 0,
      // 「›」の記号の中心から箱の右端までの距離
      moreGlyphFromRight: more
        ? (() => {
            const range = document.createRange();
            range.selectNodeContents(more);
            const g = range.getBoundingClientRect();
            return more.getBoundingClientRect().right - (g.left + g.right) / 2;
          })()
        : null,
      peek: el.dataset.hscrollPeek ?? null,
      peekWidth: el.style.getPropertyValue("--hscroll-peek-width") || null,
    };
  }, fromEnd);
}

// PC幅で、1行に名前と数値を並べるリストが 1200px の箱の両端に離れない（BOA-619 項目3）。
// 1440px で、展開予測の決まり手と確率が約1000px、払戻金の券種と金額も約1000px離れていた
test.describe("レイアウト: PC幅で名前と数値を離しすぎない（BOA-619）", () => {
  const RACE = "/race/2026-09-29-16-12"; // 児島12R（確定済み）

  // 指定は 1025px から効く。箱が 1200px で止まる前の帯（1025〜1279px）も通すため、
  // layout-desktop のときは 1100px でも確かめる
  const widthsFor = (testInfo) => {
    if (testInfo.project.name === "layout-desktop") return [1100, 1440];
    if (testInfo.project.name === "layout-wide") return [1920];
    return [];
  };

  test("AI予想の振り返り: 決まり手と確率が近く、ページの中央に置く", async ({
    page,
  }, testInfo) => {
    const widths = widthsFor(testInfo);
    test.skip(widths.length === 0, "PC幅（1025px以上）だけの指定");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=aiPrediction`, {
        waitUntil: "domcontentloaded",
      });
      const row = page.locator(".turn-pattern-row").first();
      await expect(row).toBeVisible({ timeout: 30000 });
      const m = await row.evaluate((el) => {
        const r = (q) => el.querySelector(q).getBoundingClientRect();
        const tab = el
          .closest(".race-ai-prediction-tab")
          .getBoundingClientRect();
        const box = el.closest(".race-tabs-panel").getBoundingClientRect();
        return {
          gap: r(".turn-pattern-prob").left - r(".turn-pattern-technique").left,
          tabCenter: (tab.left + tab.right) / 2,
          boxCenter: (box.left + box.right) / 2,
        };
      });
      expect(
        m.gap,
        `${width}px: 決まり手の左端から確率の左端まで`,
      ).toBeLessThanOrEqual(700);
      expect(
        Math.abs(m.tabCenter - m.boxCenter),
        `${width}px: 振り返りの中心`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("結果の払戻金: 券種と金額が近い", async ({ page }, testInfo) => {
    const widths = widthsFor(testInfo);
    test.skip(widths.length === 0, "PC幅（1025px以上）だけの指定");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${RACE}?tab=result`, { waitUntil: "domcontentloaded" });
      const row = page.locator(".rr-payout-row").first();
      await expect(row).toBeVisible({ timeout: 30000 });
      const gap = await row.evaluate(
        (el) =>
          el.querySelector(".rr-amount").getBoundingClientRect().right -
          el.querySelector(".rr-payout-type").getBoundingClientRect().left,
      );
      expect(
        gap,
        `${width}px: 券種の左端から金額の右端まで`,
      ).toBeLessThanOrEqual(640);
    }
  });

  // 今節タブの得点率早見。箱の幅いっぱいに広がり、余りが全部選手名の列に入って、
  // 1440px で選手名の列が 853px、1024px でも 672px あった（BOA-736）。指定は 769px から効く
  // 今節タブの比較表（6艇の今節）。1440px で表が 1174px に広がり、選手名と得点率・節内順位・
  // 前検の間が約800px 離れた（BOA-755）。得点率早見（BOA-736）と同じ 769px〜・640px。
  // 最終日（予選の着順が8走並ぶ）でもセルの中身がはみ出さないことを見る
  test("今節の比較表: 選手名と得点率・順位・前検の列が近く、中身がはみ出さない", async ({
    page,
  }, testInfo) => {
    const widths =
      testInfo.project.name === "layout-desktop"
        ? [900, 1100, 1440]
        : testInfo.project.name === "layout-wide"
          ? [1920]
          : [];
    test.skip(widths.length === 0, "769px 以上だけの指定");
    for (const race of ["2026-09-23-09-12", "2026-09-28-09-11"]) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/race/${race}?tab=meet`, {
          waitUntil: "domcontentloaded",
        });
        await expect(page.locator(".rmt-compare tbody tr")).toHaveCount(6, {
          timeout: 30000,
        });
        const m = await page.evaluate(() => {
          const t = document.querySelector(".rmt-compare");
          return {
            table: t.getBoundingClientRect().width,
            overflow: [...t.querySelectorAll("th, td")].filter(
              (el) => el.scrollWidth > el.clientWidth + 1,
            ).length,
          };
        });
        expect(m.table, `${race} ${width}px: 表の幅`).toBeLessThanOrEqual(640);
        expect(m.overflow, `${race} ${width}px: はみ出したセル`).toBe(0);
      }
    }
  });

  test("今節の得点率早見: 選手名と得点率・着順の列が近い", async ({
    page,
  }, testInfo) => {
    const widths =
      testInfo.project.name === "layout-desktop"
        ? [900, 1100, 1440]
        : testInfo.project.name === "layout-wide"
          ? [1920]
          : [];
    test.skip(widths.length === 0, "769px 以上だけの指定");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/race/2026-09-23-09-12?tab=meet", {
        waitUntil: "domcontentloaded",
      });
      const head = page.locator(".rmt-forecast-table thead th").first();
      await expect(head).toBeVisible({ timeout: 30000 });
      const m = await page.evaluate(() => ({
        name: document
          .querySelector(".rmt-forecast-table thead th")
          .getBoundingClientRect().width,
        table: document
          .querySelector(".rmt-forecast-table")
          .getBoundingClientRect().width,
      }));
      expect(m.table, `${width}px: 表の幅`).toBeLessThanOrEqual(640);
      expect(m.name, `${width}px: 選手名の列の幅`).toBeLessThanOrEqual(400);
    }
  });
});
