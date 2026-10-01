import { test, expect } from "@playwright/test";

// 受け入れE2E: 過去に発生した割合を見る（BOA-635）
// 入力: docs/design/past-rate-check/spec.md・screens.md のみ（plan/tasks/src は読んでいない）
//
// 近傍（get_analogy_neighbors、BOA-271）は本番に無いため、route で固定データを返す。
// 取得経路は spec「データ（土台）」の「/api/analogy/neighbors/[raceId]、失敗時は PostgREST の RPC 直読み」。
// API の応答の形は spec に書かれていない（BOA-271 plan 側）ので、API はわざと失敗させ、
// 形が RPC の返り値の行そのままと分かっている RPC 直読みに倒して固定データを返す。
// 列は spec「データ（土台）」の表どおり。期待値はすべて下の固定データから手計算した値。
//
// 定番／レアの線は未確定（spec FR-3。候補 (15,5)(20,5)(15,3)(25,3)(10,3)）。
// ラベルの期待値は、候補のどれでも結果が変わらない割合（25%以上→定番、3%未満→レア、5%以上10%未満→なし）に限る。
// 線ちょうどの境界は、画面の注記から線を読んでから固定データを作って確かめる。

const STORAGE_KEY = "boatai-user:past-rate-check:v1";

const SNAPSHOT = {
  model_version: "acceptance-model-v1",
  asof_stage: "entry",
  asof_at: "2026-09-30T21:00:00.000Z",
};

// 近傍の race_date。注記の期間は最小〜最大を「2019-04〜2025-11」の形で出す（spec FR-2）
const FIRST_DATE = "2019-04-03";
const LAST_DATE = "2025-11-28";
const MID_DATE = "2022-06-15";

const WAKU = [1, 2, 3, 4, 5, 6];
const ST_FLAT = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15];

const group = (n, row) =>
  Array.from({ length: n }, () => ({
    ...SNAPSHOT,
    race_date: MID_DATE,
    ...row,
    course_by_boat:
      row.course_by_boat === null ? null : [...row.course_by_boat],
    st_by_course: row.st_by_course === null ? null : [...row.st_by_course],
  }));

// 先頭と末尾の行の race_date を期間の端にする
const withDates = (rows) =>
  rows.map((r, i) => ({
    ...r,
    race_date:
      rows.length > 1 && i === 0
        ? FIRST_DATE
        : rows.length > 1 && i === rows.length - 1
          ? LAST_DATE
          : r.race_date,
  }));

const BASE_ROW = {
  winning_technique: "逃げ",
  course_by_boat: WAKU,
  st_by_course: ST_FLAT,
  payout_3tan: 500,
};

// 固定の近傍 800 件（全件に決着あり）。ST の比較は 1/100秒の整数（spec 共通の数え方）
//  A 300: 1-2-3 逃げ   枠なり               ST 6艇 15（横一線・内3艇そろう）                       払戻   500（堅い）
//  B 100: 1-3-4 逃げ   枠なり               ST 2コースだけ 22（2コース凹み 差7: 1段目のみ）          払戻 1,000（中穴の境界）
//  C  60: 4-1-2 まくり 枠なり               ST 内3艇20・4コース10・5,6コース15
//                                           （内3艇そろう・カド一撃 差10 両段・カド受け凹み 差10 両段・ダッシュ勢 差20 1段目のみ） 払戻 10,000（万舟の境界）
//  D  40: 2-1-3 差し   1号艇2コース・2号艇1コース ST 2コースが NULL（D-2）                        払戻 NULL（D-3）
//  F 280: 5-6-4 まくり差し 3号艇4コース・4号艇3コース ST 1コースだけ 22（イン凹み 差7: 1段目のみ）    払戻 25,000（万舟）
//  G  20: 1-4-5 逃げ   6号艇の進入 NULL（D-4） ST 6艇 15                                          払戻 1,500（中穴）
const NEIGHBORS = [
  ...group(300, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 3 }),
  ...group(100, {
    ...BASE_ROW,
    rank1: 1,
    rank2: 3,
    rank3: 4,
    st_by_course: [0.15, 0.22, 0.15, 0.15, 0.15, 0.15],
    payout_3tan: 1000,
  }),
  ...group(60, {
    rank1: 4,
    rank2: 1,
    rank3: 2,
    winning_technique: "まくり",
    course_by_boat: WAKU,
    st_by_course: [0.2, 0.2, 0.2, 0.1, 0.15, 0.15],
    payout_3tan: 10000,
  }),
  ...group(40, {
    rank1: 2,
    rank2: 1,
    rank3: 3,
    winning_technique: "差し",
    course_by_boat: [2, 1, 3, 4, 5, 6],
    st_by_course: [0.15, null, 0.15, 0.15, 0.15, 0.15],
    payout_3tan: null,
  }),
  ...group(280, {
    rank1: 5,
    rank2: 6,
    rank3: 4,
    winning_technique: "まくり差し",
    course_by_boat: [1, 2, 4, 3, 5, 6],
    st_by_course: [0.22, 0.15, 0.15, 0.15, 0.15, 0.15],
    payout_3tan: 25000,
  }),
  ...group(20, {
    ...BASE_ROW,
    rank1: 1,
    rank2: 4,
    rank3: 5,
    course_by_boat: [1, 2, 3, 4, 5, null],
    payout_3tan: 1500,
  }),
];

const countOrder = (rows, a, b, c) =>
  rows.filter((r) => r.rank1 === a && r.rank2 === b && r.rank3 === c).length;

// 1-2-3 を k 件、残りを 3-1-2 にした 800 件（線ちょうどの境界用）
const orderRows = (k) => [
  ...group(k, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 3 }),
  ...group(800 - k, { ...BASE_ROW, rank1: 3, rank2: 1, rank3: 2 }),
];

// ---------- 共通の操作 ----------

async function mockNeighbors(page, initialRows) {
  const state = { rows: initialRows, fail: false, delayMs: 0 };
  await page.route(/\/api\/analogy\/neighbors\//, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "acceptance: RPC 直読みに倒す" },
    }),
  );
  await page.route(/\/rest\/v1\/rpc\/get_analogy_neighbors/, async (route) => {
    if (state.delayMs > 0)
      await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.fail)
      return route.fulfill({
        status: 500,
        json: { message: "acceptance: 取得失敗" },
      });
    return route.fulfill({ json: withDates(state.rows) });
  });
  return state;
}

const RACE_ID_RE = /\/race\/(\d{4}-\d{2}-\d{2}-\d{2}-\d{2})(?:[/?#]|$)/;

// 本番 Supabase 直結のためレースIDを固定値で書かず、トップページのリンクから拾う。
// 仕様にトップ→レース詳細の導線の記載は無いので、ページ上のリンクのうち /race/:raceId を指すものを使う。
// ACCEPTANCE_RACE_ID があればそれを先頭に使う（トップにリンクが無い時間帯の手動実行用）
let raceIds = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    await page.goto("/");
    await expect
      .poll(async () => {
        const hrefs = await page
          .getByRole("link")
          .evaluateAll((els) => els.map((e) => e.getAttribute("href") || ""));
        raceIds = [
          ...new Set(
            hrefs.map((h) => h.match(RACE_ID_RE)?.[1]).filter(Boolean),
          ),
        ];
        return raceIds.length;
      })
      .toBeGreaterThan(0)
      .catch(() => {});
  } finally {
    await page.close();
  }
  if (process.env.ACCEPTANCE_RACE_ID)
    raceIds = [process.env.ACCEPTANCE_RACE_ID, ...raceIds];
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boatai:cookie-consent", "accepted"),
  );
});

function anyRaceId() {
  test.skip(
    raceIds.length === 0,
    "トップページからレース詳細へのリンクが拾えない（開催の無い時間帯）",
  );
  return raceIds[0];
}

const raceDate = (raceId) => raceId.slice(0, 10);
const DAY = 86400000;
// レース当日 0:05 JST（どのレースでも締切前）
const beforeDeadline = (raceId) =>
  new Date(`${raceDate(raceId)}T00:05:00+09:00`);
// レース翌日 12:00 JST（どのレースでも締切後）
const afterDeadline = (raceId) =>
  new Date(new Date(`${raceDate(raceId)}T12:00:00+09:00`).getTime() + DAY);

