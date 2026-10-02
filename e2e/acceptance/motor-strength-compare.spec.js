// 受け入れE2E: モーターの強さをひと目で比べる（BOA-428）
// 入力は docs/design/motor-strength-compare/spec.md・screens.md のみ（plan/tasks/src は読んでいない）。
// 子1 = レース詳細「モータ情報」タブの6艇表、子3 = 分析ツール「モーターランキング」タブ。
import { test, expect } from "../fixtures.js";

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const RANK_TEXT = /(\d+)位(タイ)?\/(\d+)/;
const NOTE_SKILL = "モーターの2連率には、乗った選手の実力も混ざります";
const NOTE_RANK_SOURCE =
  /会場内順位は、\s*(.+?)\s*公式サイトのモーター成績（取得日\s*([^）]+)）の2連率で数えた順位です/;
const SOURCE_VENUE_SITE =
  /出典:\s*(.+?)\s*公式サイトのモーター成績（取得日\s*([^）]+)）/;
const SOURCE_PRETEST_ONLY =
  "BOATRACE 公式の前検データ（直近の節で使われたモーターのみ）";
const USER_HEADER = /^(今節使用者|直近の節の使用者（.+）)/;

// 会場コードは BOATRACE 公式の場コード（spec に URL パラメータ venue_code の記載あり）。
// 会場ランキングは会場単位の画面で、会場を指定しないと「データの無い会場」等の条件を作れないため固定値を使う。
const VENUE_KOJIMA = "16";
const VENUE_TODA = "02";
const VENUE_HEIWAJIMA = "04";
const VENUE_HAMANAKO = "06";
const VENUE_MIYAJIMA = "17";
// spec「浜名湖・宮島の扱い」: 会場サイトの値を出さない会場（戸田・平和島はデータが無い、浜名湖・宮島は出さない）
const NO_VENUE_SITE_VENUES = [
  ["戸田", VENUE_TODA],
  ["平和島", VENUE_HEIWAJIMA],
  ["浜名湖", VENUE_HAMANAKO],
  ["宮島", VENUE_MIYAJIMA],
];

const num = (s) => {
  const m = (s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const isDash = (s) => /^[-−–ー]$/.test((s ?? "").trim());

/** 競技順位（1, 2, 2, 4）。better(a, b) が true なら a が上位。値の無い行は null を返す */
const competitionRanks = (values, better) =>
  values.map((v) =>
    v === null
      ? null
      : 1 + values.filter((o) => o !== null && better(o, v)).length,
  );

/** テーブルの見出しとデータ行のセル文字列を読む（見出しの並び = セルの並び、と仮定） */
async function readTable(table) {
  const headers = (await table.getByRole("columnheader").allInnerTexts()).map(
    (t) => t.trim(),
  );
  const rowLocators = await table.getByRole("row").all();
  const rows = [];
  for (const row of rowLocators) {
    const cellLoc = row.getByRole("cell").or(row.getByRole("rowheader"));
    const cells = (await cellLoc.allInnerTexts()).map((t) => t.trim());
    if (cells.length === 0) continue; // 見出し行
    rows.push({ row, cells, cell: (i) => cellLoc.nth(i) });
  }
  return { headers, rows };
}

const colIndex = (headers, re) => {
  const i = headers.findIndex((h) => re.test(h));
  expect(
    i,
    `列見出し ${re} が見つからない（見出し: ${headers.join(" | ")}）`,
  ).toBeGreaterThanOrEqual(0);
  return i;
};

/** セルの中の横棒（塗り）と、その外枠（トラック）の幅。構造を前提にせず、背景を持つ文字の無い最内要素を塗りとみなす */
async function measureBar(cell) {
  return cell.evaluate((el) => {
    const hasBg = (e) => {
      const cs = getComputedStyle(e);
      const c = cs.backgroundColor;
      return (
        (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") ||
        cs.backgroundImage !== "none"
      );
    };
    const all = [...el.querySelectorAll("*")].filter(
      (e) => hasBg(e) && e.getBoundingClientRect().height > 0,
    );
    const leaves = all.filter(
      (e) => !all.some((o) => o !== e && e.contains(o)),
    );
    const fill = leaves.find((e) => !e.textContent.trim()) ?? null;
    if (!fill) return null;
    const track =
      all.filter((o) => o !== fill && o.contains(fill)).pop() ?? null;
    return {
      fill: fill.getBoundingClientRect().width,
      track: track ? track.getBoundingClientRect().width : null,
    };
  });
}

const fontWeightOf = (loc) =>
  loc.evaluate((e) => Number(getComputedStyle(e).fontWeight) || 400);

/** 値ラベル自身か、セル内の祖先に枠（border / outline / box-shadow）があるか */
const hasFrame = (loc) =>
  loc.evaluate((e) => {
    const cell =
      e.closest("td, th, [role=cell], [role=gridcell]") ?? e.parentElement;
    for (let n = e; n && n !== cell?.parentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const border = ["Top", "Right", "Bottom", "Left"].some(
        (s) =>
          parseFloat(cs[`border${s}Width`]) > 0 &&
          cs[`border${s}Style`] !== "none",
      );
      const outline =
        parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none";
      if (border || outline || cs.boxShadow !== "none") return true;
      if (n === cell) break;
    }
    return false;
  });

async function pageHasNoHorizontalScroll(page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, "ページ全体に横スクロールが出ている").toBeLessThanOrEqual(cw + 1);
}

// ---------------------------------------------------------------------------
// 子1: レース詳細「モータ情報」タブ
// ---------------------------------------------------------------------------

const sixTable = (page) =>
  page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: /会場内順位/ }) })
    .first();

