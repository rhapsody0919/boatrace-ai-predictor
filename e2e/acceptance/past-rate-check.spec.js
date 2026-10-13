// 過去に発生した割合を見る（BOA-635）の受け入れE2E。
//
// 入力は docs/design/past-rate-check/spec.md・screens.md のみ（plan.md・tasks.md・
// src/ 配下は読んでいない）。layer API（GET /api/analogy/layer/{raceId}）の応答は
// すべて page.route で固定データに差し替える。
//
// 固定のレースID: spec.md・screens.md には「レース一覧→詳細」の導線が書かれておらず
// （本機能はレース詳細ページの拡張のみを記述する）、辿れる導線が無いため固定値を使う。
// 実際に存在するレースIDへの置き換えが必要になる可能性がある（仕様の曖昧点として報告）。
// 発走後・確定済みのレースIDは v16 公開（2026-10-06ごろ）より後の日付にする必要がある
// （spec「データ（土台）」: 公開より前のレースは layer API を呼ばず not_saved 扱い）。
import { test, expect } from "../fixtures.js";

const PENDING_RACE_ID = "2099-12-31-01-01"; // 発走前（締切前）を想定
const FINISHED_RACE_ID = "2026-10-08-01-01"; // 発走後・確定済み（v16公開後）を想定
const PRE_PUBLISH_RACE_ID = "2020-01-01-01-01"; // v16公開より前の日付（not_savedと同じ扱い）

const BASE_CONDITIONS = {
  b1_class: "A1",
  gap_band: "0.21-0.40",
  top_boat: 1,
  round: null,
  grade_g1plus: false,
};

function okBody({
  rows,
  n_total,
  n_returned,
  pool_from = "2024-03-01",
  pool_cutoff = "2026-10-12",
  conditions = BASE_CONDITIONS,
  run_id = "run-1",
} = {}) {
  return {
    status: "ok",
    run_id,
    conditions,
    n_total: n_total ?? rows.length,
    n_returned: n_returned ?? rows.length,
    pool_from,
    pool_cutoff,
    rows,
  };
}

/**
 * layer API のモック。応答が status="ok" のときは race_id を自動でリクエストURLの
 * raceId に合わせる（raceId の取り違え検査を行うテスト以外は一致させておく必要がある。
 * options.raceId で明示的に不一致にできる）。
 */
async function mockLayer(page, body, { httpStatus = 200, raceId } = {}) {
  await page.route("**/api/analogy/layer/**", async (route) => {
    const url = route.request().url();
    const pathRaceId = url.match(/\/api\/analogy\/layer\/([^/?]+)/)?.[1];
    const finalBody =
      body && typeof body === "object" && body.status === "ok"
        ? { ...body, race_id: raceId ?? pathRaceId }
        : body;
    await route.fulfill({
      status: httpStatus,
      contentType: "application/json",
      body: JSON.stringify(finalBody),
    });
  });
}

function genericRow(i, overrides = {}) {
  const boats = [1, 2, 3, 4, 5, 6];
  const rank1 = boats[i % 6];
  const rest = boats.filter((b) => b !== rank1);
  const rank2 = rest[i % 5];
  const rank3 = rest.filter((b) => b !== rank2)[i % 4];
  return {
    race_id: `2025-0${(i % 9) + 1}-01-01-0${(i % 9) + 1}`,
    race_date: `2025-0${(i % 9) + 1}-01`,
    rank1,
    rank2,
    rank3,
    winning_technique: ["逃げ", "差し", "まくり", "まくり差し"][i % 4],
    course_by_boat: [1, 2, 3, 4, 5, 6],
    st_by_course: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
    payout_3tan: 500 + i * 100,
    ...overrides,
  };
}

const GENERIC_ROWS = Array.from({ length: 5 }, (_, i) => genericRow(i));

function orderRow(idx, rank2, rank3) {
  return {
    race_id: `2025-07-01-01-${String(idx).padStart(2, "0")}`,
    race_date: "2025-07-01",
    rank1: 1,
    rank2,
    rank3,
    winning_technique: "差し",
    course_by_boat: [1, 2, 3, 4, 5, 6],
    st_by_course: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
    payout_3tan: 1000,
  };
}

/** 着順タブ用。rank1=1固定・rank2/rank3で型を変えた行を totalCount 件作る（先頭 matchCount 件が「1-3-4」に一致） */
function makeOrderRows(matchCount, totalCount) {
  return Array.from({ length: totalCount }, (_, i) => {
    const matches = i < matchCount;
    return orderRow(i, matches ? 3 : 1, matches ? 4 : 3);
  });
}