function tabLike(page, name) {
  const re = new RegExp(`^${name}$`);
  return page
    .getByRole("tab", { name: re })
    .or(page.getByRole("button", { name: re }))
    .or(page.getByRole("link", { name: re }))
    .first();
}

async function openAiTab(page, raceId) {
  await page.goto(`/race/${raceId}`);
  await tabLike(page, "AI予想").click();
  return page.getByRole("region", { name: "あなたの予想" });
}

// 確定済み（結果タブがある）レースを探す。結果タブは確定後だけある（spec FR-4）
async function findSettledRaceId(page) {
  for (const id of raceIds.slice(0, 10)) {
    await page.goto(`/race/${id}`);
    await expect(tabLike(page, "AI予想")).toBeVisible();
    if ((await tabLike(page, "結果").count()) > 0) return id;
  }
  return null;
}

const boat = (scope, n, row = 0) =>
  scope.getByRole("button", { name: `${n}号艇`, exact: true }).nth(row);
const judgeButton = (checker) =>
  checker.getByRole("button", { name: "過去に発生した割合を見る" });
const typeTab = (checker, name) =>
  checker.getByRole("tab", { name, exact: true });
const pill = (checker, name) =>
  checker.getByRole("button", { name, exact: true });
const slitShape = (checker, re) => checker.getByRole("button", { name: re });
const strength1 = (checker) =>
  checker.getByRole("button", { name: /^約1\/3艇身/ });
const strength2 = (checker) =>
  checker.getByRole("button", { name: /^約半艇身/ });
const nagashi = (checker) =>
  checker.getByRole("button", { name: "流す（2着・3着を複数）" });
const custom = (checker) =>
  checker.getByRole("button", { name: "自分で作る（1艇ずつ）" });
const courseBtn = (checker, course, state) =>
  checker.getByRole("button", { name: `${course}コース: ${state}` });
const label = (checker, text) => checker.getByText(text, { exact: true });

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const resultLine = (n, c, p) =>
  new RegExp(`過去${n}レース中\\s*${c}回\\s*（${esc(p)}%）`);
const ANY_RESULT = /過去\d+レース中/;

async function pickOrder(checker, first, second, third) {
  await boat(checker, first, 0).click();
  for (const b of [].concat(second)) await boat(checker, b, 1).click();
  for (const b of [].concat(third)) await boat(checker, b, 2).click();
}

async function readStore(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, STORAGE_KEY);
}

// 1回目の読み込みでだけ保存値を入れる（リロード後に上書きしないため）
async function seedStoreOnce(page, value) {
  await page.addInitScript(
    ([key, raw]) => {
      if (!sessionStorage.getItem("acc-seeded")) {
        localStorage.setItem(key, raw);
        sessionStorage.setItem("acc-seeded", "1");
      }
    },
    [STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value)],
  );
}

const savedSnapshot = (override = {}) => ({
  modelVersion: SNAPSHOT.model_version,
  asofStage: SNAPSHOT.asof_stage,
  asofAt: SNAPSHOT.asof_at,
  ...override,
});

const ORDER_123 = { first: 1, second: [2], third: [3], nagashi: false };

