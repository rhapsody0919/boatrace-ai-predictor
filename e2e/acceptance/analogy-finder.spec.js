import { test, expect } from "../fixtures.js";

// BOA-271 アナロジー・ファインダー 受け入れE2E
// 入力: docs/design/analogy-finder/spec.md・screens.md のみ（plan/tasks/src は読んでいない）
// 対象: FR-1〜FR-3（FR-4 は BOA-635 に分離済みのため対象外）
// 画面の構造・操作要素は screens.md「画面の構造と操作要素（受け入れ E2E の前提）」の表に従う。
// import 元は録画の再生を通すため e2e/fixtures.js（ADR-0077、依頼元の指示）。

const SECTION_HEADING = "アナロジー・ファインダー";
const VIEW_TABS = ["寄与度", "類似レース", "組み合わせ"];
const THEMES = [
  "会場×枠・進入",
  "選手・基礎成績",
  "ST・直前情報",
  "機力",
  "環境",
  "選手・属性",
];
// spec FR-2。「文言は T0 で近傍の性質を測り直して確定する」とある（報告の曖昧点参照）
const SIMILAR_DESCRIPTION =
  "力関係（特に1号艇）と直近の調子が似たレース。同じ会場を優先";
const ACCIDENT_NOTE = "類似の判定には事故情報を含まない";
const DATA_TIER =
  /出走表\s*\d{1,2}:\d{2}\s*時点のデータ（前日までの成績）(（発走前）)?/;
const PERIOD = /\d{4}-\d{2}〜\d{4}-\d{2}/;
const FR1_N = /n=([\d,]+)レース（([\d,]+)艇）/;
const DOT_NAME = /^\d{4}-\d{2}-\d{2} .+ \d{1,2}R、近さ(\d+)位$/;
const BAND_12 = /^1着 ([1-6])号艇→2着 ([1-6])号艇 (\d+)件 (\d+(?:\.\d+)?)%$/;
const BAND_23 = /^2着 [1-6]号艇→3着 [1-6]号艇 \d+件 \d+(?:\.\d+)?%$/;
const COMBO = /[1-6]-[1-6]-[1-6]/;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boatai:cookie-consent", "accepted"),
  );
});