// 内訳（上位4組＋「ほか」）の検証用。1着=1号艇固定、2着∈{2,3,4}・3着∈{2,4,5}の
// 組み合わせごとに件数を変えて作る（9・6・5・4・1・1件、同数の組はない）
const BREAKDOWN_ROWS = [
  ...Array.from({ length: 9 }, (_, i) => orderRow(i, 3, 2)),
  ...Array.from({ length: 6 }, (_, i) => orderRow(9 + i, 4, 2)),
  ...Array.from({ length: 5 }, (_, i) => orderRow(15 + i, 2, 4)),
  ...Array.from({ length: 4 }, (_, i) => orderRow(20 + i, 2, 5)),
  orderRow(24, 3, 4),
  orderRow(25, 3, 5),
];

// 展開タブの除外行検証用。winning_technique が null の行は分母から除く
const TENKAI_ROWS = [
  genericRow(0, { rank1: 3, winning_technique: "まくり" }),
  genericRow(1, { rank1: 3, winning_technique: "まくり" }),
  genericRow(2, { winning_technique: null }),
  genericRow(3, { winning_technique: null }),
];

/** 指定件数だけ match / 残りを nonMatch にした行配列を作る（FR-3 の線の検証用） */
function buildCountedRows(matchCount, totalCount, matchRow, nonMatchRow) {
  return Array.from({ length: totalCount }, (_, i) =>
    i < matchCount ? matchRow(i) : nonMatchRow(i),
  );
}

function allRows(n, overrides) {
  return Array.from({ length: n }, (_, i) => genericRow(i, overrides));
}

// 着順「流す」（1号艇1着・2着{3,4}・3着{3,5}）での一致行・不一致行
const nagashiMatchRow = (i) => genericRow(i, { rank1: 1, rank2: 3, rank3: 5 });
const nagashiNonMatchRow = (i) =>
  genericRow(i, { rank1: 1, rank2: 2, rank3: 4 });

async function openAiPredictionTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.getByRole("tab", { name: "AI予想" }).click();
}

async function openResultTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await page.getByRole("tab", { name: "結果" }).click();
}

const checkerHeading = (page) =>
  page.getByRole("heading", { name: "あなたの予想" });
const reviewHeading = (page) => page.getByRole("heading", { name: "振り返り" });

// 着順タブ（既定タブ）で1着=1号艇・2着=3号艇・3着=4号艇を選ぶ共通手順
async function pickOrder134(page) {
  await page.getByRole("button", { name: "1号艇", exact: true }).nth(0).click();
  await page.getByRole("button", { name: "3号艇", exact: true }).nth(1).click();
  await page.getByRole("button", { name: "4号艇", exact: true }).nth(2).click();
}

// 着順タブで「流す」オンにし、1着=1号艇・2着{3,4}・3着{3,5} を選ぶ（有効な組は
// (3,5)(4,3)(4,5) の3通り）
async function pickOrderNagashi(page) {
  await page.getByRole("button", { name: "1号艇", exact: true }).nth(0).click();
  await page.getByRole("button", { name: "流す（2着・3着を複数）" }).click();
  for (const boat of [3, 4]) {
    await page
      .getByRole("button", { name: `${boat}号艇`, exact: true })
      .nth(1)
      .click();
  }
  for (const boat of [3, 5]) {
    await page
      .getByRole("button", { name: `${boat}号艇`, exact: true })
      .nth(2)
      .click();
  }
}

const judgeButton = (page) =>
  page.getByRole("button", { name: "過去に発生した割合を見る" });