// =====================================================================
// AI予想タブ: 部品の構造
// =====================================================================
test.describe("AI予想タブ あなたの予想", () => {
  test.beforeEach(async ({ page }) => {
    await mockNeighbors(page, NEIGHBORS);
  });

  test("[spec FR-4] AI予想タブに見出し「あなたの予想」と「過去に発生した割合を見る」ボタンが出る", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await expect(
      checker.getByRole("heading", { name: "あなたの予想" }),
    ).toBeVisible();
    await expect(judgeButton(checker)).toBeVisible();
  });

  test("[screens 型の切り替え] tablist「予想の型」に6つの型がこの順で並び、既定は着順", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    const tablist = checker.getByRole("tablist", { name: "予想の型" });
    await expect(tablist.getByRole("tab")).toHaveText([
      "着順",
      "1号艇",
      "展開",
      "スリット",
      "進入",
      "配当の帯",
    ]);
    await expect(typeTab(checker, "着順")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // ---------- 着順 ----------

  test("[spec FR-1 着順] 3着まで決まるまで判定ボタンは押せない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await expect(judgeButton(checker)).toBeDisabled();
    await boat(checker, 1, 0).click();
    await expect(judgeButton(checker)).toBeDisabled();
    await boat(checker, 2, 1).click();
    await expect(judgeButton(checker)).toBeDisabled();
    await boat(checker, 3, 2).click();
    await expect(judgeButton(checker)).toBeEnabled();
  });

  test("[spec FR-1/FR-2/FR-3 着順] 1-2-3 は「3連単 1-2-3（1点）」、過去800レース中 300回（37.5%）で定番、1点なので内訳は出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await expect(checker).toContainText("3連単 1-2-3（1点）");
    await expect(label(checker, "定番")).toBeVisible();
    await expect(label(checker, "レア")).toHaveCount(0);
    await expect(checker).not.toContainText("内訳:");
  });

  test("[spec FR-3 着順] 1-4-5 は過去800レース中 20回（2.5%）でレア", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 4, 5);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 20, "2.5"));
    await expect(label(checker, "レア")).toBeVisible();
    await expect(label(checker, "定番")).toHaveCount(0);
  });

  test("[spec FR-1 着順] 流さないとき、同じ着で別の艇を押すと置き換わる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await boat(checker, 1, 0).click();
    await boat(checker, 2, 1).click();
    await boat(checker, 4, 1).click();
    await expect(boat(checker, 2, 1)).toHaveAttribute("aria-pressed", "false");
    await expect(boat(checker, 4, 1)).toHaveAttribute("aria-pressed", "true");
    await boat(checker, 5, 2).click();
    await judgeButton(checker).click();
    // 1-4-5 は20件
    await expect(checker).toContainText(resultLine(800, 20, "2.5"));
  });

  test("[spec FR-1 着順 流す] 流すときは押すたびに選択が入れ替わり、もう一度押すと外れる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await nagashi(checker).click();
    await expect(nagashi(checker)).toHaveAttribute("aria-pressed", "true");
    await boat(checker, 1, 0).click();
    await boat(checker, 3, 1).click();
    await boat(checker, 4, 1).click();
    await expect(boat(checker, 3, 1)).toHaveAttribute("aria-pressed", "true");
    await expect(boat(checker, 4, 1)).toHaveAttribute("aria-pressed", "true");
    await boat(checker, 3, 1).click();
    await expect(boat(checker, 3, 1)).toHaveAttribute("aria-pressed", "false");
    await expect(boat(checker, 4, 1)).toHaveAttribute("aria-pressed", "true");
  });

  test("[spec FR-1/FR-2 着順 流す] 1-3,4-2,3,4 は「3連単 1-3,4-2,3,4（4点）」、一致100回（12.5%）、内訳は 1-3-4 100回", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await nagashi(checker).click();
    await pickOrder(checker, 1, [3, 4], [2, 3, 4]);
    await expect(checker).toContainText("1-3,4-2,3,4（4点）");
    await judgeButton(checker).click();
    await expect(checker).toContainText("3連単 1-3,4-2,3,4（4点）");
    await expect(checker).toContainText(resultLine(800, 100, "12.5"));
    await expect(checker).toContainText(/内訳:\s*1-3-4\s*100回/);
    // 0件の組み合わせ・「ほか」は出さない（一致した組は1つだけ）
    await expect(checker).not.toContainText(/1-(3-2|4-2|4-3)\s*0回/);
    await expect(checker).not.toContainText("ほか");
  });

  test("[spec FR-1 着順 内訳] 件数の多い順・同数は組み合わせの昇順で上位4組、5組目以降は「ほか」、区切りは「、」", async ({
    page,
  }) => {
    // 1-2,3,4-2,3,4,5（9点）に一致: 1-3-2×9、1-2-4×6、1-4-2×6、1-3-4×4、1-2-3×3 ＝ 28件
    const rows = [
      ...group(9, { ...BASE_ROW, rank1: 1, rank2: 3, rank3: 2 }),
      ...group(6, { ...BASE_ROW, rank1: 1, rank2: 4, rank3: 2 }),
      ...group(6, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 4 }),
      ...group(4, { ...BASE_ROW, rank1: 1, rank2: 3, rank3: 4 }),
      ...group(3, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 3 }),
      ...group(772, { ...BASE_ROW, rank1: 2, rank2: 1, rank3: 3 }),
    ];
    await page.unrouteAll();
    await mockNeighbors(page, rows);
    const checker = await openAiTab(page, anyRaceId());
    await nagashi(checker).click();
    await pickOrder(checker, 1, [2, 3, 4], [2, 3, 4, 5]);
    await expect(checker).toContainText("1-2,3,4-2,3,4,5（9点）");
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 28, "3.5"));
    await expect(checker).toContainText(
      /内訳:\s*1-3-2\s*9回、\s*1-2-4\s*6回、\s*1-4-2\s*6回、\s*1-3-4\s*4回[、\s]*ほか/,
    );
    await expect(checker).not.toContainText(/1-2-3\s*3回/);
  });

  test("[spec FR-1 着順] 同じ艇が2つの着に入る組み合わせは点数に数えない（ボタンは disabled にしない）", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await nagashi(checker).click();
    await boat(checker, 1, 0).click();
    await boat(checker, 3, 1).click();
    await expect(boat(checker, 3, 2)).toBeEnabled();
    await boat(checker, 3, 2).click();
    await boat(checker, 4, 2).click();
    // 1-3-3 は数えず、1-3-4 の1点だけ
    await expect(checker).toContainText("1-3-3,4（1点）");
    await expect(checker).not.toContainText("（2点）");
  });

  test("[spec FR-1 着順] 点数が0点（同じ艇しかない）のとき判定ボタンは押せない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await boat(checker, 1, 0).click();
    await boat(checker, 3, 1).click();
    await expect(boat(checker, 3, 2)).toBeEnabled();
    await boat(checker, 3, 2).click();
    await expect(judgeButton(checker)).toBeDisabled();
  });

  test("[screens やり直す] 「やり直す」で着順が空になり、結果が隠れる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await checker.getByRole("button", { name: "やり直す" }).click();
    await expect(checker).not.toContainText(ANY_RESULT);
    await expect(boat(checker, 1, 0)).toHaveAttribute("aria-pressed", "false");
    await expect(judgeButton(checker)).toBeDisabled();
  });

  test("[spec FR-2] 入力を変えると結果が消え、ボタンを押し直すまで出ない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await boat(checker, 4, 2).click();
    await expect(checker).not.toContainText(ANY_RESULT);
    await judgeButton(checker).click();
    // 1-2-4 は0件
    await expect(checker).toContainText(resultLine(800, 0, "0.0"));
  });

  test("[spec FR-2] 型を切り替えると結果が消える", async ({ page }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await typeTab(checker, "1号艇").click();
    await expect(checker).not.toContainText(ANY_RESULT);
  });

  // ---------- 1号艇 ----------

  test("[spec FR-1/FR-2 1号艇] 1着420回（52.5%）・残る520回（65.0%）・飛ぶ280回（35.0%）と、型ごとの要約文", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "1号艇").click();
    const cases = [
      ["1号艇が 1着", "1号艇が1着", 420, "52.5"],
      ["1号艇が 残る（3着以内）", "1号艇が3着以内に残る", 520, "65.0"],
      ["1号艇が 飛ぶ（4着以下）", "1号艇が4着以下に飛ぶ", 280, "35.0"],
    ];
    for (const [name, summary, c, p] of cases) {
      await pill(checker, name).click();
      await expect(pill(checker, name)).toHaveAttribute("aria-pressed", "true");
      await judgeButton(checker).click();
      await expect(checker).toContainText(resultLine(800, c, p));
      await expect(checker).toContainText(summary);
    }
  });

  // ---------- 展開 ----------

  test("[spec FR-1 展開] 決まり手の選択肢は逃げ・差し・まくり・まくり差しの4つで、抜き・恵まれは出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "展開").click();
    for (const name of ["逃げ", "差し", "まくり", "まくり差し"]) {
      await expect(pill(checker, name)).toBeVisible();
    }
    await expect(pill(checker, "抜き")).toHaveCount(0);
    await expect(pill(checker, "恵まれ")).toHaveCount(0);
    for (let n = 1; n <= 6; n++) await expect(boat(checker, n)).toBeVisible();
  });

  test("[spec FR-1/FR-2 展開] 1号艇の逃げは「1号艇の逃げ」420回（52.5%）、2着の内訳は多い順に 2号艇300・3号艇100・4号艇20 で0件の艇は出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "展開").click();
    await boat(checker, 1).click();
    await pill(checker, "逃げ").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 420, "52.5"));
    await expect(checker).toContainText("1号艇の逃げ");
    await expect(checker).toContainText(
      /そのとき2着に来た艇:\s*2号艇\s*300回、\s*3号艇\s*100回、\s*4号艇\s*20回/,
    );
    await expect(checker).not.toContainText(/[156]号艇\s*0回/);
  });

  test("[spec FR-1 展開] 起点は艇番で数える: 4号艇のまくりは60回（7.5%）、2着は1号艇60回、ラベルなし", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "展開").click();
    await boat(checker, 4).click();
    await pill(checker, "まくり").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 60, "7.5"));
    await expect(checker).toContainText("4号艇のまくり");
    await expect(checker).toContainText(/そのとき2着に来た艇:\s*1号艇\s*60回/);
    // 7.5% はどの線の候補でも定番（10〜25%以上）未満・レア（3〜5%未満）以上
    await expect(label(checker, "定番")).toHaveCount(0);
    await expect(label(checker, "レア")).toHaveCount(0);
  });

  // ---------- スリット ----------

  test("[spec FR-1 スリット] 横一線は320回/760（42.1%）、STがそろわない40レースを除き、強さの選択は出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /横一線/).click();
    await expect(strength1(checker)).toHaveCount(0);
    await expect(strength2(checker)).toHaveCount(0);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 320, "42.1"));
    await expect(checker).toContainText(
      "スタートタイミングがそろわない40レースを除く",
    );
    // 強さが効かない形だけなら要約に艇身を付けない
    await expect(checker).not.toContainText(/横一線（約/);
  });

  test("[spec FR-1 スリット D1] 横一線・内3艇そろうの2形だけを選んだときも強さの選択は出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /横一線/).click();
    await slitShape(checker, /内3艇そろう（壁）/).click();
    await expect(strength1(checker)).toHaveCount(0);
    await expect(strength2(checker)).toHaveCount(0);
    await judgeButton(checker).click();
    // 横一線 ∧ 内3艇そろう = A300 + G20
    await expect(checker).toContainText(resultLine(760, 320, "42.1"));
  });

  test("[spec FR-1 スリット] 内3艇そろうは380回/760（50.0%）", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /内3艇そろう（壁）/).click();
    await expect(strength1(checker)).toHaveCount(0);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 380, "50.0"));
  });

  test("[spec FR-1 スリット 強さ] 2コース凹みは1段目100回（13.2%）、2段目0回（0.0%）でレア", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await expect(strength1(checker)).toHaveAttribute("aria-pressed", "true"); // 既定は1段目
    await expect(strength1(checker)).toContainText("0.05秒差");
    await expect(strength2(checker)).toContainText("0.08秒差");
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 100, "13.2"));
    await strength2(checker).click();
    await expect(checker).not.toContainText(ANY_RESULT);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 0, "0.0"));
    await expect(label(checker, "レア")).toBeVisible();
  });

  test("[spec FR-1 スリット] カド一撃は両段とも60回（7.9%）、選択中は艇身の注記が出る", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await expect(checker).toContainText(
      "カド一撃は約1/4艇身（0.03秒）／約1/3艇身（0.05秒）",
    );
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 60, "7.9"));
    await strength2(checker).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 60, "7.9"));
  });

  test("[spec FR-1 スリット] カド受け凹みは60回（7.9%）・イン凹みは1段目280回（36.8%）・ダッシュ勢先行は1段目60回（7.9%）", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const cases = [
      [/カド受け凹み（3コース）/, 60, "7.9"],
      [/イン凹み（1コース遅れ）/, 280, "36.8"],
      [/ダッシュ勢先行（外3艇）/, 60, "7.9"],
    ];
    // 1形ずつ判定するため、形ごとに開き直す
    for (const [re, c, p] of cases) {
      const checker = await openAiTab(page, raceId);
      await typeTab(checker, "スリット").click();
      await slitShape(checker, re).click();
      await expect(slitShape(checker, re)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await judgeButton(checker).click();
      await expect(checker).toContainText(resultLine(760, c, p));
    }
  });

  test("[spec FR-1 スリット] イン凹み・ダッシュ勢先行は2段目で0回になる", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    for (const re of [/イン凹み（1コース遅れ）/, /ダッシュ勢先行（外3艇）/]) {
      const checker = await openAiTab(page, raceId);
      await typeTab(checker, "スリット").click();
      await slitShape(checker, re).click();
      await strength2(checker).click();
      await judgeButton(checker).click();
      await expect(checker).toContainText(resultLine(760, 0, "0.0"));
    }
  });

  test("[spec FR-1 スリット ST の比べ方] 差が線ちょうどの近傍は、浮動小数で割れる組（0.15/0.10、0.21/0.16）でも一致に数える", async ({
    page,
  }) => {
    // H 200: 内3艇0.15・4コース0.10 → カド一撃の差は整数で5（2段目の線ちょうど）。JS の浮動小数では 0.0499…
    // J 200: 1・3コース0.16・2コース0.21 → 2コース凹みの差は整数で5（1段目の線ちょうど）
    // K 400: 6艇0.15（どちらにも当たらない）
    const rows = [
      ...group(200, {
        ...BASE_ROW,
        rank1: 4,
        rank2: 1,
        rank3: 2,
        st_by_course: [0.15, 0.15, 0.15, 0.1, 0.15, 0.15],
      }),
      ...group(200, {
        ...BASE_ROW,
        rank1: 1,
        rank2: 2,
        rank3: 3,
        st_by_course: [0.16, 0.21, 0.16, 0.15, 0.15, 0.15],
      }),
      ...group(400, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 3 }),
    ];
    await page.unrouteAll();
    await mockNeighbors(page, rows);
    const raceId = anyRaceId();

    let checker = await openAiTab(page, raceId);
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await strength2(checker).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 200, "25.0"));

    checker = await openAiTab(page, raceId);
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 200, "25.0"));
  });

  test("[spec FR-1 スリット AND] 2形を選ぶと両方を満たす件数で、各形の件数以下になる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await slitShape(checker, /ダッシュ勢先行（外3艇）/).click();
    await expect(slitShape(checker, /カド一撃（4コース）/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(slitShape(checker, /ダッシュ勢先行（外3艇）/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 60, "7.9"));
    // 2段目: カド一撃 60 ∧ ダッシュ勢 0 = 0（強さは選んだ形すべてに同じ段）
    await strength2(checker).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 0, "0.0"));
  });

  test("[spec FR-2 スリット 要約] カド受け凹み＋カド一撃は「カド受け凹み＋カド一撃（約…艇身以上）」と出す", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /カド受け凹み（3コース）/).click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await judgeButton(checker).click();
    // C の60件が両方を満たす
    await expect(checker).toContainText(resultLine(760, 60, "7.9"));
    await expect(checker).toContainText(
      /カド受け凹み＋カド一撃（約[^）]*艇身以上）/,
    );
  });

  test("[spec FR-1 スリット] 3形目を選ぶと最も古く選んだ形が外れる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await slitShape(checker, /イン凹み（1コース遅れ）/).click();
    await expect(slitShape(checker, /2コース凹み/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(slitShape(checker, /カド一撃（4コース）/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(slitShape(checker, /イン凹み（1コース遅れ）/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await judgeButton(checker).click();
    // カド一撃(C) ∧ イン凹み(F) は重ならない
    await expect(checker).toContainText(resultLine(760, 0, "0.0"));
  });

  test("[spec FR-1 スリット] 選択中の形をもう一度押すと外れ、形が無ければ判定ボタンは押せない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await expect(slitShape(checker, /2コース凹み/)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(judgeButton(checker)).toBeEnabled();
    await slitShape(checker, /2コース凹み/).click();
    await expect(slitShape(checker, /2コース凹み/)).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(judgeButton(checker)).toBeDisabled();
  });

  test("[spec FR-1 スリット] 7形それぞれに絵（img）と「全国の◯%」の出現率、1艇身≒0.13秒の注記がある", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    const shapes = [
      /横一線/,
      /内3艇そろう（壁）/,
      /2コース凹み/,
      /カド受け凹み（3コース）/,
      /カド一撃（4コース）/,
      /イン凹み（1コース遅れ）/,
      /ダッシュ勢先行（外3艇）/,
    ];
    for (const re of shapes) {
      const shape = slitShape(checker, re);
      await expect(shape).toHaveCount(1);
      await expect(shape.getByRole("img")).not.toHaveCount(0);
      await expect(shape).toContainText(/全国の\d+(\.\d)?%/);
    }
    await expect(checker).toContainText(/0\.13秒/);
  });

  test("[spec FR-1 自分で作る D2] 各コースは 指定なし→出る→凹む で切り替わり、全部指定なしなら押せない。「そろう」は出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await custom(checker).click();
    await expect(judgeButton(checker)).toBeDisabled();
    await courseBtn(checker, 1, "指定なし").click();
    await expect(courseBtn(checker, 1, "出る")).toBeVisible();
    await expect(judgeButton(checker)).toBeEnabled();
    await courseBtn(checker, 1, "出る").click();
    await expect(courseBtn(checker, 1, "凹む")).toBeVisible();
    await courseBtn(checker, 1, "凹む").click();
    await expect(courseBtn(checker, 1, "指定なし")).toBeVisible();
    await expect(judgeButton(checker)).toBeDisabled();
    await expect(checker).not.toContainText("そろう→");
    await expect(courseBtn(checker, 1, "そろう")).toHaveCount(0);
  });

  test("[spec FR-1 自分で作る] 4コース「出る」は60回/760（7.9%）、1コース「凹む」は280回/760（36.8%）", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await custom(checker).click();
    await courseBtn(checker, 4, "指定なし").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 60, "7.9"));
    // 4コースを指定なしに戻し、1コースを凹むにする
    await courseBtn(checker, 4, "出る").click();
    await courseBtn(checker, 4, "凹む").click();
    await courseBtn(checker, 1, "指定なし").click();
    await courseBtn(checker, 1, "出る").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(760, 280, "36.8"));
  });

  test("[spec FR-2 自分で作る 要約] 4コース出る・1コース凹むは「4コースが出る」「1コースが凹む」を「・」でつないで出す", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await custom(checker).click();
    await courseBtn(checker, 4, "指定なし").click();
    await courseBtn(checker, 1, "指定なし").click();
    await courseBtn(checker, 1, "出る").click();
    await judgeButton(checker).click();
    // 4コース出る(C) ∧ 1コース凹む(F) は重ならない
    await expect(checker).toContainText(resultLine(760, 0, "0.0"));
    await expect(checker).toContainText(
      /4コースが出る・1コースが凹む|1コースが凹む・4コースが出る/,
    );
  });

  test("[spec FR-1 自分で作る] 7形とは排他で、「形から選ぶに戻る」で7形に戻れる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await custom(checker).click();
    await expect(slitShape(checker, /横一線/)).toHaveCount(0);
    await checker.getByRole("button", { name: "形から選ぶに戻る" }).click();
    await expect(slitShape(checker, /横一線/)).toBeVisible();
    await expect(courseBtn(checker, 1, "指定なし")).toHaveCount(0);
  });

  // ---------- 進入 ----------

  test("[spec FR-1 進入] 1・2号艇は選べず、3〜6号艇は選べる", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "進入").click();
    await expect(boat(checker, 1)).toBeDisabled();
    await expect(boat(checker, 2)).toBeDisabled();
    for (const n of [3, 4, 5, 6]) await expect(boat(checker, n)).toBeEnabled();
    for (const name of [
      "3コース以内に入る",
      "4コース以内に入る",
      "枠なりのまま",
    ]) {
      await expect(pill(checker, name)).toBeVisible();
    }
  });

  test("[spec FR-1/FR-2 進入] 4号艇の3コース以内は「4号艇が3コース以内に入る」280回（35.0%）、3号艇は枠なりも含め520回（65.0%）", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "進入").click();
    await boat(checker, 4).click();
    await pill(checker, "3コース以内に入る").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 280, "35.0"));
    await expect(checker).toContainText("4号艇が3コース以内に入る");
    await boat(checker, 3).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 520, "65.0"));
  });

  test("[spec FR-1/FR-2 進入] 6号艇の枠なりは「6号艇が枠なりのまま」、進入が分からない20レースを除き780回/780（100.0%）", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "進入").click();
    await boat(checker, 6).click();
    await pill(checker, "枠なりのまま").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(780, 780, "100.0"));
    await expect(checker).toContainText("6号艇が枠なりのまま");
    await expect(checker).toContainText("進入が分からない20レースを除く");
  });

  test("[spec FR-1 進入] 4号艇の4コース以内は全件（800回/800）で、除いた件数の行は出ない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "進入").click();
    await boat(checker, 4).click();
    await pill(checker, "4コース以内に入る").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 800, "100.0"));
    await expect(checker).not.toContainText(/レースを除く/);
  });

  // ---------- 配当の帯 ----------

  test("[spec FR-1 配当の帯] 堅い300回（39.5%）・中穴は1,000円ちょうどを含み120回（15.8%）・万舟は10,000円ちょうどを含み340回（44.7%）、払戻が無い40レースを除く", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "配当の帯").click();
    const cases = [
      ["堅い（3連単 1,000円未満）", 300, "39.5"],
      ["中穴（1,000〜10,000円）", 120, "15.8"],
      ["万舟（10,000円以上）", 340, "44.7"],
    ];
    for (const [name, c, p] of cases) {
      await pill(checker, name).click();
      await judgeButton(checker).click();
      await expect(checker).toContainText(resultLine(760, c, p));
      await expect(checker).toContainText("払戻が無い40レースを除く");
    }
    await expect(checker).toContainText("3連単が万舟（10,000円以上）");
  });

  // ---------- 注記・共通 ----------

  test("[spec FR-2] 比べた相手の注記に類似レースの行数・近傍の期間・定番／レアの線が出て、「（例）」は付かない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(
      "比べた相手: 類似レース800件（今日と条件が近い過去のレース、2019-04〜2025-11）",
    );
    await expect(checker).toContainText(
      /定番は\d+(\.\d+)?%以上、レアは\d+(\.\d+)?%未満/,
    );
    await expect(checker).not.toContainText("（例）");
  });

  test("[spec FR-1 共通] 除いた件数が0のときは除いた件数の行を出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "1号艇").click();
    await pill(checker, "1号艇が 1着").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 420, "52.5"));
    await expect(checker).not.toContainText(/レースを除く/);
  });

  test("[spec 位置づけ] 使わない呼び方（あなたの読み・似たレース・少数派・多数派・前例レース）と当たり外れ・否定形の説明を出さない", async ({
    page,
  }) => {
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect(checker).not.toContainText(
      /あなたの読み|似たレース|少数派|多数派|前例レース/,
    );
    await expect(checker).not.toContainText(/AI\s*がやらない/);
    await expect(checker).not.toContainText(/当たり|外れ|的中/);
    await expect(page.getByText(/競艇/)).toHaveCount(0);
  });

  test("[spec 非機能] 375px で着順・スリットを開いても横スクロールが出ない", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    const overflow = () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await typeTab(checker, "スリット").click();
    await expect(slitShape(checker, /横一線/)).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});