// レース詳細は /race/:raceId（screens.md）。レースIDを固定値で書かず、日別一覧 /races から辿る。
// /races のレースへのリンク名は仕様に無いため「NR」を含むリンクを仮定する（報告の曖昧点参照）
async function openRaceDetail(page) {
  await page.goto("/races");
  const raceLink = page.getByRole("link", { name: /\d{1,2}\s*R/ }).first();
  await expect(raceLink).toBeVisible();
  await raceLink.click();
  await expect(page).toHaveURL(/\/race\/[^/?#]+/);
}

function aiTabOf(page) {
  // タブ名「AI予想」（screens.md）。既存タブの role は仕様に無いので tab/button を許容する
  return page
    .getByRole("tab", { name: /AI予想/ })
    .or(page.getByRole("button", { name: /AI予想/ }))
    .first();
}

async function openAiPredictionTab(page) {
  const aiTab = aiTabOf(page);
  await expect(aiTab).toBeVisible();
  await aiTab.click();
}

function sectionOf(page) {
  // <section aria-labelledby> → 見出しで名前の付いた region
  return page.getByRole("region", { name: SECTION_HEADING });
}

async function openSection(page) {
  await openRaceDetail(page);
  await openAiPredictionTab(page);
  const section = sectionOf(page);
  await expect(section).toBeVisible();
  return section;
}

async function switchView(section, name) {
  const tab = section.getByRole("tab", { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

function countSlider(section) {
  return section.getByRole("slider", { name: "見る件数" });
}

async function setSliderToMin(page, section) {
  const slider = countSlider(section);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuetext", "近い順に100件");
}

async function readN(section) {
  const text = await section.innerText();
  const m = text.match(/n=([\d,]+)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

// ---------------------------------------------------------------------------
// S-1 節の配置・データ段・切り替え
// ---------------------------------------------------------------------------

test("[screens S-1/構造] AI予想タブに見出し（h2相当）「アナロジー・ファインダー」の節（region）が出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await expect(
    section.getByRole("heading", { name: SECTION_HEADING, level: 2 }),
  ).toBeVisible();
});

test("[spec 2段階の全体計画/screens S-1] 既存の展開予測・イン崩れ注意度は残り、節はその下にある", async ({
  page,
}) => {
  const section = await openSection(page);
  const heading = section.getByRole("heading", { name: SECTION_HEADING });
  const turn = page.getByText(/展開予測/).first();
  const volatility = page.getByText(/イン崩れ注意度/).first();
  // 節は予想の有無に関係なく出るが、既存ブロックは予想が無いレースでは出ない可能性がある
  test.skip(
    !(await turn.isVisible()) || !(await volatility.isVisible()),
    "このレースには既存の予想ブロックが無い（予想なしのレース）",
  );
  const hBox = await heading.boundingBox();
  const tBox = await turn.boundingBox();
  const vBox = await volatility.boundingBox();
  expect(hBox && tBox && vBox).toBeTruthy();
  expect(tBox.y).toBeLessThan(hBox.y);
  expect(vBox.y).toBeLessThan(hBox.y);
});

test("[screens S-1/構造] 見出しのすぐ下にデータ段「出走表 H:MM 時点のデータ（前日までの成績）」を1行で出す", async ({
  page,
}) => {
  const section = await openSection(page);
  const heading = section.getByRole("heading", { name: SECTION_HEADING });
  const tier = section.getByText(DATA_TIER).first();
  await expect(tier).toBeVisible();
  const hBox = await heading.boundingBox();
  const dBox = await tier.boundingBox();
  const tabBox = await section.getByRole("tablist").first().boundingBox();
  expect(hBox && dBox && tabBox).toBeTruthy();
  expect(dBox.y).toBeGreaterThan(hBox.y);
  expect(dBox.y).toBeLessThan(tabBox.y);
});

test("[spec MD-2 as-of/screens S-1] データ段は出走表時点の1段だけで、直前情報時点の段は出さない", async ({
  page,
}) => {
  const section = await openSection(page);
  await expect(section.getByText(DATA_TIER).first()).toBeVisible();
  await expect(
    section.getByText(/直前情報\s*\d{1,2}:\d{2}\s*時点/),
  ).toHaveCount(0);
  await expect(section.getByText(/時点のデータ/)).toHaveCount(1);
});

test("[screens S-1] 予想（predictions）の有無に関係なく節を出す（中止以外）", async ({
  page,
}) => {
  // 一覧の先頭から最大3レースを開き、中止でない限り節が出ることを確かめる
  await page.goto("/races");
  const links = page.getByRole("link", { name: /\d{1,2}\s*R/ });
  await expect(links.first()).toBeVisible();
  const total = Math.min(await links.count(), 3);
  for (let i = 0; i < total; i += 1) {
    await page.goto("/races");
    await page
      .getByRole("link", { name: /\d{1,2}\s*R/ })
      .nth(i)
      .click();
    await expect(page).toHaveURL(/\/race\/[^/?#]+/);
    await openAiPredictionTab(page);
    // 中止の表示文言は仕様に無いので「中止」を含むかで判定する
    const cancelled = await page.getByText(/中止/).first().isVisible();
    if (cancelled) continue;
    await expect(sectionOf(page)).toBeVisible();
  }
});

test("[screens S-1/構造] 3つの切り替えは tablist の tab「寄与度」「類似レース」「組み合わせ」で、各パネルに同名の見出し（h3相当）がある", async ({
  page,
}) => {
  const section = await openSection(page);
  await expect(section.getByRole("tablist").first()).toBeVisible();
  for (const name of VIEW_TABS) {
    await switchView(section, name);
    await expect(
      section.getByRole("heading", { name, exact: true, level: 3 }),
    ).toBeVisible();
  }
});

test("[spec 位置づけ] 「AI がやらないこと」のような説明文を足さない", async ({
  page,
}) => {
  const section = await openSection(page);
  for (const name of VIEW_TABS) {
    await switchView(section, name);
    await expect(section.getByText(/AI\s*がやらないこと/)).toHaveCount(0);
  }
});

test("[spec 非機能要件] 節の中に「競艇」の表記が無い", async ({ page }) => {
  const section = await openSection(page);
  for (const name of VIEW_TABS) {
    await switchView(section, name);
    expect(await section.innerText()).not.toContain("競艇");
  }
});

// ---------------------------------------------------------------------------
// FR-1 寄与度
// ---------------------------------------------------------------------------

test("[spec FR-1] 6テーマが押せる項目として出て、「市場」テーマは出ない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  for (const theme of THEMES) {
    await expect(
      section
        .getByRole("button", { name: new RegExp(escapeRe(theme)) })
        .first(),
    ).toBeVisible();
  }
  // MD-3: 「市場」は今は外す（再判定で採れたら7番目に足す）
  await expect(section.getByRole("button", { name: /市場/ })).toHaveCount(0);
  await expect(section.getByText(/^市場$/)).toHaveCount(0);
});

test("[spec FR-1 受入基準] 総合点（0〜100 のAI指数等）を表示しない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  expect(await section.innerText()).not.toMatch(/AI指数|総合点|総合スコア/);
});

test("[screens 構造] 着順タブ「1着」「2着以内」「3着以内」がある", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  for (const name of ["1着", "2着以内", "3着以内"]) {
    await expect(section.getByRole("tab", { name, exact: true })).toBeVisible();
  }
});

test("[spec FR-1 受入基準] 着順の切り替えでシェアと n が変わる", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await section.getByRole("tab", { name: "1着", exact: true }).click();
  const before = await section.innerText();
  await section.getByRole("tab", { name: "3着以内", exact: true }).click();
  await expect.poll(async () => section.innerText()).not.toBe(before);
});

test("[screens 構造] 詳細条件（details/summary）の中にグレード・ラウンドの select があり、閉じていても DOM にある", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await expect(section.getByText("詳細条件", { exact: true })).toBeVisible();
  const grade = section.getByLabel("グレード", { exact: true });
  const round = section.getByLabel("ラウンド", { exact: true });
  await expect(grade).toBeAttached();
  await expect(round).toBeAttached();
  for (const g of ["一般", "G3", "G2", "G1", "SG"]) {
    await expect(
      grade.getByRole("option", { name: g, exact: true }),
    ).toBeAttached();
  }
  for (const r of ["予選", "準優勝戦", "優勝戦", "その他"]) {
    await expect(
      round.getByRole("option", { name: r, exact: true }),
    ).toBeAttached();
  }
});

test("[spec FR-1 受入基準] グレード・ラウンドの切り替えでシェアと n が変わる", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await section.getByText("詳細条件", { exact: true }).click();
  const grade = section.getByLabel("グレード", { exact: true });
  const round = section.getByLabel("ラウンド", { exact: true });

  await grade.selectOption({ label: "一般" });
  const before = await section.innerText();
  await grade.selectOption({ label: "SG" });
  await expect.poll(async () => section.innerText()).not.toBe(before);

  await round.selectOption({ label: "予選" });
  const afterGrade = await section.innerText();
  await round.selectOption({ label: "優勝戦" });
  await expect.poll(async () => section.innerText()).not.toBe(afterGrade);
});