test.describe("AI予想タブの表示条件", () => {
  test("[spec FR-4] status=ok かつ rows が1件以上なら「あなたの予想」が表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await expect(checkerHeading(page)).toBeVisible();
  });

  for (const status of ["not_saved", "empty_layer", "absent"]) {
    test(`[spec FR-4] status=${status} では「あなたの予想」が表示されない`, async ({
      page,
    }) => {
      await mockLayer(page, { status });
      await openAiPredictionTab(page, PENDING_RACE_ID);
      await expect(checkerHeading(page)).toHaveCount(0);
    });
  }

  test("[spec FR-4] rows が0件では「あなたの予想」が表示されない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: [] }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await expect(checkerHeading(page)).toHaveCount(0);
  });

  test("[spec FR-4][screens] 取得に失敗すると「データ取得エラー」とボタン「再読み込み」が表示される", async ({
    page,
  }) => {
    await mockLayer(page, { message: "bad gateway" }, { httpStatus: 502 });
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await expect(page.getByText("データ取得エラー")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "再読み込み" }),
    ).toBeVisible();
    await expect(checkerHeading(page)).toHaveCount(0);
  });

  test("[spec データ（土台）] v16公開より前の日付のレースでは layer API を呼ばず「あなたの予想」も表示されない", async ({
    page,
  }) => {
    let called = false;
    await page.route("**/api/analogy/layer/**", async (route) => {
      called = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(okBody({ rows: GENERIC_ROWS })),
      });
    });
    await openAiPredictionTab(page, PRE_PUBLISH_RACE_ID);
    await expect(checkerHeading(page)).toHaveCount(0);
    expect(called).toBe(false);
  });

  test("[spec データ（土台）] layer の race_id が表示中の raceId と異なる応答では「あなたの予想」が表示されない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }), {
      raceId: "9999-01-01-01-99",
    });
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await expect(checkerHeading(page)).toHaveCount(0);
  });
});

test.describe("結果タブ（振り返り）の表示条件", () => {
  test("[spec FR-4] status=ok かつ rows が1件以上なら「振り返り」が表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openResultTab(page, FINISHED_RACE_ID);
    await expect(reviewHeading(page)).toBeVisible();
  });

  for (const status of ["not_saved", "empty_layer", "absent"]) {
    test(`[spec FR-4] status=${status} では「振り返り」が表示されない`, async ({
      page,
    }) => {
      await mockLayer(page, { status });
      await openResultTab(page, FINISHED_RACE_ID);
      await expect(reviewHeading(page)).toHaveCount(0);
    });
  }

  test("[spec FR-4] rows が0件では「振り返り」が表示されない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: [] }));
    await openResultTab(page, FINISHED_RACE_ID);
    await expect(reviewHeading(page)).toHaveCount(0);
  });

  test("[spec FR-4][screens] 取得に失敗すると結果タブでも「データ取得エラー」とボタン「再読み込み」が表示される", async ({
    page,
  }) => {
    await mockLayer(page, { message: "bad gateway" }, { httpStatus: 502 });
    await openResultTab(page, FINISHED_RACE_ID);
    await expect(page.getByText("データ取得エラー")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "再読み込み" }),
    ).toBeVisible();
    await expect(reviewHeading(page)).toHaveCount(0);
  });

  test("[spec データ（土台）] v16公開より前の日付のレースでは結果タブでも layer API を呼ばず「振り返り」も表示されない", async ({
    page,
  }) => {
    let called = false;
    await page.route("**/api/analogy/layer/**", async (route) => {
      called = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(okBody({ rows: GENERIC_ROWS })),
      });
    });
    await openResultTab(page, PRE_PUBLISH_RACE_ID);
    await expect(reviewHeading(page)).toHaveCount(0);
    expect(called).toBe(false);
  });

  test("[spec データ（土台）] layer の race_id が表示中の raceId と異なる応答では「振り返り」が表示されない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }), {
      raceId: "9999-01-01-01-99",
    });
    await openResultTab(page, FINISHED_RACE_ID);
    await expect(reviewHeading(page)).toHaveCount(0);
  });
});

