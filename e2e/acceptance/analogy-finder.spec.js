import { test, expect } from "@playwright/test";

// BOA-271 アナロジー・ファインダー 受け入れE2E
// 入力: docs/design/analogy-finder/spec.md・screens.md のみ（plan/tasks/src は読んでいない）
// 対象: FR-1〜FR-3（FR-4 は BOA-635 に分離済みのため対象外）
// FR-2 の絞り込みは「近い順に100／200／400／800件、既定800」の件数スライダーを前提にする
// （spec FR-2・MD-6。screens.md の SimilarityThreshold「65〜95%」は旧案として扱う）

const SECTION_HEADING = "アナロジー・ファインダー";
const THEMES = [
  "会場×枠・進入",
  "選手・基礎成績",
  "ST・直前情報",
  "機力",
  "環境",
  "選手・属性",
];
const SIMILAR_DESCRIPTION =
  "力関係（特に1号艇）と展示の差が似たレース。同じ会場を優先";
const ACCIDENT_NOTE = "類似の判定には事故情報を含まない";
const COUNT_STEPS = ["100", "200", "400", "800"];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("boatai:cookie-consent", "accepted"),
  );
});

// spec・screens にレース詳細のURLは書かれていない。spec にある /races（日別一覧）から
// レース詳細へ辿る。レースへのリンク名は仕様に無いため「NR」を含むリンクを仮定する（報告の曖昧点参照）
async function openAiPredictionTab(page) {
  await page.goto("/races");
  const raceLink = page.getByRole("link", { name: /\d{1,2}\s*R/ }).first();
  await expect(raceLink).toBeVisible();
  await raceLink.click();
  await expect(page).not.toHaveURL(/\/races\/?(\?.*)?$/);
  const aiTab = page
    .getByRole("tab", { name: /AI予想/ })
    .or(page.getByRole("button", { name: /AI予想/ }))
    .first();
  await expect(aiTab).toBeVisible();
  await aiTab.click();
}

// 節の範囲。見出し「アナロジー・ファインダー」で名前の付いた region を前提にする
// （DOM構造・タグに依存しないため。仕様に構造の記述は無い。報告の曖昧点参照）
function sectionOf(page) {
  return page.getByRole("region", { name: SECTION_HEADING });
}

async function openSection(page) {
  await openAiPredictionTab(page);
  const heading = page.getByRole("heading", { name: SECTION_HEADING });
  await expect(heading).toBeVisible();
  return heading;
}

// 切り替え（①寄与度 ②類似レース ③組み合わせ）の役割は仕様に無いので tab/button/radio を許容する
function control(scope, name) {
  return scope
    .getByRole("tab", { name })
    .or(scope.getByRole("button", { name }))
    .or(scope.getByRole("radio", { name }))
    .first();
}

async function switchView(page, name) {
  const c = control(sectionOf(page), name);
  await expect(c).toBeVisible();
  await c.click();
}

function countSlider(page) {
  return sectionOf(page).getByRole("slider").first();
}

// ---------------------------------------------------------------------------
// S-1 節の配置
// ---------------------------------------------------------------------------

test("[screens S-1] AI予想タブにアナロジー・ファインダー節が出る", async ({
  page,
}) => {
  const heading = await openSection(page);
  await expect(heading).toBeVisible();
});

test("[spec 2段階の全体計画/やらないこと] 既存の展開予測・イン崩れ注意度は残り、節はその下にある", async ({
  page,
}) => {
  const heading = await openSection(page);
  const turn = page.getByText(/展開予測/).first();
  const volatility = page.getByText(/イン崩れ注意度/).first();
  await expect(turn).toBeVisible();
  await expect(volatility).toBeVisible();
  const hBox = await heading.boundingBox();
  const tBox = await turn.boundingBox();
  const vBox = await volatility.boundingBox();
  expect(hBox && tBox && vBox).toBeTruthy();
  expect(tBox.y).toBeLessThan(hBox.y);
  expect(vBox.y).toBeLessThan(hBox.y);
});

test("[screens S-1] 節の見出しの下にデータ段（出走表／直前情報 の時刻）を1行で出す", async ({
  page,
}) => {
  await openSection(page);
  await expect(
    page.getByText(/(出走表|直前情報)\s*\d{1,2}:\d{2}\s*時点のデータ/).first(),
  ).toBeVisible();
});

test("[screens S-1] 節の中に ①寄与度 ②類似レース ③組み合わせ の3つの切り替えがある", async ({
  page,
}) => {
  await openSection(page);
  await expect(control(sectionOf(page), /寄与度/)).toBeVisible();
  await expect(control(sectionOf(page), /類似レース/)).toBeVisible();
  await expect(control(sectionOf(page), /組み合わせ/)).toBeVisible();
});