test("[spec FR-1/screens n の表記] n「n=1,234レース（7,404艇）」・期間「YYYY-MM〜YYYY-MM」・モデル版「モデル YYYY-MM-DD」を出す", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await expect(section.getByText(FR1_N).first()).toBeVisible();
  await expect(section.getByText(PERIOD).first()).toBeVisible();
  await expect(
    section.getByText(/モデル \d{4}-\d{2}-\d{2}/).first(),
  ).toBeVisible();
});

test("[spec FR-1/screens 小標本] n（レース数）<30 のときだけ「小標本」を出す", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await section.getByText("詳細条件", { exact: true }).click();
  // n が小さくなりやすい SG×優勝戦 に絞る
  await section
    .getByLabel("グレード", { exact: true })
    .selectOption({ label: "SG" });
  await section
    .getByLabel("ラウンド", { exact: true })
    .selectOption({ label: "優勝戦" });
  const nText = section.getByText(FR1_N).first();
  await expect(nText).toBeVisible();
  const m = (await nText.innerText()).match(FR1_N);
  const races = Number(m[1].replace(/,/g, ""));
  if (races < 30) {
    await expect(section.getByText("小標本").first()).toBeVisible();
  } else {
    await expect(section.getByText("小標本")).toHaveCount(0);
  }
});