test.describe("画面の構造・操作要素", () => {
  test("[spec FR-4][screens S-1] AI予想タブ内で「あなたの予想」はイン崩れ注意度のカード・出現パターンより後に表示される", async ({
    page,
  }) => {
    // 置き場所はタブの末尾に確定済み（spec FR-4、screens S-1）。ただし
    // イン崩れ注意度のカード・出現パターン自体は layer API 以外のデータに依存し、
    // 固定レースIDでは出ないことがあるため、出ている場合だけ順序を確かめる
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    const names = await page.getByRole("heading").allTextContents();
    const checkerIndex = names.findIndex((t) => t.includes("あなたの予想"));
    expect(checkerIndex).toBeGreaterThan(-1);
    for (const label of ["イン崩れ注意度", "出現パターン"]) {
      const idx = names.findIndex((t) => t.includes(label));
      if (idx !== -1) expect(checkerIndex).toBeGreaterThan(idx);
    }
  });

  test("[screens] 型の切り替えは6タブのtablist（aria-label「予想の型」）で、既定は「着順」", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    const tablist = page.getByRole("tablist", { name: "予想の型" });
    await expect(tablist).toBeVisible();
    for (const name of [
      "着順",
      "1号艇",
      "展開",
      "スリット",
      "進入",
      "配当の帯",
    ]) {
      await expect(tablist.getByRole("tab", { name })).toBeVisible();
    }
    await expect(tablist.getByRole("tab", { name: "着順" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("[screens] 着順の各行は role=group で囲まれ、aria-labelが「1着」「2着」「3着」", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    for (const label of ["1着", "2着", "3着"]) {
      await expect(page.getByRole("group", { name: label })).toBeVisible();
    }
  });

  test("[screens] 着順タブで3着まで決めると点数が「1-3-4（1点）」の形式で表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await expect(page.getByText("1-3-4（1点）")).toBeVisible();
  });

  test("[screens] 着順タブで「流す」をオンにすると2着・3着を複数選べ、点数が複数点になる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrderNagashi(page);
    // 2着{3,4}・3着{3,5}のうち、同じ艇が2着・3着に重なる組(3,3)は点数に数えない
    // → 有効な組は(3,5)(4,3)(4,5)の3通り
    await expect(page.getByText("（3点）")).toBeVisible();
  });

  test("[spec FR-1] 着順タブ: 3着まで決まって点数が1点以上になるまで判定ボタンは押せない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await expect(judgeButton(page)).toBeDisabled();
    await page
      .getByRole("button", { name: "1号艇", exact: true })
      .nth(0)
      .click();
    await expect(judgeButton(page)).toBeDisabled();
    await page
      .getByRole("button", { name: "3号艇", exact: true })
      .nth(1)
      .click();
    await expect(judgeButton(page)).toBeDisabled();
    await page
      .getByRole("button", { name: "4号艇", exact: true })
      .nth(2)
      .click();
    await expect(judgeButton(page)).toBeEnabled();
  });

  test("[screens] 「やり直す」ボタンで着順の選択と結果がクリアされる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.getByText(/回（/)).toBeVisible();
    await page.getByRole("button", { name: "やり直す" }).click();
    await expect(page.getByText(/回（/)).toHaveCount(0);
    await expect(judgeButton(page)).toBeDisabled();
  });

  test("[screens] 1号艇タブの3ピル（1着/残る/飛ぶ）が表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "1号艇" }).click();
    await expect(
      page.getByRole("button", { name: "1号艇が 1着" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "1号艇が 残る（3着以内）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "1号艇が 飛ぶ（4着以下）" }),
    ).toBeVisible();
  });

  test("[spec FR-1] 進入タブ: 1号艇・2号艇はdisabled、3〜6号艇は押せる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "進入" }).click();
    await expect(
      page.getByRole("button", { name: "1号艇", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "2号艇", exact: true }),
    ).toBeDisabled();
    for (const boat of [3, 4, 5, 6]) {
      await expect(
        page.getByRole("button", { name: `${boat}号艇`, exact: true }),
      ).toBeEnabled();
    }
  });

  test("[screens] 配当の帯タブの3ピルが表示される", async ({ page }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "配当の帯" }).click();
    await expect(
      page.getByRole("button", { name: "堅い（3連単 1,000円未満）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "中穴（1,000〜10,000円）" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "万舟（10,000円以上）" }),
    ).toBeVisible();
  });

  test("[spec FR-1] 展開タブ: 決まり手が分からない行は除外され、理由付きで表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: TENKAI_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "展開" }).click();
    await page.getByRole("button", { name: "3号艇", exact: true }).click();
    await page.getByRole("button", { name: "まくり" }).click();
    await judgeButton(page).click();
    await expect(
      page.getByText("決まり手が分からない2レースを除く"),
    ).toBeVisible();
    await expect(page.getByText("過去2レース中 2回（100.0%）")).toBeVisible();
  });

  test("[spec FR-1] スリットの一覧に全国の出現率と母数の注記が表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await expect(
      page.getByText(
        "全国の出現率は2019-04〜2026-09の39.9万レース（F・出遅れ・欠場のあるレースを除く）",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^横一線/ })).toContainText(
      "全国14.2%",
    );
    await expect(page.getByRole("button", { name: /^カド一撃/ })).toContainText(
      "全国14.9%",
    );
  });

  test("[spec FR-1] 定義から同時に起きない2形（内3艇そろう＋2コース凹み）は、先に選んだ方を選ぶと後がdisabledになる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^内3艇そろう/ }).click();
    const d2 = page.getByRole("button", { name: /^2コース凹み/ });
    await expect(d2).toBeDisabled();
    await expect(page.getByText("同時には起きない形です")).toBeVisible();
  });

  test("[spec FR-1] 内3艇そろう→カド一撃の順に選んだ後は、2コース凹みを押せる（押すと最も古い内3艇そろうが外れるため）", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^内3艇そろう/ }).click();
    await page.getByRole("button", { name: /^カド一撃/ }).click();
    const d2 = page.getByRole("button", { name: /^2コース凹み/ });
    await expect(d2).toBeEnabled();
    await d2.click();
    await expect(
      page.getByRole("button", { name: /^内3艇そろう/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("button", { name: /^カド一撃/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(d2).toHaveAttribute("aria-pressed", "true");
  });

  test("[spec FR-1] 横一線・内3艇そろうだけを選んだときは強さの選択が隠れる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^横一線/ }).click();
    await expect(page.getByRole("button", { name: /約1\/3艇身/ })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: /^イン凹み/ }).click();
    await expect(
      page.getByRole("button", { name: /約1\/3艇身/ }),
    ).toBeVisible();
  });

  test("[spec FR-1] 横一線＋イン凹みを選んでいるとき、2段目に切り替える「約半艇身」はdisabledになる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^横一線/ }).click();
    await page.getByRole("button", { name: /^イン凹み/ }).click();
    await expect(page.getByRole("button", { name: /約半艇身/ })).toBeDisabled();
  });

  test("[screens] カド一撃を選択中は強さの注記（1/4艇身等）が表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^カド一撃/ }).click();
    await expect(
      page.getByText("カド一撃は約1/4艇身（0.03秒）／約1/3艇身（0.05秒）"),
    ).toBeVisible();
  });

  test("[spec FR-1] スリット「自分で作る」は1コースも指定しないと判定ボタンを押せず、7形とは排他になる", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: "自分で作る（1艇ずつ）" }).click();
    await expect(page.getByRole("button", { name: /^横一線/ })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "形から選ぶに戻る" }),
    ).toBeVisible();
    await expect(judgeButton(page)).toBeDisabled();
    await page.getByRole("button", { name: "1コース: 指定なし" }).click();
    await expect(judgeButton(page)).toBeEnabled();
  });

  test("[非機能要件] 艇のボタンは aria-pressed で選択状態を示す", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    const boat1 = page
      .getByRole("button", { name: "1号艇", exact: true })
      .nth(0);
    await expect(boat1).toHaveAttribute("aria-pressed", "false");
    await boat1.click();
    await expect(boat1).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("FR-2 結果の見せ方", () => {
  test("[spec FR-2] 切り詰めていない場合「過去{N}レース中 {c}回（{p}%）」の形式で主文が表示される", async ({
    page,
  }) => {
    const rows = makeOrderRows(30, 1234);
    await mockLayer(page, okBody({ rows, n_total: 1234, n_returned: 1234 }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(
      page.getByText("過去1,234レース中 30回（2.4%）"),
    ).toBeVisible();
  });

  test("[spec FR-2] 切り詰めた場合「同じ条件の新しい{N}レース中 {c}回（{p}%）」の形式で表示される", async ({
    page,
  }) => {
    const rows = makeOrderRows(412, 2000);
    await mockLayer(page, okBody({ rows, n_total: 9999, n_returned: 2000 }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(
      page.getByText("同じ条件の新しい2,000レース中 412回（20.6%）"),
    ).toBeVisible();
  });

  test("[spec FR-2] 判定できる行が無いとき「同じ条件の過去レースに、この型を判定できるレースがありません」が表示される", async ({
    page,
  }) => {
    const rows = [
      genericRow(0, { winning_technique: null }),
      genericRow(1, { winning_technique: null }),
    ];
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "展開" }).click();
    await page.getByRole("button", { name: "1号艇", exact: true }).click();
    await page.getByRole("button", { name: "逃げ" }).click();
    await judgeButton(page).click();
    await expect(
      page.getByText(
        "同じ条件の過去レースに、この型を判定できるレースがありません",
      ),
    ).toBeVisible();
  });

  test("[spec FR-2] 比べた相手の注記に層の説明文・期間・「全国」が表示される", async ({
    page,
  }) => {
    // n_total=7286・n_returned=2000・pool_cutoff=2026-10-12・最も古い行の
    // race_date=2024-03-01 は screens.md の文例をそのまま再現するための値
    const rows = makeOrderRows(0, 2000).map((row, i) =>
      i === 1999 ? { ...row, race_date: "2024-03-01" } : row,
    );
    await mockLayer(
      page,
      okBody({
        rows,
        n_total: 7286,
        n_returned: 2000,
        pool_from: "2019-04-01",
        pool_cutoff: "2026-10-12",
      }),
    );
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(
      page.getByText(
        "比べた相手: 今日と同じく、1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番がそろう過去レース7,286件のうち、新しい2,000件（全国、2024-03〜2026-10）",
      ),
    ).toBeVisible();
  });

  test("[spec FR-2] 型を切り替えると結果が隠れる", async ({ page }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.getByText(/回（/)).toBeVisible();
    await page.getByRole("tab", { name: "1号艇" }).click();
    await expect(page.getByText(/回（/)).toHaveCount(0);
  });

  test("[spec FR-2][spec 共通の数え方] 着順タブで2点以上を選ぶと、組み合わせ別の内訳が件数の多い順で上位4組＋語だけの「ほか」で表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: BREAKDOWN_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page
      .getByRole("button", { name: "1号艇", exact: true })
      .nth(0)
      .click();
    await page.getByRole("button", { name: "流す（2着・3着を複数）" }).click();
    for (const boat of [2, 3, 4]) {
      await page
        .getByRole("button", { name: `${boat}号艇`, exact: true })
        .nth(1)
        .click();
    }
    for (const boat of [2, 4, 5]) {
      await page
        .getByRole("button", { name: `${boat}号艇`, exact: true })
        .nth(2)
        .click();
    }
    await judgeButton(page).click();
    const breakdown = page.getByText(/^内訳:/);
    await expect(breakdown).toContainText("1-3-2 9回");
    await expect(breakdown).toContainText("1-4-2 6回");
    await expect(breakdown).toContainText("1-2-4 5回");
    await expect(breakdown).toContainText("1-2-5 4回");
    await expect(breakdown).toContainText("ほか");
    // 「ほか」は語だけで件数を付けない（例: 「ほか2件」のような表記にしない）
    const breakdownText = await breakdown.textContent();
    expect(breakdownText).not.toMatch(/ほか\d/);
  });

  test('[非機能要件] 結果の領域は aria-live="polite" で知らせる', async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.locator('[aria-live="polite"]')).toContainText("回（");
  });
});