test("[spec 位置づけ] 「AI がやらないこと」のような説明文を足さない", async ({
  page,
}) => {
  await openSection(page);
  await expect(page.getByText(/AI\s*がやらないこと/)).toHaveCount(0);
});

test("[spec 非機能要件] 節の中に「競艇」の表記が無い", async ({ page }) => {
  await openSection(page);
  for (const view of [/寄与度/, /類似レース/, /組み合わせ/]) {
    await switchView(page, view);
    const text = await sectionOf(page).innerText();
    expect(text).not.toContain("競艇");
  }
});

// ---------------------------------------------------------------------------
// FR-1 寄与度
// ---------------------------------------------------------------------------

test("[spec FR-1] 6テーマが表示され、「市場」テーマは出ない", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  for (const theme of THEMES) {
    await expect(page.getByText(theme, { exact: false }).first()).toBeVisible();
  }
  // MD-3: 「市場」は今は外す（再判定で採れたら7番目に足す）
  await expect(sectionOf(page).getByText(/^市場$/)).toHaveCount(0);
});

test("[spec FR-1] 総合点（0〜100 のAI指数等）を表示しない", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const text = await sectionOf(page).innerText();
  expect(text).not.toMatch(/AI指数|総合点|総合スコア/);
});

test("[spec FR-1] 着順タブ（1着／2着以内／3着以内）がある", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  await expect(control(sectionOf(page), /^1着$/)).toBeVisible();
  await expect(control(sectionOf(page), /2着以内/)).toBeVisible();
  await expect(control(sectionOf(page), /3着以内/)).toBeVisible();
});

test("[spec FR-1 受入基準] 着順の切り替えでシェアと n が変わる", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const section = sectionOf(page);
  await control(sectionOf(page), /^1着$/).click();
  const before = await section.innerText();
  await control(sectionOf(page), /3着以内/).click();
  await expect.poll(async () => section.innerText()).not.toBe(before);
});

test("[spec FR-1/screens] 詳細条件にグレード（一般/G3/G2/G1/SG）とラウンド（予選/準優勝戦/優勝戦/その他）のフィルタがある", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const details = page.getByRole("button", { name: /詳細条件/ });
  if (await details.isVisible()) await details.click();
  for (const g of ["一般", "G3", "G2", "G1", "SG"]) {
    await expect(
      control(sectionOf(page), new RegExp(`^${g}$`))
        .or(sectionOf(page).getByRole("option", { name: g }))
        .first(),
    ).toBeAttached();
  }
  for (const r of ["予選", "準優勝戦", "優勝戦", "その他"]) {
    await expect(
      control(sectionOf(page), new RegExp(`^${r}$`))
        .or(sectionOf(page).getByRole("option", { name: r }))
        .first(),
    ).toBeAttached();
  }
});

test("[spec FR-1 受入基準] グレード・ラウンドの切り替えでシェアと n が変わる", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const details = page.getByRole("button", { name: /詳細条件/ });
  if (await details.isVisible()) await details.click();
  const section = sectionOf(page);

  const before = await section.innerText();
  const sg = control(section, /^SG$/);
  await sg.click();
  await expect.poll(async () => section.innerText()).not.toBe(before);

  const afterGrade = await section.innerText();
  const final = control(section, /^優勝戦$/);
  await final.click();
  await expect.poll(async () => section.innerText()).not.toBe(afterGrade);
});

test("[spec FR-1] n（艇数・レース数）・集計期間・モデル版を常に表示する", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const text = await sectionOf(page).innerText();
  expect(text).toMatch(/n\s*[=＝]\s*[\d,]+|[\d,]+\s*(艇|レース)/);
  expect(text).toMatch(/期間|\d{4}[-/.年]\d{1,2}/);
  expect(text).toMatch(/モデル/);
});

test("[spec FR-1] n<30 のとき「小標本」フラグを出す", async ({ page }) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const details = page.getByRole("button", { name: /詳細条件/ });
  if (await details.isVisible()) await details.click();
  const section = sectionOf(page);
  // n が小さくなりやすい SG×優勝戦 に絞る
  await control(section, /^SG$/).click();
  await control(section, /^優勝戦$/).click();
  const text = await section.innerText();
  const m = text.match(/n\s*[=＝]\s*([\d,]+)/);
  test.skip(!m, "n の数値表記を読み取れない（表示形式は仕様に無い）");
  const n = Number(m[1].replace(/,/g, ""));
  if (n < 30) {
    await expect(section.getByText(/小標本/).first()).toBeVisible();
  } else {
    await expect(section.getByText(/小標本/)).toHaveCount(0);
  }
});