test("[spec FR-1 受入基準/screens 艇番比較] 「艇番で比較」をオンにすると既定 1号艇・6号艇 の比較表（テーマ／艇番A／艇番B）が出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  const compare = section.getByRole("checkbox", { name: "艇番で比較" });
  await expect(compare).toBeAttached();
  await compare.check();
  const selectA = section.getByLabel("艇番A", { exact: true });
  const selectB = section.getByLabel("艇番B", { exact: true });
  await expect(selectA).toBeVisible();
  await expect(selectB).toBeVisible();
  const selectedText = (loc) =>
    loc.evaluate((el) => el.selectedOptions[0]?.textContent ?? "");
  expect(await selectedText(selectA)).toMatch(/1/);
  expect(await selectedText(selectB)).toMatch(/6/);

  const table = section.getByRole("table").filter({
    has: page.getByRole("columnheader", { name: /テーマ/ }),
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  for (const theme of THEMES) {
    const row = table.getByRole("row").filter({ hasText: theme });
    await expect(row).toBeVisible();
    const cells = await row.getByRole("cell").allInnerTexts();
    expect(cells).toHaveLength(3);
    expect(cells[1]).toMatch(/\d/);
    expect(cells[2]).toMatch(/\d/);
  }
});

test("[spec FR-1 受入基準/screens テーマの内訳] テーマのボタンを押すと aria-expanded が true になり「個別の値は参考」が出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  const theme = section.getByRole("button", { name: /選手・基礎成績/ }).first();
  await expect(theme).toHaveAttribute("aria-expanded", "false");
  await theme.click();
  await expect(theme).toHaveAttribute("aria-expanded", "true");
  await expect(section.getByText(/個別の値は参考/).first()).toBeVisible();
});

test("[screens S-1] 件数スライダーは①寄与度では隠れ、②類似レース・③組み合わせで出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "寄与度");
  await expect(countSlider(section)).toBeHidden();
  await switchView(section, "類似レース");
  await expect(countSlider(section)).toBeVisible();
  await switchView(section, "組み合わせ");
  await expect(countSlider(section)).toBeVisible();
});

// ---------------------------------------------------------------------------
// FR-2 類似レース
// ---------------------------------------------------------------------------

test("[spec FR-2] 見出し「類似レース」の下に何が似ているかを一行で出し、「展示の差」は言わない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  await expect(
    section.getByRole("heading", { name: "類似レース", exact: true }),
  ).toBeVisible();
  await expect(section.getByText(SIMILAR_DESCRIPTION).first()).toBeVisible();
  // 近傍の距離に展示を入れないため「展示の差」は外した
  await expect(section.getByText(/展示の差/)).toHaveCount(0);
});

test("[spec FR-2] 常設の注記「類似の判定には事故情報を含まない」が出て、進入コースの注記は出ない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  await expect(section.getByText(ACCIDENT_NOTE).first()).toBeVisible();
  // v5 の「枠・進入コース・事故情報を含まない」は削除
  await expect(
    section.getByText(/進入コース[^。]*を含まない|枠・進入コース/),
  ).toHaveCount(0);
});

test("[spec FR-2/screens 分布] 見出し「決まり手」「1着の艇番」「1着の進入コース」「よく出た出目」の4ブロックが出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  for (const name of [
    "決まり手",
    "1着の艇番",
    "1着の進入コース",
    "よく出た出目",
  ]) {
    await expect(
      section.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
});

test("[spec FR-2/screens n の表記] 各分布ブロックに「n=800」と期間が添えられる（既定800件）", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  // 4ブロックそれぞれに n と期間がある
  expect(await section.getByText(/n=800(?!\d)/).count()).toBeGreaterThanOrEqual(
    4,
  );
  expect(await section.getByText(PERIOD).count()).toBeGreaterThanOrEqual(4);
});

test("[spec FR-2 受入基準] 階級ラベル（鉄板級／有力／混戦／大混戦／まだ参考程度）を出さない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  const text = await section.innerText();
  for (const label of ["鉄板級", "有力", "混戦", "まだ参考程度"]) {
    expect(text).not.toContain(label);
  }
  for (const emoji of ["🔥", "📌", "⚖️", "🌊", "🌀"]) {
    expect(text).not.toContain(emoji);
  }
});