test.describe("FR-3 定番／レア（線 x=15, y=5）", () => {
  test("[spec FR-3] 着順の流しでは、割合が15%ちょうどのとき「定番」ラベルが付く", async ({
    page,
  }) => {
    const rows = buildCountedRows(15, 100, nagashiMatchRow, nagashiNonMatchRow);
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrderNagashi(page);
    await judgeButton(page).click();
    await expect(page.getByText("過去100レース中 15回（15.0%）")).toBeVisible();
    await expect(page.getByText("定番", { exact: true })).toBeVisible();
  });

  test("[spec FR-3] 着順の流しでは、割合が5%ちょうどのときラベルが付かない", async ({
    page,
  }) => {
    const rows = buildCountedRows(5, 100, nagashiMatchRow, nagashiNonMatchRow);
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrderNagashi(page);
    await judgeButton(page).click();
    await expect(page.getByText("過去100レース中 5回（5.0%）")).toBeVisible();
    await expect(page.getByText("定番", { exact: true })).toHaveCount(0);
    await expect(page.getByText("レア", { exact: true })).toHaveCount(0);
  });

  test("[spec FR-3] 着順の流しでは、割合が5%未満のとき「レア」ラベルが付く", async ({
    page,
  }) => {
    const rows = buildCountedRows(4, 100, nagashiMatchRow, nagashiNonMatchRow);
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrderNagashi(page);
    await judgeButton(page).click();
    await expect(page.getByText("過去100レース中 4回（4.0%）")).toBeVisible();
    await expect(page.getByText("レア", { exact: true })).toBeVisible();
  });

  test("[spec FR-3] ラベルを出す小分け（着順の流し）では注記に「定番は15%以上、レアは5%未満」の文が付く", async ({
    page,
  }) => {
    const rows = buildCountedRows(15, 100, nagashiMatchRow, nagashiNonMatchRow);
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrderNagashi(page);
    await judgeButton(page).click();
    await expect(page.getByText(/定番は15%以上、レアは5%未満/)).toBeVisible();
  });

  test("[spec FR-3「小分けごとのラベル」] 着順の1点ではラベルも注記の文も出ない（割合が高くても）", async ({
    page,
  }) => {
    const rows = allRows(5, { rank1: 1, rank2: 3, rank3: 4 }); // 100%一致
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.getByText("過去5レース中 5回（100.0%）")).toBeVisible();
    await expect(page.getByText("定番", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/定番は.*以上、レアは.*未満/)).toHaveCount(0);
  });

  test("[spec FR-3「小分けごとのラベル」] 1号艇ではラベルが出ない（割合が高くても）", async ({
    page,
  }) => {
    const rows = allRows(5, { rank1: 1 }); // 100%一致
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "1号艇" }).click();
    await page.getByRole("button", { name: "1号艇が 1着" }).click();
    await judgeButton(page).click();
    await expect(page.getByText("過去5レース中 5回（100.0%）")).toBeVisible();
    await expect(page.getByText("定番", { exact: true })).toHaveCount(0);
  });

  test("[spec FR-3「小分けごとのラベル」] 展開ではラベルが出る", async ({
    page,
  }) => {
    const rows = allRows(5, { rank1: 3, winning_technique: "まくり" }); // 100%一致
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "展開" }).click();
    await page.getByRole("button", { name: "3号艇", exact: true }).click();
    await page.getByRole("button", { name: "まくり" }).click();
    await judgeButton(page).click();
    await expect(page.getByText("定番", { exact: true })).toBeVisible();
  });

  test("[spec FR-3「小分けごとのラベル」] スリットの形ではラベルが出る", async ({
    page,
  }) => {
    // コースごとのST（秒）: cent換算 10,11,12,13,14,15 → 横一線（max-min=5<=6）に一致
    const rows = allRows(5, {
      st_by_course: [0.1, 0.11, 0.12, 0.13, 0.14, 0.15],
    });
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: /^横一線/ }).click();
    await judgeButton(page).click();
    await expect(page.getByText("定番", { exact: true })).toBeVisible();
  });

  test("[spec FR-3「小分けごとのラベル」] スリットの「自分で作る」ではラベルが出ない（割合が高くても）", async ({
    page,
  }) => {
    // 1コース: S-6*c1 = 250-0 = 250 >= 30 → 「出る」に一致
    const rows = allRows(5, {
      st_by_course: [0, 0.5, 0.5, 0.5, 0.5, 0.5],
    });
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "スリット" }).click();
    await page.getByRole("button", { name: "自分で作る（1艇ずつ）" }).click();
    await page.getByRole("button", { name: "1コース: 指定なし" }).click();
    await judgeButton(page).click();
    await expect(page.getByText("定番", { exact: true })).toHaveCount(0);
  });

  test("[spec FR-3「小分けごとのラベル」] 進入ではラベルが出る（境界の小分けでも出す）", async ({
    page,
  }) => {
    const rows = allRows(5, { course_by_boat: [1, 2, 3, 3, 5, 6] }); // 4号艇が3コース
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "進入" }).click();
    await page.getByRole("button", { name: "4号艇", exact: true }).click();
    await page.getByRole("button", { name: "3コース以内に入る" }).click();
    await judgeButton(page).click();
    await expect(page.getByText("定番", { exact: true })).toBeVisible();
  });

  test("[spec FR-3「小分けごとのラベル」] 配当の帯ではラベルが出ない（割合が高くても）", async ({
    page,
  }) => {
    const rows = allRows(5, { payout_3tan: 20000 }); // 万舟に100%一致
    await mockLayer(page, okBody({ rows }));
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await page.getByRole("tab", { name: "配当の帯" }).click();
    await page.getByRole("button", { name: "万舟（10,000円以上）" }).click();
    await judgeButton(page).click();
    await expect(page.getByText("定番", { exact: true })).toHaveCount(0);
  });
});