test("[spec FR-1 受入基準] 艇番比較の比較表に テーマ／艇番A／艇番B の値が並ぶ", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const details = page.getByRole("button", { name: /詳細条件/ });
  if (await details.isVisible()) await details.click();
  const compare = page
    .getByRole("button", { name: /艇番比較/ })
    .or(page.getByRole("checkbox", { name: /艇番比較/ }))
    .or(page.getByRole("switch", { name: /艇番比較/ }))
    .first();
  if (await compare.isVisible()) await compare.click();
  const table = page.getByRole("table").filter({
    has: page.getByRole("columnheader", { name: /テーマ/ }),
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  for (const theme of THEMES) {
    const row = table.getByRole("row").filter({ hasText: theme });
    await expect(row).toBeVisible();
    // テーマ名＋両艇番の数値
    await expect(row.getByRole("cell")).toHaveCount(3);
    const cells = await row.getByRole("cell").allInnerTexts();
    expect(cells[1]).toMatch(/\d/);
    expect(cells[2]).toMatch(/\d/);
  }
});

test("[spec FR-1 受入基準] テーマを押すと個別項目の内訳が開き、個別値は参考である旨が出る", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  const theme = page.getByRole("button", { name: /選手・基礎成績/ }).first();
  await expect(theme).toBeVisible();
  const before = await sectionOf(page).innerText();
  await theme.click();
  await expect.poll(async () => sectionOf(page).innerText()).not.toBe(before);
  await expect(sectionOf(page).getByText(/参考/).first()).toBeVisible();
});

test("[screens S-1] 件数スライダーは①寄与度では隠れ、②類似レース・③組み合わせで出る", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /寄与度/);
  await expect(sectionOf(page).getByRole("slider")).toHaveCount(0);
  await switchView(page, /類似レース/);
  await expect(countSlider(page)).toBeVisible();
  await switchView(page, /組み合わせ/);
  await expect(countSlider(page)).toBeVisible();
});

// ---------------------------------------------------------------------------
// FR-2 類似レース
// ---------------------------------------------------------------------------

test("[spec FR-2] 見出し「類似レース」の下に何が似ているかの一行説明が出る", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  await expect(
    page.getByRole("heading", { name: /類似レース/ }).first(),
  ).toBeVisible();
  await expect(page.getByText(SIMILAR_DESCRIPTION).first()).toBeVisible();
});

test("[spec FR-2] 常設の注記「類似の判定には事故情報を含まない」が出て、進入コースの注記は出ない", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  await expect(page.getByText(ACCIDENT_NOTE).first()).toBeVisible();
  // v5 の「枠・進入コース・事故情報を含まない」は削除
  await expect(
    page.getByText(/進入コース[^。]*を含まない|枠・進入コース/),
  ).toHaveCount(0);
});

test("[spec FR-2] 決まり手・1着艇・1着の進入コース・頻出出目トップ3 の4つの分布が出る", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const section = sectionOf(page);
  await expect(section.getByText(/決まり手/).first()).toBeVisible();
  await expect(section.getByText(/1着艇/).first()).toBeVisible();
  await expect(section.getByText(/1着の進入コース/).first()).toBeVisible();
  await expect(section.getByText(/出目/).first()).toBeVisible();
});

test("[spec FR-2] それぞれの分布に n と期間が添えられる", async ({ page }) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const text = await sectionOf(page).innerText();
  expect(text).toMatch(/n\s*[=＝]\s*[\d,]+|[\d,]+\s*(件|レース)/);
  expect(text).toMatch(/期間|\d{4}[-/.年]\d{1,2}/);
});

test("[spec FR-2] 階級ラベル（鉄板級／有力／混戦／大混戦／まだ参考程度）を出さない", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const text = await sectionOf(page).innerText();
  for (const label of ["鉄板級", "有力", "大混戦", "混戦", "まだ参考程度"]) {
    expect(text).not.toContain(label);
  }
  for (const emoji of ["🔥", "📌", "⚖️", "🌊", "🌀"]) {
    expect(text).not.toContain(emoji);
  }
});

test("[spec FR-2] 件数スライダーは 100／200／400／800件 で既定は800件", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const slider = countSlider(page);
  await expect(slider).toBeVisible();
  // 値の持ち方（800そのもの／4段階の添字3）は仕様に無いので両方を許容する
  const value =
    (await slider.getAttribute("aria-valuetext")) ??
    (await slider.getAttribute("aria-valuenow"));
  expect(value).toMatch(/800|^3$/);
  for (const step of COUNT_STEPS) {
    await expect(
      sectionOf(page)
        .getByText(new RegExp(`${step}\\s*件`))
        .first(),
    ).toBeAttached();
  }
});