test("[spec FR-2/screens 件数スライダー] ラベル「見る件数」の 0〜3 の4段で、既定は「近い順に800件」、横に「800件」", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  const slider = countSlider(section);
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "3");
  await expect(slider).toHaveValue("3");
  await expect(slider).toHaveAttribute("aria-valuetext", "近い順に800件");
  await expect(
    section.getByText("800件", { exact: true }).first(),
  ).toBeVisible();

  // 4段: 100／200／400／800件
  await slider.focus();
  await page.keyboard.press("Home");
  for (const n of [100, 200, 400, 800]) {
    await expect(slider).toHaveAttribute("aria-valuetext", `近い順に${n}件`);
    await expect(
      section.getByText(`${n}件`, { exact: true }).first(),
    ).toBeVisible();
    if (n !== 800) await page.keyboard.press("ArrowRight");
  }
});

test("[spec FR-2] 類似度%（65〜95%）の尺度は出さない", async ({ page }) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  await expect(section.getByText(/類似度\s*\d+\s*%/)).toHaveCount(0);
});

test("[spec FR-2 受入基準] 件数を100件に絞ると、件数・分布・n が連動して n=100 になる", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  const before = await section.innerText();
  await setSliderToMin(page, section);
  await expect(
    section.getByText("100件", { exact: true }).first(),
  ).toBeVisible();
  await expect(section.getByText(/n=800(?!\d)/)).toHaveCount(0);
  expect(await section.getByText(/n=100(?!\d)/).count()).toBeGreaterThanOrEqual(
    4,
  );
  await expect.poll(async () => section.innerText()).not.toBe(before);
});

test("[spec FR-2/screens 光点] 光点は「YYYY-MM-DD 会場 NR、近さN位」の名前を持ち、件数を絞ると N 件以内の光点だけになる", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  const dots = section.getByRole("button", { name: DOT_NAME });
  await expect(dots.first()).toBeVisible();
  await setSliderToMin(page, section);
  await expect.poll(async () => dots.count()).toBeGreaterThan(0);
  expect(await dots.count()).toBeLessThanOrEqual(100);
  const names = await dots.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  for (const name of names) {
    const m = name.match(DOT_NAME);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBeLessThanOrEqual(100);
  }
});

test('[spec FR-2 受入基準/screens 光点・一覧行] 光点を押すと対応する一覧行が aria-current="true" になり、一覧行を押すとその行が選ばれる', async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  const dots = section.getByRole("button", { name: DOT_NAME });
  await expect(dots.first()).toBeVisible();

  const rows = (date) =>
    section
      .getByRole("row")
      .or(section.getByRole("listitem"))
      .filter({ hasText: date });

  // 光点 → 一覧行
  const dot = dots.first();
  const label = (await dot.getAttribute("aria-label")) ?? "";
  const date = label.slice(0, 10);
  await dot.click();
  await expect(rows(date).first()).toHaveAttribute("aria-current", "true");

  // 一覧行 → 選択（別の光点の行を押す）
  const otherDot = dots.nth(1);
  const otherLabel = (await otherDot.getAttribute("aria-label")) ?? "";
  const otherDate = otherLabel.slice(0, 10);
  test.skip(
    otherDate === date,
    "先頭2件の光点が同じ日付で一覧行を区別できない",
  );
  const otherRow = rows(otherDate).first();
  await otherRow.click();
  await expect(otherRow).toHaveAttribute("aria-current", "true");
  await expect(rows(date).first()).not.toHaveAttribute("aria-current", "true");
});

test("[spec 制約・前提/screens NeighborCountSlider] 件数スライダーの設定は再読み込み後も保持される（端末内に保存）", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  await setSliderToMin(page, section);
  await page.reload();
  await openAiPredictionTab(page);
  const reloaded = sectionOf(page);
  await switchView(reloaded, "類似レース");
  await expect(countSlider(reloaded)).toHaveAttribute(
    "aria-valuetext",
    "近い順に100件",
  );
});

// ---------------------------------------------------------------------------
// FR-3 組み合わせ構造
// ---------------------------------------------------------------------------

test("[spec FR-3/screens S-1] 件数スライダーは②③共通で、②で絞った件数が③にも効き n=100 になる", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "類似レース");
  await setSliderToMin(page, section);
  await switchView(section, "組み合わせ");
  await expect(countSlider(section)).toHaveAttribute(
    "aria-valuetext",
    "近い順に100件",
  );
  await expect(section.getByText(/n=100(?!\d)/).first()).toBeVisible();
  await expect(section.getByText(/n=800(?!\d)/)).toHaveCount(0);
});

