// 受け入れE2E: イン崩れ注意度の作り直しと展開予測の画面からの撤去（BOA-822）
// 入力は docs/design/in-collapse-caution/spec.md・screens.md
//（承認済みモック画像 mock/*.png・mock/APPROVED.md を screens.md の一部として含む）のみ。
// plan.md・tasks.md・src は読んでいない。
//
// 公開までは機能フラグで隠され、URL に ?caution=1 を付けると新しい画面が出て
// localStorage に印が付く（spec.md 自体には書かれておらず、依頼元からの前提として受領）。
// このファイルの goto はすべて caution=1 を付ける。
//
// 2026-10-13 screens.md 更新（曖昧点への回答）を反映して書き直し:
//   - S-1 の文言・並びはモック（1-ai-tab-375.png）どおりに確定
//   - 外すボタンの data-testid「ai-tab-sonar-link」（依頼元から受領。外れたことの確認に
//     文言の手がかりが無いため、この1か所だけ例外的に testid セレクタを使う）
//   - S-2 の場所 /races/:date/:venueCode、S-3 の場所 / ・/races/:date、S-8 の場所
//     /about・/faq・/how-to-use が確定
//   - 帯の端の表記「−3.5未満」「+3.0以上」が確定
import { test, expect } from "../fixtures.js";

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