test("[spec FR-2] 類似度%（65〜95%）のスライダーは出さない", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  await expect(page.getByText(/類似度\s*\d+\s*%/)).toHaveCount(0);
  const slider = countSlider(page);
  await expect(slider).not.toHaveAttribute("aria-valuemax", "95");
});

test("[spec FR-2 受入基準] 件数を絞ると件数・分布・n が連動して変わる", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const section = sectionOf(page);
  const before = await section.innerText();
  const slider = countSlider(page);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => section.innerText()).not.toBe(before);
  await expect(section.getByText(/100\s*件/).first()).toBeVisible();
});

test("[spec FR-2] 類似レース一覧が出る", async ({ page }) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const section = sectionOf(page);
  const items = section
    .getByRole("listitem")
    .or(section.getByRole("row"))
    .or(section.getByRole("link"));
  expect(await items.count()).toBeGreaterThan(0);
});

test("[spec 制約・前提] 件数スライダーの設定は再読み込み後も保持される（localStorage）", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /類似レース/);
  const slider = countSlider(page);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(
    sectionOf(page)
      .getByText(/100\s*件/)
      .first(),
  ).toBeVisible();
  await page.reload();
  const aiTab = page
    .getByRole("tab", { name: /AI予想/ })
    .or(page.getByRole("button", { name: /AI予想/ }))
    .first();
  if (await aiTab.isVisible()) await aiTab.click();
  await switchView(page, /類似レース/);
  const reloaded = countSlider(page);
  await expect(reloaded).toBeVisible();
  const valueText =
    (await reloaded.getAttribute("aria-valuetext")) ??
    (await reloaded.getAttribute("aria-valuenow"));
  expect(valueText).toMatch(/^(100|0)$|100/);
});

// ---------------------------------------------------------------------------
// FR-3 組み合わせ構造
// ---------------------------------------------------------------------------

test("[spec FR-3] 組み合わせ別の発生率一覧は上位10件まで、組み合わせ・シェア%・n を持つ", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /組み合わせ/);
  const section = sectionOf(page);
  const comboRows = section
    .getByRole("row")
    .or(section.getByRole("listitem"))
    .filter({ hasText: /[1-6]\s*-\s*[1-6]\s*-\s*[1-6]/ });
  const count = await comboRows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(10);
  const texts = await comboRows.allInnerTexts();
  for (const t of texts) {
    expect(t).toMatch(/\d+(\.\d+)?\s*%/);
  }
});

test("[spec FR-3] 「1号艇以外が1着のレースだけ」に切り替えると 1 始まりの組み合わせが消える", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /組み合わせ/);
  const section = sectionOf(page);
  const toggle = section
    .getByRole("switch", { name: /1号艇以外が1着/ })
    .or(section.getByRole("checkbox", { name: /1号艇以外が1着/ }))
    .or(control(section, /1号艇以外が1着/))
    .first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  const comboRows = section
    .getByRole("row")
    .or(section.getByRole("listitem"))
    .filter({ hasText: /[1-6]\s*-\s*[1-6]\s*-\s*[1-6]/ });
  await expect
    .poll(async () => {
      const texts = await comboRows.allInnerTexts();
      return texts.some((t) => /(^|\s)1\s*-\s*[2-6]\s*-\s*[2-6]/.test(t));
    })
    .toBe(false);
});

test("[spec FR-3] 件数スライダーの変更が組み合わせの集計にも連動する（②③共通）", async ({
  page,
}) => {
  await openSection(page);
  await switchView(page, /組み合わせ/);
  const section = sectionOf(page);
  const before = await section.innerText();
  const slider = countSlider(page);
  await slider.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => section.innerText()).not.toBe(before);
});

test("[spec FR-3] 全体の n を表示する", async ({ page }) => {
  await openSection(page);
  await switchView(page, /組み合わせ/);
  const text = await sectionOf(page).innerText();
  expect(text).toMatch(/n\s*[=＝]\s*[\d,]+|[\d,]+\s*(件|レース)/);
});

// ---------------------------------------------------------------------------
// 非機能要件
// ---------------------------------------------------------------------------

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("[spec 非機能要件] 375px で3つの切り替えのどれでも横スクロールが出ない", async ({
    page,
  }) => {
    await openSection(page);
    for (const view of [/寄与度/, /類似レース/, /組み合わせ/]) {
      await switchView(page, view);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