// =====================================================================
// AI予想タブ: 近傍データの境界・取得の状態
// =====================================================================
test.describe("AI予想タブ 近傍データの境界", () => {
  test("[spec FR-4] 類似レースが0行のレースでは部品ごと出さない", async ({
    page,
  }) => {
    await mockNeighbors(page, []);
    const raceId = anyRaceId();
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "AI予想").click();
    await expect(
      page.getByRole("heading", { name: "あなたの予想" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "過去に発生した割合を見る" }),
    ).toHaveCount(0);
  });

  test("[spec FR-4] 取得中は部品を出さない", async ({ page }) => {
    const state = await mockNeighbors(page, NEIGHBORS);
    state.delayMs = 5000;
    const raceId = anyRaceId();
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "AI予想").click();
    await expect(
      page.getByRole("button", { name: "過去に発生した割合を見る" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "あなたの予想" }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("[spec FR-4] 取得に失敗したら再試行つきのエラーを出し（「無い」と同じにしない）、再試行で部品が出る", async ({
    page,
  }) => {
    const state = await mockNeighbors(page, NEIGHBORS);
    state.fail = true;
    const raceId = anyRaceId();
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "AI予想").click();
    // InlineFetchError の文言は仕様に無いため、再試行のボタンを名前の幅で探す
    const retry = page.getByRole("button", {
      name: /再試行|再読み込み|もう一度|retry/i,
    });
    await expect(retry.first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "過去に発生した割合を見る" }),
    ).toHaveCount(0);
    state.fail = false;
    await retry.first().click();
    await expect(
      page.getByRole("heading", { name: "あなたの予想" }),
    ).toBeVisible();
  });

  test("[spec 共通の数え方] 決着が無い近傍はどの型でも分母から除き、「決着が分からない{k}レースを除く」を出す。決着なしを先に数える", async ({
    page,
  }) => {
    // 決着あり780件（1-2-3 が390件、うち 3-1-2 の10件は ST に NULL）＋決着なし20件（ST・払戻も NULL）
    const rows = [
      ...group(390, { ...BASE_ROW, rank1: 1, rank2: 2, rank3: 3 }),
      ...group(380, {
        ...BASE_ROW,
        rank1: 3,
        rank2: 1,
        rank3: 2,
        winning_technique: "まくり",
        payout_3tan: 5000,
      }),
      ...group(10, {
        ...BASE_ROW,
        rank1: 3,
        rank2: 1,
        rank3: 2,
        winning_technique: "まくり",
        st_by_course: [0.15, 0.15, null, 0.15, 0.15, 0.15],
        payout_3tan: 5000,
      }),
      ...group(20, {
        ...BASE_ROW,
        rank1: null,
        rank2: null,
        rank3: null,
        winning_technique: null,
        st_by_course: [null, 0.15, 0.15, 0.15, 0.15, 0.15],
        payout_3tan: null,
      }),
    ];
    await mockNeighbors(page, rows);
    const checker = await openAiTab(page, anyRaceId());
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(780, 390, "50.0"));
    await expect(checker).toContainText("決着が分からない20レースを除く");
    // 注記の件数は RPC の行数（分母 N とは別）
    await expect(checker).toContainText("類似レース800件");

    await typeTab(checker, "1号艇").click();
    await pill(checker, "1号艇が 飛ぶ（4着以下）").click();
    await judgeButton(checker).click();
    // 決着の無い20件を「1号艇が着外」に数えない
    await expect(checker).toContainText(resultLine(780, 0, "0.0"));

    await typeTab(checker, "スリット").click();
    await slitShape(checker, /横一線/).click();
    await judgeButton(checker).click();
    // 決着なし20件は決着なしとして数え、ST の理由には重ねない。ST の理由は決着がある10件だけ
    await expect(checker).toContainText(resultLine(770, 770, "100.0"));
    await expect(checker).toContainText("決着が分からない20レースを除く");
    await expect(checker).toContainText(
      "スタートタイミングがそろわない10レースを除く",
    );
    await expect(checker).not.toContainText(
      "スタートタイミングがそろわない30レースを除く",
    );
  });

  test("[spec FR-2 / 共通の数え方] 判定できる近傍が0件なら主文・割合・ラベルを出さず「この型を判定できる類似レースがありません」、要約と除いた件数の行は出す", async ({
    page,
  }) => {
    const rows = group(800, {
      ...BASE_ROW,
      rank1: 1,
      rank2: 2,
      rank3: 3,
      st_by_course: [null, 0.15, 0.15, 0.15, 0.15, 0.15],
    });
    await mockNeighbors(page, rows);
    const checker = await openAiTab(page, anyRaceId());
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(
      "この型を判定できる類似レースがありません",
    );
    await expect(checker).toContainText(
      "スタートタイミングがそろわない800レースを除く",
    );
    await expect(checker).toContainText(/2コース凹み（約[^）]*艇身以上）/);
    await expect(checker).not.toContainText(ANY_RESULT);
    await expect(checker).not.toContainText(/\d+(\.\d)?%）/);
    await expect(label(checker, "定番")).toHaveCount(0);
    await expect(label(checker, "レア")).toHaveCount(0);
  });

  test("[spec FR-3] 線ちょうど: 割合が x% ちょうどなら定番、y% ちょうどならレアにしない（線は画面の注記から読む）", async ({
    page,
  }) => {
    const state = await mockNeighbors(page, NEIGHBORS);
    const raceId = anyRaceId();
    let checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    const note = await checker.innerText();
    const m = note.match(
      /定番は(\d+(?:\.\d+)?)%以上、レアは(\d+(?:\.\d+)?)%未満/,
    );
    expect(m, "注記に定番／レアの線が無い").not.toBeNull();
    const x = Number(m[1]);
    const y = Number(m[2]);
    // 800件で割合がちょうど線になる件数（8x・8y）が整数でなければ作れない
    test.skip(
      !Number.isInteger(x * 8) || !Number.isInteger(y * 8),
      `線 (${x}, ${y}) は800件でちょうどの割合を作れない`,
    );

    // [件数, 定番が出るか, レアが出るか]
    // 8x−1 件は (x − 0.125)%、8y−1 件は (y − 0.125)%
    const cases = [
      [x * 8, true, false],
      [x * 8 - 1, false, false],
      [y * 8, false, false],
      [y * 8 - 1, false, true],
    ];
    for (const [k, standard, rare] of cases) {
      state.rows = orderRows(k);
      checker = await openAiTab(page, raceId);
      await pickOrder(checker, 1, 2, 3);
      await judgeButton(checker).click();
      await expect(checker).toContainText(
        new RegExp(`過去800レース中\\s*${k}回`),
      );
      await expect(label(checker, "定番")).toHaveCount(standard ? 1 : 0);
      await expect(label(checker, "レア")).toHaveCount(rare ? 1 : 0);
    }
  });
});