test.describe("FR-5 端末内保存", () => {
  test("[spec FR-5] 判定すると localStorage のキー boatai-user:past-rate-check:v1 に Entry が保存される", async ({
    page,
  }) => {
    await mockLayer(
      page,
      okBody({
        rows: GENERIC_ROWS,
        run_id: "run-abc",
        pool_cutoff: "2026-10-12",
      }),
    );
    await openAiPredictionTab(page, PENDING_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.getByText(/回（/)).toBeVisible();
    const saved = await page.evaluate(() =>
      localStorage.getItem("boatai-user:past-rate-check:v1"),
    );
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved);
    expect(parsed.v).toBe(1);
    expect(
      parsed.entries.some(
        (e) => e.type === "order" && e.raceId === PENDING_RACE_ID,
      ),
    ).toBe(true);
  });

  test("[spec FR-5] 締切後（確定済みレース）に判定しても保存されない", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openAiPredictionTab(page, FINISHED_RACE_ID);
    await pickOrder134(page);
    await judgeButton(page).click();
    await expect(page.getByText(/回（/)).toBeVisible();
    const saved = await page.evaluate(() =>
      localStorage.getItem("boatai-user:past-rate-check:v1"),
    );
    const entries = saved ? JSON.parse(saved).entries : [];
    expect(entries.some((e) => e.raceId === FINISHED_RACE_ID)).toBe(false);
  });

  test("[spec FR-4][spec FR-5] 結果タブの振り返りに保存した予想が要約付きで表示される", async ({
    page,
  }) => {
    await mockLayer(
      page,
      okBody({
        rows: GENERIC_ROWS,
        run_id: "run-xyz",
        pool_cutoff: "2026-10-12",
      }),
    );
    await page.goto(`/race/${FINISHED_RACE_ID}`);
    await page.evaluate(
      ({ raceId }) => {
        const value = {
          v: 1,
          entries: [
            {
              raceId,
              type: "boat1",
              input: { outcome: "win" },
              savedAt: "2026-01-01T00:00:00.000Z",
              snapshot: { runId: "run-xyz", poolCutoff: "2026-10-12" },
              result: {
                n: 5,
                count: 2,
                excluded: [],
                label: null,
                truncated: false,
              },
            },
          ],
        };
        localStorage.setItem(
          "boatai-user:past-rate-check:v1",
          JSON.stringify(value),
        );
      },
      { raceId: FINISHED_RACE_ID },
    );
    await page.reload();
    await page.getByRole("tab", { name: "結果" }).click();
    await expect(reviewHeading(page)).toBeVisible();
    await expect(
      page.getByText("あなたの予想 1号艇が1着 は、過去5レース中 2回（40.0%）"),
    ).toBeVisible();
  });

  test("[spec FR-4] 保存した予想が無いレースでは決着の行だけが表示される", async ({
    page,
  }) => {
    await mockLayer(page, okBody({ rows: GENERIC_ROWS }));
    await openResultTab(page, FINISHED_RACE_ID);
    await expect(reviewHeading(page)).toBeVisible();
    await expect(page.getByText(/^あなたの予想/)).toHaveCount(0);
    // 決着の艇番は実際のレース結果に依存するため、形式だけを確かめる
    await expect(
      page.getByText(
        /^決着 \d-\d-\d は、(過去|同じ条件の新しい)[\d,]+レース中 \d+回（[\d.]+%）/,
      ),
    ).toBeVisible();
  });

  test("[spec FR-4] 保存時と今の run_id が異なると、同じ条件の過去レースが変わった旨の注記が出る", async ({
    page,
  }) => {
    await mockLayer(
      page,
      okBody({
        rows: GENERIC_ROWS,
        run_id: "run-now",
        pool_cutoff: "2026-10-12",
      }),
    );
    await page.goto(`/race/${FINISHED_RACE_ID}`);
    await page.evaluate(
      ({ raceId }) => {
        const value = {
          v: 1,
          entries: [
            {
              raceId,
              type: "boat1",
              input: { outcome: "win" },
              savedAt: "2026-01-01T00:00:00.000Z",
              snapshot: { runId: "run-old", poolCutoff: "2026-09-01" },
              result: {
                n: 5,
                count: 2,
                excluded: [],
                label: null,
                truncated: false,
              },
            },
          ],
        };
        localStorage.setItem(
          "boatai-user:past-rate-check:v1",
          JSON.stringify(value),
        );
      },
      { raceId: FINISHED_RACE_ID },
    );
    await page.reload();
    await page.getByRole("tab", { name: "結果" }).click();
    await expect(
      page.getByText("入力したときから、同じ条件の過去レースが変わっています"),
    ).toBeVisible();
  });
});