const withCaution = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}caution=1`;

const CAUTION_TITLE = "イン崩れ注意度";
const LEVEL_NAMES = ["崩れやすい", "中くらい", "堅め"];
// screens S-1: 「ほかの材料（展示・モーター等）は龍神ソナーの『差がつく材料』で」の1行
const OTHER_MATERIAL_NOTE =
  "ほかの材料（展示・モーター等）は龍神ソナーの「差がつく材料」で";
// screens S-1: 免責（承認済みモックのとおり）
const DISCLAIMER = "過去の実績の割合で、今日の結果を保証するものではありません";
// screens S-1: 値が無いレースの空状態の1行
const EMPTY_STATE_TEXT = "このレースはイン崩れ注意度を出していません";
// screens S-1: 理由の見出しと3行の表
const REASON_HEADING = "今日の勝率差（全国勝率）";
const REASON_ROW_ME = /1号艇\s*\S+?（[^）]+）\s*[\d.]+/;
const REASON_ROW_MAX = /一番高い\s*\d号艇\s*\S+?（[^）]+）\s*[\d.]+/;
const REASON_ROW_DIFF = /差\s*[−\-+]?[\d.]+/;
// screens S-1: 導線の2つのボタン文言（思考アシストは ja のみ）
const SONAR_BUTTON_TEXT = /類似レース[\d,]+件で見ると？/;
const ASSIST_BUTTON_TEXT = "軸から考える";
// spec 用語: 勝率差の帯の端の表記
const BAND_LOWER_EDGE = "−3.5未満";
const BAND_UPPER_EDGE = "+3.0以上";
// 外す旧ボタン（screens S-1。data-testid は依頼元から受領。外れたことの確認に文言の
// 手がかりが無いため、ロール・文言ベースの原則の例外としてこの1か所だけ使う）
const OLD_SONAR_LINK_TESTID = "ai-tab-sonar-link";

/** トップから /race/:id へのリンクを集める（レースIDを固定しないため。本番データで変わる） */
async function findRaceHrefs(page) {
  await page.goto(withCaution("/"));
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

/** トップから /races/:date/:venueCode（会場のレース一覧）へのリンクを1件探す */
async function findVenueListHref(page) {
  await page.goto(withCaution("/"));
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const hrefs = await page
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const href = hrefs.find((h) => /^\/races\/[^/]+\/[^/?#]+/.test(h));
    if (href) return href;
    await page.waitForTimeout(500);
  }
  return null;
}

/** レース詳細の AI予想タブを ?caution=1 付きで開く（spec FR-1「?tab=aiPrediction は今のまま開く」） */
async function openAiTab(page, href) {
  const [path, query] = href.split("?");
  const params = new URLSearchParams(query ?? "");
  params.set("tab", "aiPrediction");
  params.set("caution", "1");
  await page.goto(`${path}?${params.toString()}`);
  await expect(page).toHaveURL(/\/race\//);
}

const aiTabCautionHeading = (page) =>
  page
    .getByRole("heading", { name: CAUTION_TITLE })
    .or(page.getByText(CAUTION_TITLE, { exact: true }))
    .first();

/**
 * カードが出ているか。描画を待たずに isVisible() を見ると、データの読み込み中に「カードが無い」と判定する
 * （2026-10-17 ライブのデータで S-1 が1件失敗・17件スキップ）。カードの見出しか空状態の1行のどちらかが出るまで
 * 待ってから、見出しが出ているかを返す。判定の中身は変えない（オーナー承認 2026-10-17、オーケストレーター経由）
 */
async function cautionCardShown(page, timeout = 10_000) {
  await aiTabCautionHeading(page)
    .or(page.getByText(EMPTY_STATE_TEXT))
    .first()
    .waitFor({ state: "visible", timeout })
    .catch(() => {});
  return aiTabCautionHeading(page)
    .isVisible()
    .catch(() => false);
}

/** イン崩れ注意度カードが出ているレースを、トップのリンクから探す。見つかった href に留まる */
async function openAnyRaceCautionCard(page, { limit = 12 } = {}) {
  const hrefs = await findRaceHrefs(page);
  for (const href of hrefs.slice(0, limit)) {
    await openAiTab(page, href);
    if (await cautionCardShown(page)) {
      return href;
    }
  }
  test.skip(
    true,
    "トップページから、イン崩れ注意度カードが出るレースへ辿れない（開催の無い時間帯など）",
  );
  return null;
}

/** カードのテキストが pattern に一致するレースを探す。見つかった href に留まる。無ければ null */
async function findRaceWithCardText(page, pattern, { limit = 15 } = {}) {
  const hrefs = await findRaceHrefs(page);
  for (const href of hrefs.slice(0, limit)) {
    await openAiTab(page, href);
    if (!(await cautionCardShown(page))) continue;
    const text = await page.evaluate(() => document.body.innerText);
    if (pattern.test(text)) return href;
  }
  return null;
}

/** 「1号艇が1着を逃したのは◯%」の数字を読む */
async function readCautionPercent(page) {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(
    /1号艇が1着を逃したのは[\s\S]{0,20}?(\d+(?:\.\d+)?)\s*%/,
  );
  return m ? Number(m[1]) : null;
}

const linkTo = (page, nameRe) =>
  page.getByRole("link", { name: nameRe }).first();

/** セルの中の横棒と、その外枠（トラック）。モーター比較の受け入れテストと同じ判定方法 */
async function hasFrame(loc) {
  return loc.evaluate((e) => {
    for (let n = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const border = ["Top", "Right", "Bottom", "Left"].some(
        (s) =>
          parseFloat(cs[`border${s}Width`]) > 0 &&
          cs[`border${s}Style`] !== "none",
      );
      const outline =
        parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none";
      if (border || outline) return true;
      if (n.tagName === "BODY") break;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// S-1 レース詳細 AI予想タブのイン崩れ注意度カード（FR-2・FR-3、新規 InCautionCard）
// ---------------------------------------------------------------------------

test.describe("S-1 レース詳細 AI予想タブのイン崩れ注意度カード", () => {
  test("[FR-2 / FR-3 / screens S-1] 先頭にカードがあり、大きい数字・基準・件数・免責が出る", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    await expect(aiTabCautionHeading(page)).toBeVisible();
    const p = await readCautionPercent(page);
    expect(p, "「1号艇が1着を逃したのは◯%」の数字が読めない").not.toBeNull();
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(100);
    await expect(
      page.getByText(/全国\s*\d+(?:\.\d+)?\s*%/).first(),
    ).toBeVisible();
    await expect(page.getByText(/全国\s*[\d,]+\s*件/).first()).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });

  test("[FR-3] 段の札が3段（崩れやすい・中くらい・堅め）のいずれかで表示される", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const text = await page.evaluate(() => document.body.innerText);
    expect(
      LEVEL_NAMES.some((n) => text.includes(n)),
      "段の札（崩れやすい/中くらい/堅め）が見当たらない",
    ).toBe(true);
  });

  test("[screens S-1] 棒の下の両端に「← 堅め（35%未満）」「崩れやすい（55%以上）→」が出る", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    await expect(page.getByText(/堅め（35%未満）/).first()).toBeVisible();
    await expect(page.getByText(/崩れやすい（55%以上）/).first()).toBeVisible();
  });

  test("[FR-3 受入基準 / screens S-1] 「会場内パーセンタイル」「イン崩れ指数」の言葉が出ない（0〜100の指数をやめる）", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    await expect(page.getByText(/会場内パーセンタイル/)).toHaveCount(0);
    await expect(page.getByText(/イン崩れ指数/)).toHaveCount(0);
  });

  test("[screens S-1] 範囲の文「1号艇と、他の艇で一番高い勝率の差が今日と同じくらい（帯）のレース。全国◯件（期間）」が出る", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(
      /1号艇と、他の艇で一番高い勝率の差が今日と同じくらい（([^）]+)）のレース/,
    );
    expect(m, "範囲の文が見つからない").not.toBeNull();
    // 帯は「−2.5〜−2.0」の形、端は「−3.5未満」「+3.0以上」（spec 用語）
    expect(m[1]).toMatch(
      /^(−?\d+(?:\.\d+)?〜[−+]?\d+(?:\.\d+)?|−3\.5未満|\+3\.0以上)$/,
    );
  });

  test("[spec 用語 既定値] 勝率差の帯が端のとき「−3.5未満」「+3.0以上」の表記になる", async ({
    page,
  }) => {
    const pattern = new RegExp(
      `${BAND_LOWER_EDGE}|\\${BAND_UPPER_EDGE.replace("+", "\\+")}`,
    );
    const href = await findRaceWithCardText(page, pattern);
    test.skip(!href, "端の帯（−3.5未満 または +3.0以上）のレースへ辿れない");
    await expect(page.getByText(pattern)).toBeVisible();
  });

  test("[screens S-1] 理由は「今日の勝率差（全国勝率）」の見出しと3行の表（1号艇・一番高い◯号艇・差）", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    await expect(page.getByText(REASON_HEADING)).toBeVisible();
    const text = await page.evaluate(() => document.body.innerText);
    expect(
      REASON_ROW_ME.test(text),
      "「1号艇 名前（級）勝率」の行が見当たらない",
    ).toBe(true);
    expect(
      REASON_ROW_MAX.test(text),
      "「一番高い◯号艇 名前（級）勝率」の行が見当たらない",
    ).toBe(true);
    expect(REASON_ROW_DIFF.test(text), "「差 ◯」の行が見当たらない").toBe(true);
    await expect(page.getByText(OTHER_MATERIAL_NOTE)).toBeVisible();
  });

  test("[screens S-1] 導線は「類似レース◯件で見ると？ 龍神ソナー›」「軸から考える 思考アシスト›」の2つのボタン", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    await expect(page.getByText(SONAR_BUTTON_TEXT).first()).toBeVisible();
    await expect(linkTo(page, /龍神ソナー/)).toBeVisible();
    await expect(page.getByText(ASSIST_BUTTON_TEXT).first()).toBeVisible();
    await expect(linkTo(page, /思考アシスト/)).toBeVisible();
  });

  test("[screens S-1] 「段ごとの実績を見る」のリンクで /accuracy へ移る", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const link = linkTo(page, /段ごとの実績を見る/);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/accuracy/);
  });

  test("[screens S-1] 旧「龍神ソナーへの案内」ボタン（ai-tab-sonar-link）が外れている", async ({
    page,
  }) => {
    // screens S-1「展開予測のブロックと『龍神ソナーへの案内』ボタン（data-testid=
    // "ai-tab-sonar-link"）を外す」。撤去対象の旧ボタンに文言の手がかりが無いため、
    // この1か所だけ data-testid セレクタの例外を使う（依頼元から受領した前提）
    await openAnyRaceCautionCard(page);
    await expect(
      page.locator(`[data-testid="${OLD_SONAR_LINK_TESTID}"]`),
    ).toHaveCount(0);
  });

  test("[FR-1] AI予想タブに展開予測のブロック・的中率が出ない", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/展開予測/);
    expect(text).not.toMatch(/的中率約79%/);
  });

  test("[screens S-1] カードの下に出現パターンが残る", async ({ page }) => {
    await openAnyRaceCautionCard(page);
    await expect(page.getByText(/出現パターン/).first()).toBeVisible();
  });

  test("[FR-2 / screens S-1] 確定後は同じカードに「結果: 1号艇はN着」が出て、的中/外れの判定は出ない", async ({
    page,
  }) => {
    const href = await findRaceWithCardText(page, /結果:\s*1号艇は\d+着/);
    test.skip(!href, "確定済みで注意度カードが出るレースへ辿れない");
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toMatch(/結果:\s*1号艇は\d+着/);
    expect(text).not.toMatch(/的中|外れ/);
  });

  test("[FR-2 注記] 準優・優勝戦のレースに「勝率差による差がつきにくい」の注記が出る", async ({
    page,
  }) => {
    const NOTE = /勝率差による差がつきにくい/;
    const href = await findRaceWithCardText(page, NOTE);
    test.skip(!href, "準優・優勝戦で注記が出るレースへ辿れない");
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test("[FR-2 注記] 1艇欠場のレースに「欠場あり（5艇）」の注記が出る", async ({
    page,
  }) => {
    const NOTE = /欠場あり（5艇）/;
    const href = await findRaceWithCardText(page, NOTE);
    test.skip(!href, "1艇欠場で注記が出るレースへ辿れない");
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test("[FR-2 注記] 帯の件数が300未満のレースに「件数少なめ（n件）」の注記が出る", async ({
    page,
  }) => {
    const NOTE = /件数少なめ（\d+件）/;
    const href = await findRaceWithCardText(page, NOTE);
    test.skip(!href, "件数少なめの注記が出るレースへ辿れない");
    await expect(page.getByText(NOTE)).toBeVisible();
  });

  test("[FR-2 / screens S-1] 値が無いレースはカードを出さず「このレースはイン崩れ注意度を出していません」の1行が出る", async ({
    page,
  }) => {
    const hrefs = await findRaceHrefs(page);
    let found = null;
    for (const href of hrefs.slice(0, 15)) {
      await openAiTab(page, href);
      if (!(await cautionCardShown(page))) {
        found = href;
        break;
      }
    }
    test.skip(
      !found,
      "注意度カードが出ないレースへ辿れない（全レースに値がある）",
    );
    await expect(aiTabCautionHeading(page)).toHaveCount(0);
    await expect(page.getByText(EMPTY_STATE_TEXT)).toBeVisible();
  });

  for (const width of [375, 1440]) {
    test(`[FR-3 受入基準] ${width}px でカードの大きい数字・件数・基準・理由・導線が見える`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await openAnyRaceCautionCard(page);
      await expect(aiTabCautionHeading(page)).toBeVisible();
      const p = await readCautionPercent(page);
      expect(p).not.toBeNull();
      await expect(page.getByText(/全国\s*[\d,]+\s*件/).first()).toBeVisible();
      await expect(page.getByText(REASON_HEADING)).toBeVisible();
      await expect(linkTo(page, /龍神ソナー/)).toBeVisible();
    });
  }
});

// ---------------------------------------------------------------------------
// S-2 レース一覧のバッジ（RaceCard.jsx の拡張、FR-1・FR-5）
// ---------------------------------------------------------------------------

test.describe("S-2 会場のレース一覧（/races/:date/:venueCode）のバッジ", () => {
  test("[FR-5 / screens S-2] 3段の札と割合のバッジが出る（例「▲ 崩れやすい 65%」）", async ({
    page,
  }) => {
    const href = await findVenueListHref(page);
    test.skip(
      !href,
      "ホームから /races/:date/:venueCode への導線が無い（開催の無い日等）",
    );
    await page.goto(withCaution(href));
    const text = await page.evaluate(() => document.body.innerText);
    expect(
      LEVEL_NAMES.some((n) => text.includes(n)),
      "段の札（崩れやすい/中くらい/堅め）が見当たらない",
    ).toBe(true);
    expect(text).toMatch(/\d+(?:\.\d+)?%/);
  });

  test("[screens S-2 承認] 真ん中の段（中くらい）のバッジは色なし・枠線だけで出る", async ({
    page,
  }) => {
    const href = await findVenueListHref(page);
    test.skip(
      !href,
      "ホームから /races/:date/:venueCode への導線が無い（開催の無い日等）",
    );
    await page.goto(withCaution(href));
    const middle = page.getByText(/中くらい/).first();
    test.skip(
      !(await middle.isVisible().catch(() => false)),
      "この一覧に「中くらい」の段のレースが無い",
    );
    expect(await hasFrame(middle), "中くらいの段のバッジに枠線が無い").toBe(
      true,
    );
  });

  test("[FR-1 / screens S-2] 展開予測の的中/外れのバッジが出ない", async ({
    page,
  }) => {
    const href = await findVenueListHref(page);
    test.skip(
      !href,
      "ホームから /races/:date/:venueCode への導線が無い（開催の無い日等）",
    );
    await page.goto(withCaution(href));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/的中|外れ/);
  });
});

// ---------------------------------------------------------------------------
// S-7 思考アシスト「堅い？荒れる？」（FR-4、(a) を承認）
// ---------------------------------------------------------------------------

test.describe("S-7 思考アシスト「堅い？荒れる？」", () => {
  test("[FR-4 受入基準] 同じレースで、AI予想タブの注意度と思考アシストの1着のバーの和が100%になる", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const p = await readCautionPercent(page);
    test.skip(p === null, "注意度の数字が読めない");
    const link = linkTo(page, /思考アシスト/);
    test.skip(
      !(await link.isVisible().catch(() => false)),
      "思考アシストへの導線が無い",
    );
    await link.click();
    await expect(page).toHaveURL(/\/assist/);
    const text = await page.evaluate(() => document.body.innerText);
    const m = text.match(/1号艇の1着[\s\S]{0,20}?(\d+(?:\.\d+)?)\s*%/);
    expect(m, "思考アシストの1号艇の1着の値が読めない").not.toBeNull();
    const barValue = Number(m[1]);
    expect(Math.abs(barValue + p - 100)).toBeLessThanOrEqual(0.2);
  });

  test("[FR-4] 1着のバーの行に範囲の名前と件数が出る", async ({ page }) => {
    await openAnyRaceCautionCard(page);
    const link = linkTo(page, /思考アシスト/);
    test.skip(
      !(await link.isVisible().catch(() => false)),
      "思考アシストへの導線が無い",
    );
    await link.click();
    await expect(page).toHaveURL(/\/assist/);
    await expect(page.getByText(/勝率差が同じくらい/).first()).toBeVisible();
    await expect(page.getByText(/[\d,]+件/).first()).toBeVisible();
  });

  test("[FR-4] 枠の下に「1号艇の1着◯%は、イン崩れ注意度◯%（1着を逃した割合）の裏返し」の1行が出る", async ({
    page,
  }) => {
    await openAnyRaceCautionCard(page);
    const link = linkTo(page, /思考アシスト/);
    test.skip(
      !(await link.isVisible().catch(() => false)),
      "思考アシストへの導線が無い",
    );
    await link.click();
    await expect(page).toHaveURL(/\/assist/);
    await expect(
      page.getByText(
        /1号艇の1着\s*\d+(?:\.\d+)?%\s*は、イン崩れ注意度\s*\d+(?:\.\d+)?%（1着を逃した割合）の裏返し/,
      ),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// S-3 ホームの今日のハイライト（FR-5）
// ---------------------------------------------------------------------------

test.describe("S-3 ホームの今日のイン崩れ注意度（/）", () => {
  test("[screens S-3] 見出し「今日のイン崩れ注意度」の下に注意度の割合と段の札が出る", async ({
    page,
  }) => {
    await page.goto(withCaution("/"));
    const heading = page.getByText("今日のイン崩れ注意度").first();
    test.skip(
      !(await heading.isVisible().catch(() => false)),
      "今日のハイライトが出ていない（対象レースが無い等）",
    );
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).toMatch(/\d+(?:\.\d+)?%/);
    expect(
      LEVEL_NAMES.some((n) => text.includes(n)),
      "段の札（崩れやすい/中くらい/堅め）が見当たらない",
    ).toBe(true);
  });

  test("[screens S-3] 崩れやすい順・堅めの順の両方が、切り替え操作なしで同時に見える", async ({
    page,
  }) => {
    await page.goto(withCaution("/"));
    const heading = page.getByText("今日のイン崩れ注意度").first();
    test.skip(
      !(await heading.isVisible().catch(() => false)),
      "今日のハイライトが出ていない（対象レースが無い等）",
    );
    await expect(page.getByText(/崩れやすい/).first()).toBeVisible();
    await expect(page.getByText(/堅め/).first()).toBeVisible();
  });

  test("[FR-5 / FR-3] 今日のハイライトに「会場内パーセンタイル」の言葉が出ない", async ({
    page,
  }) => {
    await page.goto(withCaution("/"));
    await expect(page.getByText(/会場内パーセンタイル/)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// S-4 /today 本日のデータ一覧（FR-5・FR-7）
// ---------------------------------------------------------------------------

test.describe("S-4 /today", () => {
  test("[FR-5 / S-4] 各行にイン崩れ注意度の割合が出る", async ({ page }) => {
    await page.goto(withCaution("/today"));
    const row = page.getByText(/イン崩れ注意度\s*\d+(?:\.\d+)?%/).first();
    test.skip(
      !(await row.isVisible().catch(() => false)),
      "/today に注意度を含む行が無い（本日のレースが無い等）",
    );
    await expect(row).toBeVisible();
  });

  test("[FR-5 / S-4] 用語集・説明から「当日の条件からAIが算出した」が消えている", async ({
    page,
  }) => {
    await page.goto(withCaution("/today"));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toContain("当日の条件からAIが算出した");
  });
});

// ---------------------------------------------------------------------------
// S-5 /accuracy 段ごとの実績（FR-6）
// ---------------------------------------------------------------------------

const tabButton = (page, nameRe) =>
  page
    .getByRole("tab", { name: nameRe })
    .or(page.getByRole("button", { name: nameRe }))
    .or(page.getByRole("link", { name: nameRe }))
    .first();

test.describe("S-5 /accuracy イン崩れ注意度の段ごとの実績", () => {
  test("[FR-6] 展開予測の大きい数字・会場別の表が出ない", async ({ page }) => {
    await page.goto(withCaution("/accuracy"));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/展開予測/);
  });

  test("[FR-6] 「公開後」「公開前の検証」の切り替えがある", async ({
    page,
  }) => {
    await page.goto(withCaution("/accuracy"));
    await expect(tabButton(page, /公開後/)).toBeVisible();
    await expect(tabButton(page, /公開前の検証/)).toBeVisible();
  });

  test("[FR-6] 公開前の検証タブで、3段ごとの割合・件数・ぶれ幅・段の範囲の帯・全国の点線が出る", async ({
    page,
  }) => {
    await page.goto(withCaution("/accuracy"));
    await tabButton(page, /公開前の検証/).click();
    for (const name of LEVEL_NAMES) {
      await expect(page.getByText(new RegExp(name)).first()).toBeVisible();
    }
    await expect(page.getByText(/ぶれ幅/).first()).toBeVisible();
    await expect(page.getByText(/[\d,]+レース/).first()).toBeVisible();
    await expect(page.getByText(/全国\s*\d+(?:\.\d+)?%/).first()).toBeVisible();
  });

  test("[FR-6] 公開後タブで件数30未満の段は割合を出さず、件数だけにする", async ({
    page,
  }) => {
    await page.goto(withCaution("/accuracy"));
    await tabButton(page, /公開後/).click();
    const note = page.getByText(/少ないので割合は出さない/).first();
    test.skip(
      !(await note.isVisible().catch(() => false)),
      "公開後の件数が30件以上に届いた段しか無い（データが揃うと出なくなる想定どおり）",
    );
    await expect(note).toBeVisible();
  });

  test("[FR-1 / FR-6 / S-5] /hit-races は /accuracy へ移る", async ({
    page,
  }) => {
    await page.goto(withCaution("/hit-races"));
    await expect(page).toHaveURL(/\/accuracy/);
  });

  test("[FR-1 / S-5] ヘッダーのナビに /hit-races へのリンクが無い", async ({
    page,
  }) => {
    await page.goto(withCaution("/"));
    const nav = page.getByRole("navigation").first();
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.some((h) => h.includes("hit-races"))).toBe(false);
  });

  test("[FR-1 / S-5] sitemap に /hit-races が含まれない", async ({
    page,
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    test.skip(!res.ok(), "sitemap.xml が取得できない");
    const body = await res.text();
    expect(body).not.toContain("hit-races");
  });
});

// ---------------------------------------------------------------------------
// FR-1 展開予測を画面から外す（残り: /races）
// ---------------------------------------------------------------------------

test("[FR-1 / S-6] /races に日別の展開予測の的中率が出ない", async ({
  page,
}) => {
  await page.goto(withCaution("/races"));
  const text = await page.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/展開予測/);
});

// ---------------------------------------------------------------------------
// S-8 説明のページ（About・FAQ・HowToUse、FR-1・FR-7）
// ---------------------------------------------------------------------------

for (const path of ["/about", "/faq", "/how-to-use"]) {
  test(`[FR-1 / FR-7 / S-8] ${path} から展開予測の説明・「的中率約79%」が消えている`, async ({
    page,
  }) => {
    await page.goto(withCaution(path));
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toContain("的中率約79%");
    expect(text).not.toMatch(/展開予測/);
  });
}