// =====================================================================
// 端末内保存（FR-5）
// =====================================================================
test.describe("端末内保存", () => {
  test.beforeEach(async ({ page }) => {
    await mockNeighbors(page, NEIGHBORS);
  });

  test("[spec FR-5] ボタンを押すと boatai-user:past-rate-check:v1 に型・入力・時刻・スナップショット・見せた数字とラベルを保存する（boatai: では始めない）", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));

    await expect.poll(() => readStore(page)).not.toBeNull();
    const store = await readStore(page);
    expect(store.v).toBe(1);
    expect(store.entries).toHaveLength(1);
    const entry = store.entries[0];
    expect(entry).toMatchObject({
      raceId,
      type: "order",
      input: ORDER_123,
      snapshot: savedSnapshot(),
      result: { n: 800, count: 300, label: "standard" },
    });
    expect(Array.isArray(entry.result.excluded)).toBe(true);
    expect(entry.result.excluded).toHaveLength(0);
    expect(Number.isNaN(Date.parse(entry.savedAt))).toBe(false);
    expect(Math.abs(Date.parse(entry.savedAt) - now.getTime())).toBeLessThan(
      10 * 60 * 1000,
    );
    // 表示用の要約文は保存しない
    expect(JSON.stringify(entry)).not.toContain("3連単");
    // 更新ボタンで消える boatai: 名前空間に置かない
    const prcKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /past-rate/.test(k)),
    );
    expect(prcKeys).toEqual([STORAGE_KEY]);
  });

  test("[spec FR-5] 入力の途中（ボタンを押す前）は保存しない", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await expect(judgeButton(checker)).toBeEnabled();
    const store = await readStore(page);
    expect(store?.entries ?? []).toHaveLength(0);
  });

  test("[spec FR-5] 同じレース・同じ型は最新1件に置き換わり、別の型は別に残る", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await checker.getByRole("button", { name: "やり直す" }).click();
    await pickOrder(checker, 1, 4, 5);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 20, "2.5"));
    await typeTab(checker, "1号艇").click();
    await pill(checker, "1号艇が 1着").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 420, "52.5"));

    await expect
      .poll(async () => (await readStore(page))?.entries?.length)
      .toBe(2);
    const { entries } = await readStore(page);
    const order = entries.filter(
      (e) => e.raceId === raceId && e.type === "order",
    );
    expect(order).toHaveLength(1);
    expect(order[0].input).toMatchObject({ first: 1, second: [4], third: [5] });
    expect(order[0].result).toMatchObject({ n: 800, count: 20, label: "rare" });
    const boat1 = entries.filter(
      (e) => e.raceId === raceId && e.type === "boat1",
    );
    expect(boat1).toHaveLength(1);
    expect(boat1[0].input).toEqual({ outcome: "win" });
  });

  test("[spec FR-5] 型ごとの input の形（boat1・tenkai・slit・entry・payout）と除いた件数の保存", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);

    await typeTab(checker, "1号艇").click();
    await pill(checker, "1号艇が 残る（3着以内）").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);

    await typeTab(checker, "展開").click();
    await boat(checker, 4).click();
    await pill(checker, "まくり").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);

    await typeTab(checker, "進入").click();
    await boat(checker, 4).click();
    await pill(checker, "3コース以内に入る").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);

    await typeTab(checker, "配当の帯").click();
    await pill(checker, "中穴（1,000〜10,000円）").click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);

    await typeTab(checker, "スリット").click();
    await slitShape(checker, /カド一撃（4コース）/).click();
    await strength2(checker).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);

    await expect
      .poll(async () => (await readStore(page))?.entries?.length)
      .toBe(5);
    const byType = Object.fromEntries(
      (await readStore(page)).entries.map((e) => [e.type, e]),
    );
    expect(byType.boat1.input).toEqual({ outcome: "top3" });
    expect(byType.tenkai.input).toEqual({ boat: 4, technique: "makuri" });
    // 7.5% はどの線の候補でもラベルなし
    expect(byType.tenkai.result).toMatchObject({
      n: 800,
      count: 60,
      label: null,
    });
    expect(byType.entry.input).toEqual({ boat: 4, target: "within3" });
    expect(byType.payout.input).toEqual({ band: "mid" });
    expect(byType.payout.result).toMatchObject({ n: 760, count: 120 });
    expect(byType.payout.result.excluded.map((e) => e.count)).toEqual([40]);
    expect(typeof byType.payout.result.excluded[0].reason).toBe("string");
    expect(byType.slit.input).toEqual({
      mode: "pattern",
      patterns: ["kado"],
      level: 2,
    });
    expect(byType.slit.result).toMatchObject({
      n: 760,
      count: 60,
      label: null,
    });
    expect(byType.slit.result.excluded.map((e) => e.count)).toEqual([40]);
  });

  test("[spec FR-5] スリット2形は形のキーで保存する（2コース凹み d2・カド受け凹み d3）", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await typeTab(checker, "スリット").click();
    await slitShape(checker, /2コース凹み/).click();
    await slitShape(checker, /カド受け凹み（3コース）/).click();
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () => (await readStore(page))?.entries?.length)
      .toBe(1);
    const [entry] = (await readStore(page)).entries;
    expect(entry.input.mode).toBe("pattern");
    expect(entry.input.level).toBe(1);
    expect([...entry.input.patterns].sort()).toEqual(["d2", "d3"]);
  });

  test("[spec FR-5] 自分で作るは mode custom・courses（-1 凹む／0 指定なし／1 出る）で保存する", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await typeTab(checker, "スリット").click();
    await custom(checker).click();
    await courseBtn(checker, 4, "指定なし").click(); // 出る
    await courseBtn(checker, 1, "指定なし").click(); // 出る
    await courseBtn(checker, 1, "出る").click(); // 凹む
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () => (await readStore(page))?.entries?.length)
      .toBe(1);
    const [entry] = (await readStore(page)).entries;
    expect(entry.type).toBe("slit");
    expect(entry.input).toEqual({
      mode: "custom",
      courses: [-1, 0, 0, 1, 0, 0],
    });
  });

  test("[spec FR-5] 締切後に押しても結果は出るが保存しない", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    await page.clock.install({ time: afterDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    const store = await readStore(page);
    expect(
      (store?.entries ?? []).filter((e) => e.raceId === raceId),
    ).toHaveLength(0);
  });

  test("[spec FR-5] 書き込み時に savedAt から30日を過ぎた Entry を取り除く", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    const base = {
      type: "boat1",
      input: { outcome: "win" },
      snapshot: savedSnapshot({ modelVersion: "old" }),
      result: { n: 800, count: 400, excluded: [], label: "standard" },
    };
    await seedStoreOnce(page, {
      v: 1,
      entries: [
        {
          ...base,
          raceId: "2000-01-01-01-01",
          savedAt: new Date(now.getTime() - 31 * DAY).toISOString(),
        },
        {
          ...base,
          raceId: "2000-01-02-01-01",
          savedAt: new Date(now.getTime() - 29 * DAY).toISOString(),
        },
      ],
    });
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () =>
        (await readStore(page))?.entries?.map((e) => e.raceId).sort(),
      )
      .toEqual(["2000-01-02-01-01", raceId].sort());
  });

  test("[spec FR-5] AI予想タブの部品を表示しただけ（押す前）でも、30日を過ぎた Entry を取り除く", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    await seedStoreOnce(page, {
      v: 1,
      entries: [
        {
          raceId: "2000-01-01-01-01",
          type: "boat1",
          input: { outcome: "win" },
          savedAt: new Date(now.getTime() - 31 * DAY).toISOString(),
          snapshot: savedSnapshot({ modelVersion: "old" }),
          result: { n: 800, count: 400, excluded: [], label: "standard" },
        },
      ],
    });
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await expect(judgeButton(checker)).toBeVisible();
    await expect
      .poll(async () =>
        ((await readStore(page))?.entries ?? []).some(
          (e) => e.raceId === "2000-01-01-01-01",
        ),
      )
      .toBe(false);
  });

  test("[spec FR-5] 書き込みの直前に読み直す: 開いた後に別のタブで保存された分を消さない", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await expect(judgeButton(checker)).toBeVisible();
    // 別のタブで保存されたことにする（このページが開いた後に書かれた値）
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [
        STORAGE_KEY,
        JSON.stringify({
          v: 1,
          entries: [
            {
              raceId: "2000-01-03-01-01",
              type: "payout",
              input: { band: "high" },
              savedAt: new Date(now.getTime() - DAY).toISOString(),
              snapshot: savedSnapshot(),
              result: { n: 760, count: 340, excluded: [], label: "standard" },
            },
          ],
        }),
      ],
    );
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () =>
        (await readStore(page))?.entries?.map((e) => e.raceId).sort(),
      )
      .toEqual(["2000-01-03-01-01", raceId].sort());
  });

  test("[spec FR-5] 1,000件を超えたら savedAt の古いものから消す", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      raceId: `${new Date(Date.UTC(2000, 0, 1) + i * DAY).toISOString().slice(0, 10)}-01-01`,
      type: "boat1",
      input: { outcome: "win" },
      savedAt: new Date(now.getTime() - (1000 - i) * 60000).toISOString(),
      snapshot: savedSnapshot({ modelVersion: "old" }),
      result: { n: 800, count: 400, excluded: [], label: "standard" },
    }));
    const oldest = entries[0].raceId;
    await seedStoreOnce(page, { v: 1, entries });
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () =>
        (await readStore(page))?.entries?.some((e) => e.raceId === raceId),
      )
      .toBe(true);
    const store = await readStore(page);
    expect(store.entries).toHaveLength(1000);
    expect(store.entries.some((e) => e.raceId === oldest)).toBe(false);
  });

  test("[spec FR-5] localStorage が例外を投げても判定と結果の表示は動く", async ({
    page,
  }) => {
    await page.addInitScript((key) => {
      const origGet = Storage.prototype.getItem;
      const origSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k) {
        if (k === key) throw new DOMException("blocked", "SecurityError");
        return origGet.call(this, k);
      };
      Storage.prototype.setItem = function (k, v) {
        if (k === key) throw new DOMException("quota", "QuotaExceededError");
        return origSet.call(this, k, v);
      };
    }, STORAGE_KEY);
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
  });

  test("[spec FR-5] JSON として読めない保存値は捨てて作り直し、判定と結果の表示は動く", async ({
    page,
  }) => {
    await seedStoreOnce(page, "{not json");
    const raceId = anyRaceId();
    await page.clock.install({ time: beforeDeadline(raceId) });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await expect
      .poll(async () => {
        const raw = await page.evaluate(
          (key) => localStorage.getItem(key),
          STORAGE_KEY,
        );
        try {
          const v = JSON.parse(raw);
          return v?.v === 1 && v.entries.some((e) => e.raceId === raceId);
        } catch {
          return false;
        }
      })
      .toBe(true);
  });

  for (const [name, broken] of [
    ["v が違う", { v: 99, entries: [{ raceId: "x" }] }],
    ["entries が配列でない", { v: 1, entries: { raceId: "x" } }],
  ]) {
    test(`[spec FR-5] ${name}保存値は捨てて作り直す`, async ({ page }) => {
      await seedStoreOnce(page, broken);
      const raceId = anyRaceId();
      await page.clock.install({ time: beforeDeadline(raceId) });
      const checker = await openAiTab(page, raceId);
      await pickOrder(checker, 1, 2, 3);
      await judgeButton(checker).click();
      await expect(checker).toContainText(resultLine(800, 300, "37.5"));
      await expect.poll(async () => (await readStore(page))?.v).toBe(1);
      const store = await readStore(page);
      expect(Array.isArray(store.entries)).toBe(true);
      expect(store.entries.some((e) => e.raceId === "x")).toBe(false);
      expect(store.entries.some((e) => e.raceId === raceId)).toBe(true);
    });
  }

  test("[spec FR-5] 形の違う Entry（type が6つ以外・savedAt が読めない・input が型と合わない）はその Entry だけ捨てる", async ({
    page,
  }) => {
    const raceId = anyRaceId();
    const now = beforeDeadline(raceId);
    const valid = {
      raceId: "2000-01-05-01-01",
      type: "payout",
      input: { band: "low" },
      savedAt: new Date(now.getTime() - DAY).toISOString(),
      snapshot: savedSnapshot(),
      result: { n: 760, count: 300, excluded: [], label: "standard" },
    };
    await seedStoreOnce(page, {
      v: 1,
      entries: [
        valid,
        { ...valid, raceId: "2000-01-06-01-01", type: "foo" },
        { ...valid, raceId: "2000-01-07-01-01", savedAt: "not a time" },
        { ...valid, raceId: "2000-01-08-01-01", input: { outcome: "win" } },
      ],
    });
    await page.clock.install({ time: now });
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(ANY_RESULT);
    await expect
      .poll(async () =>
        (await readStore(page))?.entries?.map((e) => e.raceId).sort(),
      )
      .toEqual(["2000-01-05-01-01", raceId].sort());
  });
});