const motorInfoTab = (page) =>
  page
    .getByRole("tab", { name: "モータ情報" })
    .or(page.getByRole("button", { name: "モータ情報" }))
    .or(page.getByRole("link", { name: "モータ情報" }))
    .first();

/** トップから /race/:raceId へ辿る（レースIDを固定しないため。本番データで変わる） */
async function findRaceHrefs(page) {
  await page.goto("/");
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const hrefs = await page
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const races = [...new Set(hrefs.filter((h) => /^\/race\/[^/?#]+/.test(h)))];
    if (races.length > 0) return races;
    await page.waitForTimeout(500);
  }
  return [];
}

async function openSixTable(page, href) {
  await page.goto(href);
  await expect(page).toHaveURL(/\/race\//);
  await motorInfoTab(page).click();
  const table = sixTable(page);
  await expect(table).toBeVisible();
  return table;
}

/**
 * 会場内順位の列が出るレース（会場サイトの値を出す会場）を、トップのリンクから探す。
 * 戸田・平和島・浜名湖・宮島のレースは列が畳まれる（spec）ので、そのレースは飛ばして次を試す。
 */
async function findVenueSiteRaceHref(page) {
  const hrefs = await findRaceHrefs(page);
  for (const href of hrefs.slice(0, 8)) {
    await page.goto(href);
    await motorInfoTab(page).click();
    const table = page
      .getByRole("table")
      .filter({
        has: page.getByRole("columnheader", { name: /公式2連率（節時点）/ }),
      })
      .first();
    await expect(table).toBeVisible();
    if ((await table.getByRole("columnheader", { name: /会場内順位/ }).count()) > 0) return href;
  }
  return null;
}

async function openAnyRaceSixTable(page) {
  const href = await findVenueSiteRaceHref(page);
  test.skip(
    !href,
    "トップページから、会場サイトの値を出す会場のレース詳細へ辿れない（開催の無い時間帯など）",
  );
  return openSixTable(page, href);
}

test.describe("子1 レース詳細「モータ情報」タブの6艇表", () => {
  test("[spec FR-1 / screens 子1] 公式2連率（節時点）と会場内順位の列があり、会場内順位は公式2連率のすぐ右", async ({
    page,
  }) => {
    const table = await openAnyRaceSixTable(page);
    const { headers } = await readTable(table);
    const rateIdx = colIndex(headers, /公式2連率（節時点）/);
    const rankIdx = colIndex(headers, /会場内順位/);
    expect(rankIdx).toBe(rateIdx + 1);
  });

  test("[spec FR-1] 出走する6基が並び、各行に「◯位/◯」または「◯位タイ/◯」の会場内順位が付く", async ({
    page,
  }) => {
    const table = await openAnyRaceSixTable(page);
    const { headers, rows } = await readTable(table);
    const rankIdx = colIndex(headers, /会場内順位/);
    expect(rows).toHaveLength(6);
    const denominators = rows.map((r) => {
      const m = r.cells[rankIdx].match(RANK_TEXT);
      expect(
        m,
        `会場内順位の表記が「20位/60」「17位タイ/60」の形でない: ${r.cells[rankIdx]}`,
      ).not.toBeNull();
      const rank = Number(m[1]);
      const total = Number(m[3]);
      expect(rank).toBeGreaterThanOrEqual(1);
      expect(rank).toBeLessThanOrEqual(total);
      return total;
    });
    // 同じ会場の同じスナップショットで数えるので、分母（◯機中）は6行で同じ
    expect(new Set(denominators).size).toBe(1);
  });

  test("[spec FR-1 受入基準] バーの長さの比が値の比と一致し、最大の行が全長になる", async ({
    page,
  }) => {
    const table = await openAnyRaceSixTable(page);
    const { headers, rows } = await readTable(table);
    const rateIdx = colIndex(headers, /公式2連率（節時点）/);
    const values = rows.map((r) => num(r.cells[rateIdx]));
    test.skip(
      values.every((v) => v === null || v === 0),
      "公式2連率が6基とも無い（出走表の値が未取得）",
    );
    const max = Math.max(...values.filter((v) => v !== null));
    const bars = [];
    for (const r of rows) {
      const bar = await measureBar(r.cell(rateIdx));
      expect(bar, "公式2連率のセルに横棒が見つからない").not.toBeNull();
      bars.push(bar);
    }
    const maxFill = Math.max(...bars.map((b) => b.fill));
    expect(maxFill).toBeGreaterThan(0);
    bars.forEach((b, i) => {
      if (values[i] === null) return;
      expect(
        Math.abs(b.fill / maxFill - values[i] / max),
        `行${i + 1}の棒の比が値の比と合わない`,
      ).toBeLessThanOrEqual(0.03);
      if (values[i] === max && b.track !== null) {
        expect(
          Math.abs(b.fill - b.track),
          "最大の値の棒が全長になっていない",
        ).toBeLessThanOrEqual(2);
      }
    });
  });

  test("[spec モック確認の決定] 6基で最大の公式2連率の値ラベルだけが金枠＋太字（同じ値の最大は全部）", async ({
    page,
  }) => {
    const table = await openAnyRaceSixTable(page);
    const { headers, rows } = await readTable(table);
    const rateIdx = colIndex(headers, /公式2連率（節時点）/);
    const values = rows.map((r) => num(r.cells[rateIdx]));
    test.skip(
      values.every((v) => v === null),
      "公式2連率が6基とも無い",
    );
    const max = Math.max(...values.filter((v) => v !== null));
    for (const [i, r] of rows.entries()) {
      if (values[i] === null) continue;
      const label = r
        .cell(rateIdx)
        .getByText(/\d+(?:\.\d+)?\s*%/)
        .first();
      const weight = await fontWeightOf(label);
      const framed = await hasFrame(label);
      if (values[i] === max) {
        expect(
          weight,
          `最大値（行${i + 1}）が太字でない`,
        ).toBeGreaterThanOrEqual(600);
        expect(framed, `最大値（行${i + 1}）に枠が無い`).toBe(true);
      } else {
        expect(
          weight,
          `最大でない値（行${i + 1}）が太字になっている`,
        ).toBeLessThan(600);
      }
    }
  });

  test("[spec モック確認の決定] 2連率・会場内順位は差の値ではないので ↑↓・＋− を付けない", async ({
    page,
  }) => {
    const table = await openAnyRaceSixTable(page);
    const { headers, rows } = await readTable(table);
    const rateIdx = colIndex(headers, /公式2連率（節時点）/);
    const rankIdx = colIndex(headers, /会場内順位/);
    for (const r of rows) {
      expect(r.cells[rateIdx]).not.toMatch(/[↑↓＋+]|[−]\d/);
      expect(r.cells[rankIdx]).not.toMatch(/[↑↓＋+−]/);
    }
  });

  test("[spec 設計レビューの決定 / 制約] 表の下に会場内順位の出どころ（取得日）と、選手の実力が混ざる旨の注記を出す", async ({
    page,
  }) => {
    await openAnyRaceSixTable(page);
    await expect(page.getByText(NOTE_RANK_SOURCE)).toBeVisible();
    await expect(page.getByText(NOTE_SKILL).first()).toBeVisible();
  });

  test("[spec FR-1 受入基準] 375px で6基のバーと順位が横スクロールなしで見える", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const table = await openAnyRaceSixTable(page);
    await pageHasNoHorizontalScroll(page);
    const { headers, rows } = await readTable(table);
    const rateIdx = colIndex(headers, /公式2連率（節時点）/);
    const rankIdx = colIndex(headers, /会場内順位/);
    for (const r of rows) {
      for (const idx of [rateIdx, rankIdx]) {
        const box = await r.cell(idx).boundingBox();
        expect(box, "セルが描画されていない").not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(
          box.x + box.width,
          "初期表示で横スクロールしないと見えない",
        ).toBeLessThanOrEqual(376);
      }
    }
  });

  test("[spec 設計レビューの決定 取得の失敗・取得失敗の表示] 会場サイトの値が取れないときは順位の列を残し、各セルに「取得できませんでした」と出す", async ({
    page,
  }) => {
    // 会場サイトの値を出す会場のレースを先に決めてから、取得を失敗させる
    const href = await findVenueSiteRaceHref(page);
    test.skip(
      !href,
      "トップページから、会場サイトの値を出す会場のレース詳細へ辿れない（開催の無い時間帯など）",
    );
    let intercepted = false;
    // spec に書かれた会場公式サイトの値の保存先。取得経路が別名なら intercepted が立たず skip になる
    await page.route(/\/rest\/v1\/[^?]*venue_motor_stats/, (route) => {
      intercepted = true;
      return route.abort();
    });
    await page.goto(href);
    await motorInfoTab(page).click();
    const table = page
      .getByRole("table")
      .filter({
        has: page.getByRole("columnheader", { name: /公式2連率（節時点）/ }),
      })
      .first();
    await expect(table).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => {});
    test.skip(
      !intercepted,
      "会場サイトの値の取得が venue_motor_stats を直接読む経路ではなかった",
    );
    await expect(
      table.getByRole("columnheader", { name: /会場内順位/ }),
    ).toBeVisible();
    await expect(table.getByText(RANK_TEXT)).toHaveCount(0);
    const { headers, rows } = await readTable(table);
    const rankIdx = colIndex(headers, /会場内順位/);
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.cells[rankIdx]).toBe("取得できませんでした");
    }
  });

  for (const [venueName, code] of NO_VENUE_SITE_VENUES) {
    test(`[spec 設計レビューの決定・浜名湖・宮島の扱い] 会場サイトの値を出さない会場（${venueName}）のレースでは会場内順位の列を出さない`, async ({
      page,
    }) => {
      // 導線: 会場ランキング（前検データの一覧）→ 今節使われたモーターの機番リンクの race_id → レース詳細
      await page.goto(`/winning-technique?tab=motorranking&venue_code=${code}`);
      await expect(page.getByText(SOURCE_PRETEST_ONLY)).toBeVisible();
      const ranking = rankingTable(page);
      const hasRows = await ranking
        .getByRole("row")
        .nth(1)
        .isVisible()
        .catch(() => false);
      test.skip(!hasRows, `${venueName} の直近の節の前検データが無く、レースへ辿れない`);
      const { idx, rows } = await readRanking(ranking);
      const used = rows.find((r) => !isDash(r.user) && r.user !== "");
      test.skip(!used, `${venueName} に今節使用者のいるモーターが無く、レースへ辿れない`);
      await used.cell(idx.no).getByRole("link").first().click();
      await expect(page).toHaveURL(/race_id=[^&]+/);
      const raceId = new URL(page.url()).searchParams.get("race_id");

      await page.goto(`/race/${raceId}`);
      await motorInfoTab(page).click();
      const table = page
        .getByRole("table")
        .filter({
          has: page.getByRole("columnheader", { name: /公式2連率（節時点）/ }),
        })
        .first();
      await expect(table).toBeVisible();
      await expect(
        table.getByRole("columnheader", { name: /会場内順位/ }),
      ).toHaveCount(0);
      await expect(table.getByText(RANK_TEXT)).toHaveCount(0);
      await expect(page.getByText(NOTE_RANK_SOURCE)).toHaveCount(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 子3: 分析ツール「モーターランキング」タブ
// ---------------------------------------------------------------------------

const rankingTable = (page) =>
  page
    .getByRole("table")
    .filter({ has: page.getByRole("columnheader", { name: /^機番/ }) })
    .filter({ has: page.getByRole("columnheader", { name: /^優出/ }) })
    .first();

async function openRanking(page, venueCode) {
  const q = venueCode ? `&venue_code=${venueCode}` : "";
  await page.goto(`/winning-technique?tab=motorranking${q}`);
  const table = rankingTable(page);
  await expect(table).toBeVisible();
  await expect(table.getByRole("row").nth(1)).toBeVisible();
  return table;
}

const header = (table, re) =>
  table.getByRole("columnheader", { name: re }).first();

/** ランキング表を読み、各列の値を取り出す */
async function readRanking(table) {
  const t = await readTable(table);
  const idx = {
    rank: colIndex(t.headers, /^順位/),
    no: colIndex(t.headers, /^機番/),
    rate: colIndex(t.headers, /2連率/),
    final: colIndex(t.headers, /^優出/),
    win: colIndex(t.headers, /^優勝/),
    pretest: colIndex(t.headers, /^前検/),
    user: colIndex(t.headers, USER_HEADER),
  };
  const rows = t.rows.map((r) => ({
    ...r,
    rank: num(r.cells[idx.rank]),
    rankText: r.cells[idx.rank],
    no: num(r.cells[idx.no]),
    rate: isDash(r.cells[idx.rate]) ? null : num(r.cells[idx.rate]),
    win: isDash(r.cells[idx.win]) ? null : num(r.cells[idx.win]),
    pretest: isDash(r.cells[idx.pretest]) ? null : num(r.cells[idx.pretest]),
    user: r.cells[idx.user],
  }));
  return { headers: t.headers, idx, rows };
}

/** 値の並び（nulls は末尾）と順位の付け方（1, 2, 2, 4）を確かめる */
function expectSortedWithCompetitionRank(rows, key, dir) {
  const values = rows.map((r) => r[key]);
  const firstNull = values.findIndex((v) => v === null);
  if (firstNull >= 0) {
    expect(
      values.slice(firstNull).every((v) => v === null),
      `${key}: 値の無い行が末尾にそろっていない`,
    ).toBe(true);
  }
  const present = values.filter((v) => v !== null);
  for (let i = 1; i < present.length; i += 1) {
    if (dir === "desc")
      expect(present[i], `${key} が降順でない`).toBeLessThanOrEqual(
        present[i - 1],
      );
    else
      expect(present[i], `${key} が昇順でない`).toBeGreaterThanOrEqual(
        present[i - 1],
      );
  }
  const better = dir === "desc" ? (a, b) => a > b : (a, b) => a < b;
  const expected = competitionRanks(values, better);
  rows.forEach((r, i) => {
    if (expected[i] === null) {
      expect(isDash(r.rankText), `${key} の値が無い行（機番 ${r.no}）の順位が「-」でない`).toBe(true);
      return;
    }
    expect(r.rank, `${key} で並べたときの順位（機番 ${r.no}）`).toBe(
      expected[i],
    );
  });
}

test.describe("子3 分析ツール「モーターランキング」タブ", () => {
  test("[spec FR-3 / screens 影響する画面] 分析ツールに「モーターランキング」タブがあり、tab=motorranking で開く", async ({
    page,
  }) => {
    await page.goto("/winning-technique");
    const tab = page
      .getByRole("tab", { name: "モーターランキング" })
      .or(page.getByRole("button", { name: "モーターランキング" }))
      .or(page.getByRole("link", { name: "モーターランキング" }))
      .first();
    await tab.click();
    await expect(page).toHaveURL(/tab=motorranking/);
    await expect(rankingTable(page)).toBeVisible();
  });

  test("[spec FR-3 列] 順位・機番・2連率・優出・優勝・前検・今節使用者の7列がこの順に並ぶ", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { idx } = await readRanking(table);
    const order = [
      idx.rank,
      idx.no,
      idx.rate,
      idx.final,
      idx.win,
      idx.pretest,
      idx.user,
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("[spec FR-3 受入基準 / 設計レビューの決定] 表の上に出典と「取得日」を出す（会場サイトのある会場）", async ({
    page,
  }) => {
    await openRanking(page, VENUE_KOJIMA);
    const source = page.getByText(SOURCE_VENUE_SITE).first();
    await expect(source).toBeVisible();
    await expect(source).toContainText("児島");
    await expect(source).toContainText("取得日");
    await expect(page.getByText(SOURCE_PRETEST_ONLY)).toHaveCount(0);
    // 出典は表の上
    const sBox = await source.boundingBox();
    const tBox = await rankingTable(page).boundingBox();
    expect(sBox.y).toBeLessThan(tBox.y);
  });

  test("[spec FR-3 / screens 子3] 表の下に、選手の実力が混ざる旨の注記を出す", async ({
    page,
  }) => {
    await openRanking(page, VENUE_KOJIMA);
    await expect(page.getByText(NOTE_SKILL).first()).toBeVisible();
  });

  test("[spec 設計レビューの決定 初期の会場] URL の venue_code の会場を表示する", async ({
    page,
  }) => {
    await openRanking(page, VENUE_KOJIMA);
    await expect(page).toHaveURL(new RegExp(`venue_code=${VENUE_KOJIMA}`));
    await expect(page.getByText(SOURCE_VENUE_SITE).first()).toContainText(
      "児島",
    );
  });

  test("[spec 既定値 初期の並び] 初期表示は2連率の降順で、同じ値は同じ順位・次の順位が飛ぶ（1, 2, 2, 4）", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { rows } = await readRanking(table);
    expect(rows.length).toBeGreaterThan(6);
    expectSortedWithCompetitionRank(rows, "rate", "desc");
  });

  test("[spec 設計レビューの決定 並べ替え] 機番の見出しで昇順。順位の列は2連率の順位のまま", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    await header(table, /^機番/).click();
    await expect
      .poll(async () => {
        const nos = (await readRanking(table)).rows.map((r) => r.no);
        return nos.every((n, i) => i === 0 || n >= nos[i - 1]);
      })
      .toBe(true);
    const { rows } = await readRanking(table);
    const nos = rows.map((r) => r.no);
    expect(nos).toEqual([...nos].sort((a, b) => a - b));
    const expected = competitionRanks(
      rows.map((r) => r.rate),
      (a, b) => a > b,
    );
    rows.forEach((r, i) => {
      if (expected[i] === null)
        expect(isDash(r.rankText), `2連率の無い機番 ${r.no} の順位が「-」でない`).toBe(true);
      else
        expect(r.rank, `機番 ${r.no} の順位が2連率の順位でない`).toBe(
          expected[i],
        );
    });
  });

  test("[spec 設計レビューの決定 並べ替え] 優勝の見出しで降順、値の無い行は末尾、順位は優勝で付け直す", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    await header(table, /^優勝/).click();
    const { rows } = await readRanking(table);
    expectSortedWithCompetitionRank(rows, "win", "desc");
  });

  test("[spec 設計レビューの決定 並べ替え] 前検の見出しで昇順（速い順）、値の無い行は末尾、順位は前検で付け直す", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    await header(table, /^前検/).click();
    const { rows } = await readRanking(table);
    test.skip(
      rows.every((r) => r.pretest === null),
      "前検タイムが1件も無い会場・日",
    );
    expectSortedWithCompetitionRank(rows, "pretest", "asc");
  });

  test("[spec 設計レビューの決定 並べ替え] 同じ見出しをもう一度押しても向きは変わらない", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    await header(table, /^機番/).click();
    await header(table, /2連率/).click();
    const first = (await readRanking(table)).rows.map((r) => r.rate);
    await header(table, /2連率/).click();
    const second = (await readRanking(table)).rows.map((r) => r.rate);
    expect(second).toEqual(first);
    expectSortedWithCompetitionRank(
      (await readRanking(table)).rows,
      "rate",
      "desc",
    );

    await header(table, /^前検/).click();
    const p1 = (await readRanking(table)).rows.map((r) => r.pretest);
    await header(table, /^前検/).click();
    const p2 = (await readRanking(table)).rows.map((r) => r.pretest);
    expect(p2).toEqual(p1);
  });

  test("[spec モック確認の決定] 2連率が1位の値ラベルだけが金枠＋太字（同率1位は全部）", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { idx, rows } = await readRanking(table);
    const max = Math.max(...rows.map((r) => r.rate).filter((v) => v !== null));
    for (const r of rows) {
      if (r.rate === null) continue;
      const label = r
        .cell(idx.rate)
        .getByText(/\d+(?:\.\d+)?/)
        .first();
      const weight = await fontWeightOf(label);
      if (r.rate === max) {
        expect(
          weight,
          `2連率1位（機番 ${r.no}）が太字でない`,
        ).toBeGreaterThanOrEqual(600);
        expect(
          await hasFrame(label),
          `2連率1位（機番 ${r.no}）に枠が無い`,
        ).toBe(true);
      } else {
        expect(weight, `2連率1位でない機番 ${r.no} が太字`).toBeLessThan(600);
      }
    }
  });

  test("[spec 既定値 前検・使用者 / screens 子3] 使用者の列見出しは「今節使用者」か「直近の節の使用者（日付）」", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    await expect(
      table.getByRole("columnheader", { name: USER_HEADER }),
    ).toHaveCount(1);
  });

  test("[spec FR-3 / 既定値] 今節使われていないモーターは前検・使用者が「-」で、機番はリンクにしない", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { idx, rows } = await readRanking(table);
    const unused = rows.filter((r) => isDash(r.user));
    test.skip(
      unused.length === 0,
      "この会場は今節すべてのモーターが使われている",
    );
    for (const r of unused) {
      expect(
        isDash(r.cells[idx.pretest]),
        `機番 ${r.no}: 使用者が「-」なのに前検に値がある`,
      ).toBe(true);
      await expect(r.cell(idx.no).getByRole("link")).toHaveCount(0);
    }
  });

  test('[spec FR-3 / 制約] 今節使用者の名前は選手ページへのリンクで、translate="no"', async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { idx, rows } = await readRanking(table);
    const used = rows.find((r) => !isDash(r.user) && r.user !== "");
    test.skip(!used, "この会場に今節使用者のいるモーターが無い");
    const link = used.cell(idx.user).getByRole("link").first();
    await expect(link).toBeVisible();
    const noTranslate = await link.evaluate(
      (e) => e.closest('[translate="no"]') !== null,
    );
    expect(noTranslate, '選手名に translate="no" が無い').toBe(true);
    await link.click();
    await expect(page).not.toHaveURL(/\/winning-technique/);
  });

  test("[spec 設計レビューの決定 機番リンク] 今節使われたモーターの機番は、tab=motor・venue_code・race_id・motor=機番 のドリルダウンへ移り、そのモーター1基のドリルダウンが開く", async ({
    page,
  }) => {
    const table = await openRanking(page, VENUE_KOJIMA);
    const { idx, rows } = await readRanking(table);
    const used = rows.find((r) => !isDash(r.user) && r.user !== "");
    test.skip(!used, "この会場に今節使用者のいるモーターが無い");
    await used.cell(idx.no).getByRole("link").first().click();
    await expect(page).toHaveURL(/tab=motor(?!ranking)/);
    await expect(page).toHaveURL(new RegExp(`venue_code=${VENUE_KOJIMA}`));
    await expect(page).toHaveURL(/race_id=[^&]+/);
    await expect(page).toHaveURL(new RegExp(`motor=${used.no}(?:&|$)`));
    // spec 背景: 既存のドリルダウンは「1基単位」の表示。spec「機番リンク」: ?motor= は選択中のレースの
    // 6艇にいるときだけ開く。リンク先で開けたかを次の3点で確かめる（6艇表が出ることは期待しない）。
    // 1. そのモーターの機番を名前に含む見出しが出る（1基のドリルダウン）。
    //    spec・screens にドリルダウンの文言は無いため、見出しの名前は機番の数字だけで幅を持たせる
    await expect(
      page
        .getByRole("heading", { name: new RegExp(`(?<!\\d)${used.no}(?!\\d)`) })
        .first(),
    ).toBeVisible();
    // 2. 表示が出たあとも motor=機番 が URL に残る（開けなかった指定として捨てられていない）
    await expect(page).toHaveURL(new RegExp(`motor=${used.no}(?:&|$)`));
    // 3. ランキングの表（列「今節使用者」）からは離れている
    await expect(
      page.getByRole("columnheader", { name: USER_HEADER }),
    ).toHaveCount(0);
  });

  test("[spec 既定値 データの無い会場・浜名湖・宮島の扱い] 戸田・平和島・浜名湖・宮島は出典を前検データに替え、優出・優勝は「-」", async ({
    page,
  }) => {
    for (const [, code] of NO_VENUE_SITE_VENUES) {
      await page.goto(`/winning-technique?tab=motorranking&venue_code=${code}`);
      await expect(page.getByText(SOURCE_PRETEST_ONLY)).toBeVisible();
      await expect(page.getByText(SOURCE_VENUE_SITE)).toHaveCount(0);
      const table = rankingTable(page);
      const hasRows = await table
        .getByRole("row")
        .nth(1)
        .isVisible()
        .catch(() => false);
      if (!hasRows) continue; // 直近の節の前検データが無い場合は表の中身を確かめられない
      const { idx, rows } = await readRanking(table);
      for (const r of rows) {
        expect(
          isDash(r.cells[idx.final]),
          `会場 ${code} 機番 ${r.no}: 優出が「-」でない`,
        ).toBe(true);
        expect(
          isDash(r.cells[idx.win]),
          `会場 ${code} 機番 ${r.no}: 優勝が「-」でない`,
        ).toBe(true);
        // 直近の節で使われたモーターのみ
        expect(
          isDash(r.user),
          `会場 ${code} 機番 ${r.no}: 使われていないモーターが並んでいる`,
        ).toBe(false);
      }
    }
  });

  test("[spec FR-3 受入基準 / 既定値 モバイル] 375px でページ全体に横スクロールが出ず、順位・機番・2連率が最初の画面に入る", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const table = await openRanking(page, VENUE_KOJIMA);
    await pageHasNoHorizontalScroll(page);
    for (const re of [/^順位/, /^機番/, /2連率/]) {
      const box = await header(table, re).boundingBox();
      expect(box).not.toBeNull();
      expect(
        box.x + box.width,
        `${re} の見出しが初期表示の画面外`,
      ).toBeLessThanOrEqual(376);
    }
    // 全列は表の中の横スクロールで見られる
    await header(table, USER_HEADER).scrollIntoViewIfNeeded();
    await expect(header(table, USER_HEADER)).toBeInViewport();
    await pageHasNoHorizontalScroll(page);
  });

  test("[spec 設計レビューの決定 取得の失敗・取得失敗の表示] 会場サイトの値が取れないときは、表の代わりに alert で「モーター成績を取得できませんでした」と出す", async ({
    page,
  }) => {
    let intercepted = false;
    // spec に書かれた会場公式サイトの値の保存先。取得経路が別名なら intercepted が立たず skip になる
    await page.route(/\/rest\/v1\/[^?]*venue_motor_stats/, (route) => {
      intercepted = true;
      return route.abort();
    });
    await page.goto(
      `/winning-technique?tab=motorranking&venue_code=${VENUE_KOJIMA}`,
    );
    await page.waitForLoadState("networkidle").catch(() => {});
    test.skip(
      !intercepted,
      "会場サイトの値の取得が venue_motor_stats を直接読む経路ではなかった",
    );
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "モーター成績を取得できませんでした" }),
    ).toBeVisible();
    await expect(rankingTable(page)).toHaveCount(0);
    await expect(page.getByText(SOURCE_PRETEST_ONLY)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 子1 と 子3 の整合
// ---------------------------------------------------------------------------

test("[spec 既定値 要件1と要件2の順位 / 設計レビューの決定 タイ表記] 6艇表の会場内順位・分母・タイが、会場ランキングの2連率の順位と一致する", async ({
  page,
}) => {
  const table = await openRanking(page, VENUE_KOJIMA);
  const { idx, rows } = await readRanking(table);
  const rankingDate = (
    await page.getByText(SOURCE_VENUE_SITE).first().innerText()
  ).match(SOURCE_VENUE_SITE)?.[2];
  const used = rows.find((r) => !isDash(r.user) && r.user !== "");
  test.skip(
    !used,
    "この会場に今節使用者のいるモーターが無い（機番リンクから辿れない）",
  );
  const byNo = new Map(rows.map((r) => [r.no, r]));
  const rankCount = new Map();
  for (const r of rows) rankCount.set(r.rank, (rankCount.get(r.rank) ?? 0) + 1);

  // 機番リンク（今節走った直近のレース）の race_id から、同じレースのレース詳細へ移る
  await used.cell(idx.no).getByRole("link").first().click();
  await expect(page).toHaveURL(/race_id=[^&]+/);
  const raceId = new URL(page.url()).searchParams.get("race_id");
  const six = await openSixTable(page, `/race/${raceId}`);
  const noteDate = (await page.getByText(NOTE_RANK_SOURCE).innerText()).match(
    NOTE_RANK_SOURCE,
  )?.[2];
  // spec「日付の表記」: 子1 の注記と子3 の出典は同じ日付を同じ文字列（年つき）で出す
  expect(rankingDate).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
  expect(noteDate).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
  // 子1 はレースの日以前のスナップショット、子3 は最新を使うので、取得日が違うのは仕様どおり起こりうる
  test.skip(
    noteDate !== rankingDate,
    `6艇表の取得日（${noteDate}）が会場ランキングの最新（${rankingDate}）と違い、同じスナップショットで比べられない`,
  );

  const t = await readTable(six);
  const noIdx = colIndex(t.headers, /機番/);
  const rankIdx = colIndex(t.headers, /会場内順位/);
  for (const r of t.rows) {
    const no = num(r.cells[noIdx]);
    const m = r.cells[rankIdx].match(RANK_TEXT);
    expect(m, `機番 ${no} の会場内順位: ${r.cells[rankIdx]}`).not.toBeNull();
    const ref = byNo.get(no);
    expect(ref, `機番 ${no} が会場ランキングに無い`).toBeTruthy();
    expect(Number(m[1]), `機番 ${no} の順位`).toBe(ref.rank);
    expect(Number(m[3]), "分母（◯機中）が会場ランキングの件数と違う").toBe(
      rows.length,
    );
    expect(Boolean(m[2]), `機番 ${no} の「タイ」の有無`).toBe(
      (rankCount.get(ref.rank) ?? 0) > 1,
    );
  }
});