test("[spec FR-3/screens n の表記] 図の下に全体の n「n=800」を出す", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  await expect(section.getByText(/n=800(?!\d)/).first()).toBeVisible();
});

test("[spec FR-3 受入基準] サンキーは1着→2着→3着の3段が常に出る（1→2 と 2→3 の帯がある）", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  await expect(
    section.getByRole("button", { name: BAND_12 }).first(),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: BAND_23 }).first(),
  ).toBeAttached();
  // 件数を最小に絞っても3段が出る
  await setSliderToMin(page, section);
  await expect(
    section.getByRole("button", { name: BAND_23 }).first(),
  ).toBeAttached();
});

test("[spec FR-3/screens サンキーの帯] 帯を押すと「1着 X号艇→2着 Y号艇 N件 P%」と同じ文言が図の下に出る", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  const band = section.getByRole("button", { name: BAND_12 }).first();
  await expect(band).toBeVisible();
  const label = (await band.getAttribute("aria-label")) ?? "";
  await band.click();
  await expect(section.getByText(label, { exact: true }).first()).toBeVisible();
});

test("[spec FR-3] 帯の件数と%が整合し（%=件数÷n）、少ない流れも「その他」にまとめない", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  const n = await readN(section);
  expect(n).toBeTruthy();
  const bands = section.getByRole("button", { name: BAND_12 });
  await expect(bands.first()).toBeVisible();
  const labels = await bands.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label") ?? ""),
  );
  let sum = 0;
  for (const label of labels) {
    const m = label.match(BAND_12);
    const count = Number(m[3]);
    const pct = Number(m[4]);
    sum += count;
    expect(Math.abs(pct - (count / n) * 100)).toBeLessThanOrEqual(0.1);
  }
  expect(sum).toBeLessThanOrEqual(n);
  // 帯に「その他」へのまとめは無い
  await expect(section.getByRole("button", { name: /その他/ })).toHaveCount(0);
});

test("[spec FR-3/screens 組み合わせ一覧] 上位10件と「その他」の1行で、シェア%の合計が100%（丸め誤差を除く）", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  const rowsOf = (pattern) =>
    section
      .getByRole("row")
      .or(section.getByRole("listitem"))
      .filter({ hasText: pattern });
  const comboRows = rowsOf(COMBO);
  const otherRows = rowsOf(/その他/);
  await expect(comboRows.first()).toBeVisible();
  const comboCount = await comboRows.count();
  expect(comboCount).toBeGreaterThan(0);
  expect(comboCount).toBeLessThanOrEqual(10);
  await expect(otherRows).toHaveCount(1);

  const texts = [
    ...(await comboRows.allInnerTexts()),
    ...(await otherRows.allInnerTexts()),
  ];
  let total = 0;
  for (const t of texts) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
    expect(m, `シェア%が無い行: ${t}`).toBeTruthy();
    total += Number(m[1]);
  }
  expect(total).toBeGreaterThanOrEqual(99);
  expect(total).toBeLessThanOrEqual(101);
});

test("[spec FR-3/screens 1号艇以外の切り替え] 「1号艇以外が1着のレースだけ」を押すと aria-pressed が true になり、1号艇1着の帯・組み合わせが消える", async ({
  page,
}) => {
  const section = await openSection(page);
  await switchView(section, "組み合わせ");
  const toggle = section.getByRole("button", {
    name: "1号艇以外が1着のレースだけ",
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(
    section.getByRole("button", { name: /^1着 1号艇→/ }),
  ).toHaveCount(0);
  const comboTexts = await section
    .getByRole("row")
    .or(section.getByRole("listitem"))
    .filter({ hasText: COMBO })
    .allInnerTexts();
  expect(comboTexts.some((t) => /(^|\D)1-[2-6]-[2-6]/.test(t))).toBe(false);
});

// ---------------------------------------------------------------------------
// 非機能要件
// ---------------------------------------------------------------------------

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("[spec 非機能要件] 375px で3つの切り替えのどれでも横スクロールが出ない", async ({
    page,
  }) => {
    const section = await openSection(page);
    for (const name of VIEW_TABS) {
      await switchView(section, name);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