// =====================================================================
// 結果タブの振り返り（FR-4 発走後）
// =====================================================================
test.describe("結果タブ 振り返り", () => {
  // 確定済みのレースが要る。トップのリンク先がすべて未確定（朝の時間帯等）なら skip
  async function settledRace(page) {
    anyRaceId();
    const id = await findSettledRaceId(page);
    test.skip(
      id === null,
      "トップページから辿れる確定済みレースが無い（全レース発走前の時間帯）",
    );
    return id;
  }

  const entryOf = (raceId, type, input, result, snapshotOverride = {}) => ({
    raceId,
    type,
    input,
    // 当日 0:00 JST（締切前）に入れた予想とする
    savedAt: new Date(`${raceDate(raceId)}T00:00:00+09:00`).toISOString(),
    snapshot: savedSnapshot(snapshotOverride),
    result: { excluded: [], label: null, ...result },
  });

  async function seedAndOpenResult(page, raceId, entries) {
    if (entries !== null) {
      await page.evaluate(
        ([key, value]) => localStorage.setItem(key, value),
        [STORAGE_KEY, JSON.stringify({ v: 1, entries })],
      );
    } else {
      await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    }
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "結果").click();
    await expect(page.getByRole("heading", { name: "振り返り" })).toBeVisible();
  }

  // 振り返りのリスト（「決着」または「あなたの予想」の行を持つ list）
  const reviewList = (page) =>
    page
      .getByRole("list")
      .filter({
        has: page
          .getByRole("listitem")
          .filter({ hasText: /^\s*(決着|あなたの予想)/ }),
      });
  const reviewItems = (page) => reviewList(page).getByRole("listitem");

  test("[spec FR-4] 保存した予想を型の順に、保存した数字のまま出し、最後に決着の行を同じリストに出す", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    // わざと型の順と逆に保存する。数字は今の近傍から数えた値と変えておく
    await seedAndOpenResult(page, raceId, [
      entryOf(
        raceId,
        "payout",
        { band: "high" },
        { n: 760, count: 340, excluded: [{ reason: "payout", count: 40 }] },
      ),
      entryOf(raceId, "boat1", { outcome: "win" }, { n: 800, count: 421 }),
      entryOf(raceId, "order", ORDER_123, { n: 800, count: 123 }),
    ]);
    await expect(reviewList(page)).toHaveCount(1);
    const items = reviewItems(page);
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText(
      /あなたの予想\s*3連単 1-2-3（1点）\s*は、過去800レース中\s*123回\s*（15\.4%）/,
    );
    await expect(items.nth(1)).toContainText(
      /あなたの予想\s*1号艇が1着\s*は、過去800レース中\s*421回\s*（52\.6%）/,
    );
    await expect(items.nth(2)).toContainText(
      /あなたの予想\s*3連単が万舟（10,000円以上）\s*は、過去760レース中\s*340回\s*（44\.7%）/,
    );
    await expect(items.nth(3)).toContainText(/^\s*決着\s*\d-\d-\d\s*は、過去/);
  });

  test("[spec FR-4] 保存した予想の行は、保存したラベルを出す（今の線で付け直さない）", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    // 37.5% だが、保存したラベルはレア
    await seedAndOpenResult(page, raceId, [
      entryOf(raceId, "order", ORDER_123, {
        n: 800,
        count: 300,
        label: "rare",
      }),
      entryOf(
        raceId,
        "tenkai",
        { boat: 4, technique: "makuri" },
        {
          n: 800,
          count: 60,
          label: "standard",
        },
      ),
    ]);
    const items = reviewItems(page);
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(/（37\.5%）\s*レア/);
    await expect(items.nth(0)).not.toContainText("定番");
    await expect(items.nth(1)).toContainText(/4号艇のまくり/);
    await expect(items.nth(1)).toContainText(/（7\.5%）\s*定番/);
  });

  test("[spec FR-4] 決着の行は今の類似レースから着順の型（1点）と同じ数え方で数え、今の線でラベルを付ける", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await seedAndOpenResult(page, raceId, null);
    const row = reviewItems(page).filter({ hasText: /^\s*決着/ });
    test.skip(
      (await row.count()) === 0,
      "このレースは1〜3着がそろわない（返還艇が上位）ため決着の行が出ない",
    );
    await expect(row).toHaveCount(1);
    const text = await row.innerText();
    const m = text.match(/決着\s*(\d)-(\d)-(\d)/);
    expect(m, `決着の行に着順が無い: ${text}`).not.toBeNull();
    const c = countOrder(NEIGHBORS, Number(m[1]), Number(m[2]), Number(m[3]));
    const pNum = (c / 800) * 100;
    const p = pNum.toFixed(1);
    await expect(row).toContainText(resultLine(800, c, p));
    // 線の候補のどれでも結果が変わらない割合だけ確かめる
    if (pNum >= 25) await expect(row).toContainText("定番");
    if (pNum < 3) await expect(row).toContainText("レア");
    if (pNum >= 5 && pNum < 10) {
      await expect(row).not.toContainText("定番");
      await expect(row).not.toContainText("レア");
    }
  });

  test("[spec FR-4] 保存した予想が無い（別のレースの保存しか無い）ときは決着の行だけ出す", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await seedAndOpenResult(page, raceId, [
      entryOf("2000-01-01-01-01", "order", ORDER_123, { n: 800, count: 300 }),
    ]);
    await expect(
      reviewItems(page).filter({ hasText: /あなたの予想/ }),
    ).toHaveCount(0);
    await expect(reviewItems(page)).toHaveCount(1);
    await expect(reviewItems(page).first()).toContainText(/^\s*決着/);
  });

  test("[spec FR-4] savedAt が締切以降の Entry は振り返りに出さない", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    const late = entryOf(raceId, "order", ORDER_123, { n: 800, count: 300 });
    late.savedAt = afterDeadline(raceId).toISOString();
    const early = entryOf(
      raceId,
      "boat1",
      { outcome: "win" },
      {
        n: 800,
        count: 420,
      },
    );
    await seedAndOpenResult(page, raceId, [late, early]);
    const mine = reviewItems(page).filter({ hasText: /あなたの予想/ });
    await expect(mine).toHaveCount(1);
    await expect(mine.first()).toContainText("1号艇が1着");
    await expect(reviewList(page)).not.toContainText("3連単 1-2-3（1点）");
  });

  test("[spec FR-4/FR-5] 締切後にAI予想タブで入れた予想は振り返りに出ない", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
    // 確定済み＝締切後（実時刻）
    const checker = await openAiTab(page, raceId);
    await pickOrder(checker, 1, 2, 3);
    await judgeButton(checker).click();
    await expect(checker).toContainText(resultLine(800, 300, "37.5"));
    await tabLike(page, "結果").click();
    await expect(page.getByRole("heading", { name: "振り返り" })).toBeVisible();
    await expect(
      reviewItems(page).filter({ hasText: /あなたの予想/ }),
    ).toHaveCount(0);
  });

  test("[spec FR-4] 振り返りに当たり／外れの表示を付けない", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await seedAndOpenResult(page, raceId, [
      entryOf(raceId, "order", ORDER_123, { n: 800, count: 300 }),
    ]);
    await expect(
      reviewItems(page).filter({ hasText: /あなたの予想/ }),
    ).toHaveCount(1);
    await expect(reviewList(page)).not.toContainText(/当たり|外れ|的中|ハズレ/);
  });

  test("[spec FR-4] 保存時と今のスナップショットが違うと「入力したときと比べた類似レースが変わっています」を出す", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await seedAndOpenResult(page, raceId, [
      entryOf(
        raceId,
        "order",
        ORDER_123,
        { n: 800, count: 300 },
        { modelVersion: "older-model" },
      ),
    ]);
    await expect(
      page.getByText("入力したときと比べた類似レースが変わっています"),
    ).toBeVisible();
  });

  test("[spec FR-4] スナップショットが同じなら（asof_at の表記が Z と +00:00 で違っても）類似レースが変わった注記は出さない", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    await seedAndOpenResult(page, raceId, [
      entryOf(raceId, "order", ORDER_123, { n: 800, count: 300 }),
      entryOf(
        raceId,
        "boat1",
        { outcome: "win" },
        { n: 800, count: 420 },
        // RPC の asof_at は 2026-09-30T21:00:00.000Z
        { asofAt: "2026-09-30T21:00:00+00:00" },
      ),
    ]);
    await expect(
      reviewItems(page).filter({ hasText: /あなたの予想/ }),
    ).toHaveCount(2);
    await expect(
      page.getByText("入力したときと比べた類似レースが変わっています"),
    ).toHaveCount(0);
  });

  test("[spec FR-5] 30日を過ぎた保存は振り返りの読み込みで消え、振り返りに出ない", async ({
    page,
  }) => {
    await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    const old = entryOf(raceId, "order", ORDER_123, { n: 800, count: 300 });
    old.savedAt = new Date(Date.now() - 31 * DAY).toISOString();
    await seedAndOpenResult(page, raceId, [old]);
    await expect(
      reviewItems(page).filter({ hasText: /あなたの予想/ }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          ((await readStore(page))?.entries ?? []).filter(
            (e) => e.raceId === raceId,
          ).length,
      )
      .toBe(0);
  });

  test("[spec FR-4] 類似レースが0行のレースでは振り返りを出さない", async ({
    page,
  }) => {
    await mockNeighbors(page, []);
    const raceId = await settledRace(page);
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "結果").click();
    await expect(page.getByRole("heading", { name: "振り返り" })).toHaveCount(
      0,
    );
  });

  test("[spec FR-4] 近傍の取得に失敗したら、結果タブに再試行つきのエラーを出す", async ({
    page,
  }) => {
    const state = await mockNeighbors(page, NEIGHBORS);
    const raceId = await settledRace(page);
    state.fail = true;
    await page.goto(`/race/${raceId}`);
    await tabLike(page, "結果").click();
    const retry = page.getByRole("button", {
      name: /再試行|再読み込み|もう一度|retry/i,
    });
    await expect(retry.first()).toBeVisible();
    state.fail = false;
    await retry.first().click();
    await expect(page.getByRole("heading", { name: "振り返り" })).toBeVisible();
  });
});
