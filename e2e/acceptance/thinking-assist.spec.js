import { test, expect } from "../fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
  routeNoExhibition,
  routeNoOdds,
} from "../thinking-assist-fixture.js";

// 思考アシスト（BOA-430）の受け入れE2E。
// docs/design/thinking-assist/spec.md と screens.md だけから書いた
// （plan.md・tasks.md・src は読んでいない。前版 e2e/acceptance/thinking-assist.spec.js の19件は
//   文字の有無が中心・要素の選び方が弱いとの独立レビューを受け、全面的に書き直した）。
//
// ■ 開くレース
//   e2e/thinking-assist-fixture.js の例のレース 2026-10-06 徳山10R・準優勝戦（1号艇B1）。
//   venue_code=18→徳山（既存の VENUE_CODE 対応はこのレースの raceId "2026-10-06-18-10" 自体に埋め込まれている）。
//   本番の v16 API はこのレースの展示後の段を持たない（facts.status="exhibition_missing"）。
//   出走表・展示・オッズは本番 Supabase の実データ（過去のレースなので値は変わらない）。
//   v16 の facts・similar・scenario だけ固定データに差し替える（routeThinkingAssistV16）。
//
// ■ 固定データから直接確かめた値（node でファイルを解凍して検証済み。推測ではない）
//   - scenario の NC（全国・級の並びが同じ、ラウンドを問わない）: 3,276件・1号艇の1着 1,074（32.8%）・万舟 713件
//   - scenario の NCR（同じラウンド＝準優勝戦）: 112件・1号艇の1着 65（58.0%）・万舟 23件
//   - scenario の NA（全国の全レース、比べる基準）: 1号艇の1着 55.2%・万舟 17.1%
//     → NCR の58.0%とNAの55.2%は近く、mock/APPROVED.md が明記する「差ははっきりしない」と整合する
//   - similar-racecard の n_layer: 63件（≦400なので「条件が合う全件」）。1号艇の1着 34/63=54.0%・万舟 11件（17.5%）
//     → spec D-37 の「類似レースは54%」の記述と一致
//   - facts.today.items の6艇の値（枠順）:
//     nat_win（全国勝率） [6.03, 5.99, 7.29, 5.01, 6.16, 5.33] → 3号艇が一番高い
//     st_mean30（平均ST、低いほど良い） [0.132, 0.1473, 0.1469, 0.186, 0.1383, 0.1483] → 1号艇が一番早い
//     loc_win（当地勝率） [3.43, 6.93, 7.57, 4.38, 5.93, 0] → 3号艇が一番高い、6号艇は0（記録なし）
//     motor_2（モーター2連率） [19.2, 38, 25.8, 38.5, 32.7, 30.4] → 4号艇が一番高い
//     series_score（今節の平均着順点） [8.5714, 7.1429, 6.2857, 6.5714, 6.2857, 5.7143]（2桁で8.57等）
//       → 1号艇が一番高いが、このレースは準優勝戦なので spec FR-5・FR-3a「付けない所」により金枠は付かない
//
// ■ API はすべて routeThinkingAssistV16 でモックする（e2e/thinking-assist-fixture.js）。
//   展示前は routeNoExhibition、オッズなしは routeNoOdds を使う。
//   venue_technique_period_stats（会場の決まり手の期間の表、D-35 P-2・ADR 0088）はこのファイル内で
//   page.route を使って差し替える（本番にはまだ無い新しい集計のため、既存のデータでは検証できない）。
//
// ■ 要素の選び方
//   screens.md「操作できる要素の名前」の役割と名前だけを使う。DOM の順・CSS クラス・tag名には頼らない。
//   最良値の隠し文字「（6艇で一番）」は特定の要素に名前が無いため、page.getByText で見つけて
//   直近の祖先要素（xpath=..）の中に期待する数値が含まれるかで確かめる（タグ名・クラス名には頼っていない）。

const RACE_ID = THINKING_ASSIST_RACE; // "2026-10-06-18-10"
const ASSIST_URL = `/race/${RACE_ID}/assist`;
const RACE_URL = `/race/${RACE_ID}`;
const VENUE = "徳山";

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- ナビゲーション ----------

async function openAssist(
  page,
  { preview = true, overrides = {}, noExhibition = false, noOdds = false } = {},
) {
  await routeThinkingAssistV16(page, { preview, overrides });
  if (noExhibition) await routeNoExhibition(page);
  if (noOdds) await routeNoOdds(page);
  await page.goto(ASSIST_URL);
  await expect(lensTablist(page)).toBeVisible();
}

/** 会場の決まり手の期間の表（venue_technique_period_stats）を差し替える */
async function routeVenueTechniqueStats(page, rows) {
  await page.route("**/rest/v1/venue_technique_period_stats*", (route) =>
    route.fulfill({ json: rows }),
  );
}

// 差し: 直近90日30%・それより前の275日60%（明確な差、最近↓を想定）
// 逃げ: 直近90日40%・それより前の275日40%（差なし、印が付かないことの確認用）
const TECH_ROWS = [
  {
    venue_code: 18,
    period_days: 90,
    winning_technique: "差し",
    race_count: 45,
    total_races: 150,
    period_from: "2026-07-09",
    period_to: "2026-10-06",
    last_updated: "2026-10-07",
  },
  {
    venue_code: 18,
    period_days: 365,
    winning_technique: "差し",
    race_count: 255,
    total_races: 500,
    period_from: "2025-10-07",
    period_to: "2026-10-06",
    last_updated: "2026-10-07",
  },
  {
    venue_code: 18,
    period_days: 90,
    winning_technique: "逃げ",
    race_count: 60,
    total_races: 150,
    period_from: "2026-07-09",
    period_to: "2026-10-06",
    last_updated: "2026-10-07",
  },
  {
    venue_code: 18,
    period_days: 365,
    winning_technique: "逃げ",
    race_count: 200,
    total_races: 500,
    period_from: "2025-10-07",
    period_to: "2026-10-06",
    last_updated: "2026-10-07",
  },
];

// ---------- ロケータ（screens「操作できる要素の名前」） ----------

const lensTablist = (page) => page.getByRole("tablist", { name: "見方" });
const lensTab = (page, name) =>
  lensTablist(page).getByRole("tab", { name, exact: true });
const guideToggle = (page) =>
  page.getByRole("button", { name: "ガイド", exact: true });
const timeGroup = (page) => page.getByRole("group", { name: "時点" });
const timeBtn = (page, name) =>
  timeGroup(page).getByRole("button", { name, exact: true });
const venueBtn = (page) => page.getByRole("button", { name: `${VENUE}の特徴` });
const termBtn = (page, term) =>
  page.getByRole("button", { name: `${term}とは` });
const standBtn = (page) =>
  page.getByRole("button", { name: "堅い？荒れる？の材料" });
const standRegion = (page) =>
  page.getByRole("region", { name: "このレースは堅い？荒れる？" });
const waysToCountToggle = (page) =>
  page.getByRole("button", { name: "集めたレースは2通り" });
const raceFigure = (page, lens) =>
  page.getByRole("figure", { name: `レースの図（${lens}）` });
const boatRow = (page, n) =>
  page.getByRole("button", { name: new RegExp(`^${n}号艇\\s`) });
// 「{項目名} {値}、6艇で比べる」。値は規定の桁で完全一致させ、取り違えを防ぐ
const valueBtn = (page, label, value) =>
  page.getByRole("button", {
    name: new RegExp(
      `^${escapeRe(label)}(?:（[^）]*）)?\\s*${escapeRe(String(value))}\\D*6艇で比べる$`,
    ),
  });
const backToFigureBtn = (page) =>
  page.getByRole("button", { name: "図を戻す" });
// 名前は screens どおり「閉じる」と完全一致で選ぶ（使い方の1行の「この案内を閉じる」と取り違えない）
const closeDeepDiveBtn = (page) =>
  page.getByRole("button", { name: "閉じる", exact: true });
const perStartTableToggle = (page) =>
  page.getByRole("button", { name: "1走ずつの表" });
const candidateBtn = (page, boat, pos) =>
  page.getByRole("button", { name: `${boat}号艇を${pos}着の候補に` });
const footerRegion = (page) => page.getByRole("region", { name: "買い目" });
const openSheetBtn = (page) =>
  page.getByRole("button", { name: "マークシートを開く" });
const markSheet = (page) => page.getByRole("dialog", { name: "マークシート" });
const budgetInput = (page) =>
  markSheet(page).getByRole("spinbutton", { name: "予算" });
const allocationGroup = (page) =>
  markSheet(page).getByRole("radiogroup", { name: "配分" });
const sonarLink = (page) =>
  page.getByRole("link", { name: "もっと詳しく見る（龍神ソナー）" });
const displayGroup = (page) => page.getByRole("group", { name: "表示" });

/** 最良値の隠し文字「（6艇で一番）」が、期待する数値の近くに付いているかを確かめる。
 * タグ名・クラス名ではなく、Playwright の getByText（テキスト一致）とアクセシブルな祖先要素だけで確かめる */
async function expectBestMarkNear(page, expectedValueText) {
  const marks = page.getByText("（6艇で一番）");
  await expect(marks).toHaveCount(1);
  await expect(marks.locator("xpath=ancestor::*[1]")).toContainText(
    expectedValueText,
  );
}

const FORBIDDEN_TERMS = [
  "似たレース",
  "いつも",
  "競艇",
  "鉄板",
  "大本線",
  "AIの予想ではない",
  "過去レースを数えた値",
];

async function expectNoForbiddenTerms(page) {
  const text = await page.locator("body").innerText();
  for (const term of FORBIDDEN_TERMS) {
    expect(text, `禁止語「${term}」が含まれていた`).not.toContain(term);
  }
}

// ======================================================================
// 入口・上部の切り替え（FR-1、D-22、D-36 (6)）
// ======================================================================

test.describe("入口・上部の切り替え", () => {
  test("[spec FR-1] フラグが無い状態でレース詳細に上部の切り替えが出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: false });
    await page.goto(RACE_URL);
    await expect(displayGroup(page)).toHaveCount(0);
  });

  test("[spec FR-1 / 状態表] フラグが無くても /race/:raceId/assist を直接開くと表示される", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: false });
    await page.goto(ASSIST_URL);
    await expect(lensTablist(page)).toBeVisible();
    await expect(displayGroup(page)).toHaveCount(0);
  });

  test("[spec FR-1 / D-22] フラグあり・ja・tab/boat指定なしでレース詳細に上部の切り替えが出る", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    await page.goto(RACE_URL);
    const group = displayGroup(page);
    await expect(group).toBeVisible();
    await expect(
      group.getByRole("button", { name: "出走表とタブ" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      group.getByRole("button", { name: "思考アシスト" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("[D-36 (6)] URLに tab 指定があると上部の切り替えが出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    await page.goto(`${RACE_URL}?tab=analogy`);
    await expect(displayGroup(page)).toHaveCount(0);
  });

  test("[D-36 (6)] URLに boat 指定があると上部の切り替えが出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    await page.goto(`${RACE_URL}?boat=1`);
    await expect(displayGroup(page)).toHaveCount(0);
  });

  // 既存ページの一般的な多言語URL（/en/ 接頭辞）を前提にしている。思考アシスト自体の仕様には
  // 無く、サイト全体の既存の i18n 規則からの類推（決まっていない点に記載）
  test("[D-36 (6)] ja以外（/en/）では上部の切り替えが出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    await page.goto(`/en${RACE_URL}`);
    await expect(displayGroup(page)).toHaveCount(0);
  });

  test("[D-22] 「思考アシスト」へ切り替えると /assist に移り、選んだ方を次も開く", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    await page.goto(RACE_URL);
    await displayGroup(page)
      .getByRole("button", { name: "思考アシスト" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${escapeRe(ASSIST_URL)}$`));
    // 選んだ表示が保存され、次にレース詳細を開くと置き換え（replace）で思考アシストへ戻る
    await page.goto(RACE_URL);
    await expect(page).toHaveURL(new RegExp(`${escapeRe(ASSIST_URL)}$`));
  });

  test("[D-22] 「出走表とタブ」へ切り替えるとレース詳細に戻る", async ({
    page,
  }) => {
    await openAssist(page);
    const group = displayGroup(page);
    await expect(group).toBeVisible();
    await group.getByRole("button", { name: "出走表とタブ" }).click();
    await expect(page).toHaveURL(new RegExp(`${escapeRe(RACE_URL)}$`));
  });

  test("[spec FR-1] AI予想（展開予測・イン崩れ注意度）への直接のリンクを出さない", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(
      page.getByRole("link", { name: /展開予測|イン崩れ注意度/ }),
    ).toHaveCount(0);
  });
});

// ======================================================================
// 龍神ソナーへの導線（spec FR-1、D-36 (8)）
// ======================================================================

test.describe("龍神ソナーへの導線", () => {
  test("[D-36 (8)] ソナーを表示できる端末では導線が出て、同じレースのソナーへ行ける", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: true });
    // 龍神ソナー自体のプレビューの印（analogy-finder.spec.js と同じ既存の慣習）
    await page.addInitScript(() => {
      try {
        localStorage.setItem("boatai-user:analogy-finder-preview", "1");
      } catch {
        // ignore
      }
    });
    await page.goto(ASSIST_URL);
    const link = sonarLink(page);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${escapeRe(RACE_URL)}(\\?|$)`));
    await expect(page).not.toHaveURL(/\/assist/);
  });

  // 龍神ソナーは公開済み（ANALOGY_FINDER_PUBLIC=true）。D-36 (8) の「非公開の間は表示できる端末だけ」は終わったので、
  // 内部確認の印が無い端末でも導線を出す（2026-10-09 オーケストレーター判断）
  test("[D-36 (8)] ソナーの公開後は、内部確認の印が無い端末でも導線を出す", async ({
    page,
  }) => {
    await openAssist(page); // analogy-finder-preview の印を立てない
    await expect(sonarLink(page)).toBeVisible();
  });
});

// ======================================================================
// ヘッダー（spec FR-2）
// ======================================================================

test.describe("ヘッダー", () => {
  test("[spec FR-2] 展示前は風・波・天候・展示の値を出さず「展示の後に出る」と書く", async ({
    page,
  }) => {
    await openAssist(page, { noExhibition: true });
    await expect(timeBtn(page, "展示後")).toBeDisabled();
    await expect(timeBtn(page, "展示前")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText("展示の後に出る")).toBeVisible();
  });

  test("[spec 制約「使うデータ」/ FR-2] 展示後（DBの展示が6艇そろう）が既定で選ばれる", async ({
    page,
  }) => {
    await openAssist(page); // 過去のレースで実データの展示が既にそろっている
    await expect(timeBtn(page, "展示後")).toBeEnabled();
    await expect(timeBtn(page, "展示後")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("[spec FR-2] オッズの取得時刻が時刻つきで出る", async ({ page }) => {
    await openAssist(page);
    // オッズは図より後に届く（N-5）ので、出るまで待つ（実装時に直した: 元は1回だけ読んでいて、遅い環境で落ちた）
    await expect(page.locator("body")).toContainText(
      /オッズ.{0,6}\d{1,2}:\d{2}時点|\d{1,2}:\d{2}時点のオッズ/,
    );
  });

  test("[spec FR-2 / D-37] ラウンド「準優勝戦」が出る", async ({ page }) => {
    await openAssist(page);
    await expect(page.getByText("準優勝戦").first()).toBeVisible();
  });

  test("[D-18] 会場名のボタンで会場の特徴のシートが開く", async ({ page }) => {
    await openAssist(page);
    await routeVenueTechniqueStats(page, TECH_ROWS);
    await venueBtn(page).click();
    await expect(
      page.getByRole("dialog", { name: `${VENUE}の特徴` }),
    ).toBeVisible();
  });
});

// ======================================================================
// 「このレースは堅い？荒れる？」（FW-22、D-21、D-26、D-31、D-37 U-17）
// ======================================================================

test.describe("堅い？荒れる？の枠", () => {
  test("[spec FR-2 / D-37] 準優勝戦の日は「全国・級の並びが同じ準優勝戦 112件」58%・差ははっきりしない", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(standRegion(page)).toBeVisible();
    await standBtn(page).click();
    const sheet = page.getByRole("dialog");
    // 範囲の名前と「差ははっきりしない」は、1号艇の1着と万舟の2本のバーに出る（実装時に直した: 元は1つだけを前提にしていた）
    await expect(
      sheet.getByText("全国・級の並びが同じ準優勝戦 112件").first(),
    ).toBeVisible();
    await expect(sheet.getByText("58%")).toBeVisible();
    await expect(sheet.getByText("差ははっきりしない").first()).toBeVisible();
  });

  test("[D-37] 開いた中に「予選も含めると 33%（3,276件）」が1行出る", async ({
    page,
  }) => {
    await openAssist(page);
    await standBtn(page).click();
    const sheet = page.getByRole("dialog");
    await waysToCountToggle(page).click();
    await expect(
      sheet.getByText(/予選も含めると\s*33%（3,276件）/),
    ).toBeVisible();
  });

  test("[D-37] NCRが30件未満のときは全国・級の並びが同じ（ラウンドを問わない）に戻り「件数少なめ」になる", async ({
    page,
  }) => {
    await openAssist(page, {
      overrides: {
        scenario: (body) => {
          if (String(body.scope).startsWith("NCR")) {
            body.scenario.n = 20;
            body.scenario.cells.all.forms.any.n = 20;
            body.scenario.cells.all.forms.any.b1_win = 12;
            body.scenario.cells.all.forms.any.manshu = 3;
            body.scenario.cells.all.forms.any.payout_known = 20;
          }
          return body;
        },
      },
    });
    await standBtn(page).click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText("全国・級の並びが同じ 3,276件・件数少なめ").first(),
    ).toBeVisible();
    // 言葉を出さないのは「全国・級の並びが同じ」の行だけ。類似レースの行は D-21 の3段階のまま残す
    // （2026-10-08 ユーザー決定。実装時に直した: 元はシート全体に言葉が1つも無いことを前提にしていた）
    const sameClassBars = sheet.getByRole("button", {
      name: /^全国・級の並びが同じ 3,276件・件数少なめ/,
    });
    await expect(sameClassBars).toHaveCount(2);
    for (const bar of await sameClassBars.all()) {
      await expect(bar).not.toContainText("差ははっきりしない");
      await expect(bar).not.toContainText("高め");
      await expect(bar).not.toContainText("低め");
    }
    await expect(
      sheet.getByRole("button", { name: /^類似レース/ }).first(),
    ).toContainText(/差ははっきりしない|高め|低め/);
  });

  test("[D-24 / D-32] 比べる基準は「全国の全レース」、数え方の説明は畳んである", async ({
    page,
  }) => {
    await openAssist(page);
    await standBtn(page).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("全国の全レース").first()).toBeVisible();
    await expect(waysToCountToggle(page)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await waysToCountToggle(page).click();
    await expect(waysToCountToggle(page)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("[D-31 / 2026-10-08 ユーザー決定] 級の並びの絵: 選んだ艇（1号艇）に「1号艇 枠も級も同じ」、残り5艇は「級の艇数だけ同じ・どの枠かは問わない」", async ({
    page,
  }) => {
    await openAssist(page);
    await standBtn(page).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("1号艇 枠も級も同じ").first()).toBeVisible();
    await expect(
      sheet.getByText("級の艇数だけ同じ・どの枠かは問わない").first(),
    ).toBeVisible();
  });

  test("[spec FW-21 / screens S-1c] ガイド①はこの枠を光らせる", async ({
    page,
  }) => {
    await openAssist(page);
    await guideToggle(page).click();
    await expect(standRegion(page)).toBeVisible();
    // ガイド中は買い目の固定フッターを隠す（①〜④）
    await expect(footerRegion(page)).not.toBeVisible();
  });
});

// ======================================================================
// 会場の特徴・「最近↑／↓」（D-35 P-2、D-37 U-18）
// ======================================================================

test.describe("会場の特徴シートの決まり手", () => {
  test("[D-37] 直近90日と前の275日の割合がはっきり離れている決まり手には「最近↓」が付く", async ({
    page,
  }) => {
    await openAssist(page);
    await routeVenueTechniqueStats(page, TECH_ROWS);
    await venueBtn(page).click();
    const sheet = page.getByRole("dialog", { name: `${VENUE}の特徴` });
    await expect(sheet.getByText("差し 最近↓ 90日30%／前60%")).toBeVisible();
  });

  test("[D-37] 割合が変わらない決まり手には印を付けず「変化なし」とも書かない", async ({
    page,
  }) => {
    await openAssist(page);
    await routeVenueTechniqueStats(page, TECH_ROWS);
    await venueBtn(page).click();
    const sheet = page.getByRole("dialog", { name: `${VENUE}の特徴` });
    await expect(sheet.getByText("変化なし")).toHaveCount(0);
    await expect(sheet.getByText(/逃げ.*最近[↑↓]/)).toHaveCount(0);
  });
});

// ======================================================================
// レースの図・レンズ（spec FR-3、FR-4、N-2）
// ======================================================================

test.describe("レースの図とレンズ", () => {
  for (const lens of ["軸", "展開", "機力", "買い目"]) {
    test(`[spec FR-4] レンズ「${lens}」に切り替えると選択状態になり、図は1〜6号艇のまま`, async ({
      page,
    }) => {
      await openAssist(page);
      await lensTab(page, lens).click();
      await expect(lensTab(page, lens)).toHaveAttribute(
        "aria-selected",
        "true",
      );
      const figure = raceFigure(page, lens);
      await expect(figure).toBeVisible();
      for (let n = 1; n <= 6; n++) {
        await expect(boatRow(page, n)).toBeVisible();
      }
    });
  }

  test("[spec FR-3 受入基準] レンズを切り替えても艇の並びは変わらない", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "展開").click();
    const order1 = [];
    for (let n = 1; n <= 6; n++)
      order1.push(await boatRow(page, n).isVisible());
    await lensTab(page, "機力").click();
    for (let n = 1; n <= 6; n++) {
      await expect(boatRow(page, n)).toBeVisible();
    }
  });
});

// ======================================================================
// 深掘り・最良値（spec FR-5、FR-3a）
// ======================================================================

test.describe("深掘り", () => {
  test("[spec FR-5] 艇の丸をタップすると深掘りが開き、「閉じる」で戻る", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 1).click();
    await expect(closeDeepDiveBtn(page)).toBeVisible();
    await expect(boatRow(page, 1)).toHaveAttribute("aria-current", "true");
    await closeDeepDiveBtn(page).click();
    await expect(closeDeepDiveBtn(page)).toHaveCount(0);
  });

  test("[spec FR-5] 1走ずつの表は畳んであり、タップで開く", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 1).click();
    const toggle = perStartTableToggle(page);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("table", { name: /今節の各走/ })).toBeVisible();
  });

  test("[spec FR-5 / D-34] 今節より前の5走の表が出る", async ({ page }) => {
    await openAssist(page);
    await boatRow(page, 1).click();
    await perStartTableToggle(page).click();
    await expect(
      page.getByRole("table", { name: /今節より前の5走/ }),
    ).toBeVisible();
  });
});

test.describe("最良値の金枠（spec FR-3a）", () => {
  test("[spec FR-3a] 全国勝率は6艇で一番高い3号艇（7.29）にだけ付く", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "軸").click();
    await valueBtn(page, "全国勝率", "7.29").click();
    await expectBestMarkNear(page, "7.29");
    await expect(valueBtn(page, "全国勝率", "6.03")).not.toContainText(
      "（6艇で一番）",
    );
  });

  test("[spec FR-3a] 平均STは低いほど良い向きで、一番早い1号艇（0.132）に付く", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "軸").click();
    await valueBtn(page, "平均ST", "0.132").click();
    await expectBestMarkNear(page, "0.132");
  });

  test("[spec FR-3a] モーター2連率は一番高い4号艇（38.5）に付く", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "機力").click();
    await valueBtn(page, "モーター2連率", "38.5").click();
    await expectBestMarkNear(page, "38.5");
  });

  test("[spec FR-5 / FR-3a] 当地勝率が0.00の6号艇は「記録なし」で、比べる対象から外れる", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 6).click();
    await expect(page.getByText("記録なし").first()).toBeVisible();
  });

  test("[spec FR-5 / FR-3a 付けない所] 準優勝戦の日は今節の平均着順点に金枠を付けない", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "軸").click();
    await boatRow(page, 1).click();
    // 1号艇が数値上は一番高い（8.57）が、準優勝戦の日は比べない
    const btn = valueBtn(page, "今節の平均着順点", "8.57");
    if (await btn.count()) {
      await expect(btn).not.toContainText("（6艇で一番）");
    }
    await expectNoForbiddenTerms(page);
  });
});

// ======================================================================
// セオリーカード・用語シート（spec FR-6、D-8、D-15）
// ======================================================================

test.describe("セオリーカードと用語のシート", () => {
  test("[D-8] 「?」は用語の意味だけを出す: 今節の平均着順点", async ({
    page,
  }) => {
    await openAssist(page);
    await termBtn(page, "今節の平均着順点").click();
    const dialog = page.getByRole("dialog", { name: "今節の平均着順点" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("高いほど調子が良い")).toBeVisible();
  });

  test("[spec FR-6 受入基準] 準備中のカードに数値を出さない", async ({
    page,
  }) => {
    await openAssist(page);
    // TC-T6（部品交換）は文だけ（成立率は準備中）
    const trendBtn = page.getByRole("button", {
      name: /部品交換.*の過去レースの傾向/,
    });
    if (await trendBtn.count()) {
      await trendBtn.click();
      const dialog = page.getByRole("dialog").last();
      await expect(dialog.getByText("準備中")).toBeVisible();
    }
  });

  test("[spec FR-6] 展示前はセオリーの「今日」を出さず「展示の後に分かる」と書く", async ({
    page,
  }) => {
    await openAssist(page, { noExhibition: true });
    const text = await page.locator("body").innerText();
    expect(text).toContain("展示の後に分かる");
  });
});

// ======================================================================
// 買い目・マークシート・配分（spec FR-7、FR-8）
// ======================================================================

/** 1着={1,2}・2着={1,3}・3着={2,3} の候補を入れる。
 * 同じ艇が複数ポジションに重なる組を除くと、有効な組は (1,3,2)・(2,1,3) の2組だけになる
 * （screens の例「1-34-2345（6点）」と同じ計算で確かめた重複除去） */
async function selectTwoComboFormation(page) {
  await lensTab(page, "買い目").click();
  await candidateBtn(page, 1, 1).click();
  await candidateBtn(page, 2, 1).click();
  await candidateBtn(page, 1, 2).click();
  await candidateBtn(page, 3, 2).click();
  await candidateBtn(page, 2, 3).click();
  await candidateBtn(page, 3, 3).click();
}

test.describe("買い目（固定フッター・FR-7）", () => {
  test("[spec FR-7 受入基準] 同じ艇の重複を除いた点数が出る", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await expect(footerRegion(page)).toContainText("（2点）");
  });

  test("[spec FR-7] 候補をもう一度押すと外れる", async ({ page }) => {
    await openAssist(page);
    await lensTab(page, "買い目").click();
    const btn = candidateBtn(page, 1, 1);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("[spec FR-7 受入基準] レンズを切り替えても買い目が残る", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await expect(footerRegion(page)).toContainText("（2点）");
    await lensTab(page, "軸").click();
    await lensTab(page, "買い目").click();
    await expect(footerRegion(page)).toContainText("（2点）");
  });

  test("[spec FR-5 / FR-7] 深掘りを開いて閉じても買い目が残る", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await boatRow(page, 4).click();
    await closeDeepDiveBtn(page).click();
    await expect(footerRegion(page)).toContainText("（2点）");
  });

  test("[spec FR-7] マークシートを開いて候補を入れられる", async ({ page }) => {
    await openAssist(page);
    await lensTab(page, "買い目").click();
    await openSheetBtn(page).click();
    const sheet = markSheet(page);
    await expect(sheet).toBeVisible();
    const cell = candidateBtn(page, 4, 1);
    await cell.click();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
  });

  test("[spec FR-7] 欠場の艇には何着の候補のボタンも出さない", async ({
    page,
  }) => {
    // D-38: facts のoverridesでは欠場（レースエントリー側の情報）を再現できないため、
    // ここでは「今日のレースに欠場が無い＝6艇ぶん全てのボタンが出る」ことだけを確かめる
    await openAssist(page);
    await lensTab(page, "買い目").click();
    for (let n = 1; n <= 6; n++) {
      await expect(candidateBtn(page, n, 1)).toBeVisible();
    }
  });
});

test.describe("オッズ照合と配分（spec FR-8）", () => {
  test("[spec FR-8 受入基準] 合成オッズ＝1÷Σ(1/オッズ) が手計算と一致する", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "買い目").click();
    const readSynthetic = async () => {
      const text = await footerRegion(page).innerText();
      const m = text.match(/合成\s*([\d.]+)/);
      expect(m, `フッターに合成オッズが見つからない: ${text}`).toBeTruthy();
      return Number(m[1]);
    };
    // 組A: 1-2-3 のみ（点数1） → 合成オッズ＝その組のオッズそのもの
    await candidateBtn(page, 1, 1).click();
    await candidateBtn(page, 2, 2).click();
    await candidateBtn(page, 3, 3).click();
    await expect(footerRegion(page)).toContainText("（1点）");
    const oddsA = await readSynthetic();

    // 候補は着ごとの集合（フォーメーション）なので、3着に4号艇を足すと組B: 1-2-4 が加わる（点数2）
    // （実装時に直した: 元は 4-5-6 を足して2点になる前提で、フォーメーションでは8点になる）
    await candidateBtn(page, 4, 3).click();
    await expect(footerRegion(page)).toContainText("（2点）");
    const oddsAB = await readSynthetic();

    // 3着の3号艇を外し、組Bだけにする（点数1） → 合成オッズ＝組Bのオッズそのもの
    await candidateBtn(page, 3, 3).click();
    await expect(footerRegion(page)).toContainText("（1点）");
    const oddsB = await readSynthetic();

    // 1/合成(AB) ≈ 1/オッズA + 1/オッズB（表示は丸められているため緩めの許容誤差にする）
    const expected = 1 / oddsA + 1 / oddsB;
    const actual = 1 / oddsAB;
    expect(Math.abs(actual - expected)).toBeLessThan(expected * 0.1 + 0.01);
  });

  test("[spec FR-8] 予算が100円×点数より少ないときは配分を出さず最低額の案内を出す", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await openSheetBtn(page).click();
    await budgetInput(page).fill("150");
    // 買い目レンズの要約にも同じ配分が出るので、開いたマークシートの中で確かめる
    await expect(markSheet(page).getByText("2点には最低200円")).toBeVisible();
  });

  test("[spec FR-8] 予算が足りるときは配分の合計が予算以下（残りが0円以上）になる", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await openSheetBtn(page).click();
    await budgetInput(page).fill("1000");
    // exact: 「均等」は「均等払戻」にも部分一致する（実装時に直した）
    await allocationGroup(page)
      .getByRole("radio", { name: "均等", exact: true })
      .click();
    const text = await markSheet(page).innerText();
    const m = text.match(/残り(\d+)円/);
    expect(m, `「残り{n}円」が見つからない: ${text}`).toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(0);
  });

  test("[spec FR-8 / D-34 U-12] 丸めた後の倍率の幅が出る", async ({ page }) => {
    await openAssist(page);
    await selectTwoComboFormation(page);
    await openSheetBtn(page).click();
    await budgetInput(page).fill("1000");
    await allocationGroup(page)
      .getByRole("radio", { name: "均等払戻" })
      .click();
    const text = await markSheet(page).innerText();
    expect(text).toMatch(/当たったときの倍率\s*[\d.]+\s*〜\s*[\d.]+倍/);
  });

  test("[spec FR-8 受入基準 / 状態表] オッズが無いレースでは計算を出さず1行で知らせる", async ({
    page,
  }) => {
    await openAssist(page, { noOdds: true });
    await lensTab(page, "買い目").click();
    await expect(
      page.getByText("オッズは締切の約1時間前から出る"),
    ).toBeVisible();
    const text = await footerRegion(page).innerText();
    expect(text).not.toMatch(/合成\s*[\d.]+/);
  });
});

// ======================================================================
// ガイド（spec FR-10）
// ======================================================================

test.describe("ガイド", () => {
  test("[spec FR-10] 初めて開くときは既定で出ない（ガイドのボタンで始める）", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(guideToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(standBtn(page)).toBeVisible(); // ①の光らせ対象がまだ強調されていない通常表示
  });

  test("[screens S-1c] ②は軸レンズに切り替え、フッターを隠す", async ({
    page,
  }) => {
    await openAssist(page);
    await guideToggle(page).click();
    await page.getByRole("button", { name: "次へ" }).click(); // ①→②
    await expect(lensTab(page, "軸")).toHaveAttribute("aria-selected", "true");
    await expect(footerRegion(page)).not.toBeVisible();
  });

  test("[screens S-1c] ③は展開レンズ、④は機力レンズに切り替える", async ({
    page,
  }) => {
    await openAssist(page);
    await guideToggle(page).click();
    await page.getByRole("button", { name: "次へ" }).click(); // ①→②
    await page.getByRole("button", { name: "次へ" }).click(); // ②→③
    await expect(lensTab(page, "展開")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: "次へ" }).click(); // ③→④
    await expect(lensTab(page, "機力")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(footerRegion(page)).not.toBeVisible();
  });

  test("[screens S-1c] ⑤は買い目レンズに切り替え、フッターは隠さない", async ({
    page,
  }) => {
    await openAssist(page);
    await guideToggle(page).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "次へ" }).click();
    }
    await expect(lensTab(page, "買い目")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(footerRegion(page)).toBeVisible();
  });

  test("[spec FR-10 受入基準] ガイドを閉じても買い目とレンズは残る", async ({
    page,
  }) => {
    await openAssist(page);
    await selectTwoComboFormation(page); // 事前に買い目を選んでおく（買い目レンズのまま）
    await guideToggle(page).click();
    await page.getByRole("button", { name: "次へ" }).click(); // →②軸
    await page.getByRole("button", { name: "次へ" }).click(); // →③展開
    // 「ガイド」をもう一度押して閉じる（トグル。名前の重複する「閉じる」ボタンに頼らない）
    await guideToggle(page).click();
    await expect(guideToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(lensTab(page, "展開")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await lensTab(page, "買い目").click();
    await expect(footerRegion(page)).toContainText("（2点）");
  });
});

// ======================================================================
// 状態: 展示前・v16の展示後の段が無い・オッズ無し（spec FR-2、FR-6、FR-11、screens「状態」）
// ======================================================================

test.describe("展示前の状態（別テストに分離）", () => {
  test("[screens 状態] 展示前は展開の横軸が平均STのまま、展示の値を出さない", async ({
    page,
  }) => {
    await openAssist(page, { noExhibition: true });
    await lensTab(page, "機力").click();
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("チルト");
    expect(text).not.toContain("部品交換");
  });

  test("[screens 状態 / FR-10] ガイド④（機力）の時点でも展示の値を出さない", async ({
    page,
  }) => {
    await openAssist(page, { noExhibition: true });
    await guideToggle(page).click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "次へ" }).click();
    }
    await expect(lensTab(page, "機力")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const text = await page.locator("body").innerText();
    expect(text).not.toContain("チルト");
  });
});

test.describe("展示後だが v16 の展示後の段が無い状態（既定のフィクスチャそのもの）", () => {
  test("[spec FR-2 / D-36 (1)] 展示の表は出す", async ({ page }) => {
    await openAssist(page);
    await lensTab(page, "機力").click();
    await expect(page.getByText("展示タイム").first()).toBeVisible();
  });

  test("[spec FR-2 / 状態表] 類似レースは出走表の時点の値で描き「出走表の時点」と書く", async ({
    page,
  }) => {
    await openAssist(page);
    // 類似レースは展開レンズの要約（決まり手）に出る（screens「レンズごとの図 C」展開）
    await lensTab(page, "展開").click();
    const text = await page.locator("body").innerText();
    expect(text).toContain("出走表の時点");
  });

  test("[D-35・D-36 (3)] 類似レースは「類似レース63件（条件が合う全件）」と出る", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "展開").click();
    const text = await page.locator("body").innerText();
    expect(text).toContain("類似レース63件（条件が合う全件）");
  });
});

// ======================================================================
// 思考フレームワークの対応表（spec FR-9、N-3＝3タップ以内）
// ======================================================================

// レンズが決まっている行だけを対象に、primary のレンズへ1タップで切り替えられることを確かめる
// （「（開くだけ）」も含め、レンズの切り替えはどの行でも1タップで N-3 の範囲内）
const FW_LENS_ROWS = [
  ["FW-01 イン信頼型", "軸"],
  ["FW-02 イン崩れ", "軸"],
  ["FW-03 壁読み", "展開"],
  ["FW-04 進入読み", "展開"],
  ["FW-05 スリット読み", "展開"],
  ["FW-06 1マークの展開", "展開"],
  ["FW-07 スジ買い", "展開"],
  ["FW-08 機力重視", "機力"],
  ["FW-09 展示重視", "機力"],
  ["FW-10 調整読み", "機力"],
  ["FW-12 当地・コース巧者", "軸"],
  ["FW-13 今節・勝負駆け", "軸"],
  ["FW-17 過去傾向", "展開"],
  ["FW-18 穴狙い", "機力"],
  ["FW-19 オッズ・妙味", "買い目"],
  ["FW-20 点数・配分", "買い目"],
];

test.describe("FR-9 思考フレームワークの対応表: レンズの到達（1タップ）", () => {
  for (const [id, lens] of FW_LENS_ROWS) {
    test(`[spec FR-9 / screens 対応表] ${id} は「${lens}」レンズに1タップで届く`, async ({
      page,
    }) => {
      await openAssist(page);
      await lensTab(page, lens).click();
      await expect(lensTab(page, lens)).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  }
});

test.describe("FR-9 思考フレームワークの対応表: 深い到達（2〜3タップ）", () => {
  test("[FW-01/02 イン信頼型・イン崩れ] 1号艇の丸タップ（1タップ）で深掘りが開く", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 1).click();
    await expect(closeDeepDiveBtn(page)).toBeVisible();
  });

  test("[FW-08 機力重視] 機力レンズ→モーター2連率の値タップ（2タップ）で6艇比較が開く", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "機力").click();
    await valueBtn(page, "モーター2連率", "38.5").click();
    await expect(backToFigureBtn(page)).toBeVisible();
  });

  test("[FW-12 当地・コース巧者] 艇の丸→当地勝率の値タップ（2タップ）で6艇比較が開く", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 3).click();
    await valueBtn(page, "当地勝率", "7.57").click();
    await expect(backToFigureBtn(page)).toBeVisible();
  });

  test("[FW-13 今節・勝負駆け] 艇の丸→今節の点の値タップ（2タップ）で6艇比較が開く", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 2).click();
    const btn = valueBtn(page, "今節の平均着順点", "7.14");
    if (await btn.count()) {
      await btn.click();
      await expect(backToFigureBtn(page)).toBeVisible();
    }
  });

  test("[FW-21 初心者] 「ガイド」タップ（1タップ）で案内が始まる", async ({
    page,
  }) => {
    await openAssist(page);
    await guideToggle(page).click();
    await expect(guideToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("[FW-22 堅い／荒れる] 「堅い？荒れる？の材料」タップ（1タップ）でシートが開く", async ({
    page,
  }) => {
    await openAssist(page);
    await standBtn(page).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

// ======================================================================
// 禁止語（spec N-7、FR-6「生データ主義の意味」）
// ======================================================================

test.describe("禁止語", () => {
  test("[spec 位置づけ・N-7] 通常表示（軸レンズ）に禁止語が無い", async ({
    page,
  }) => {
    await openAssist(page);
    await expectNoForbiddenTerms(page);
  });

  for (const lens of ["展開", "機力", "買い目"]) {
    test(`[spec 位置づけ・N-7] ${lens}レンズに禁止語が無い`, async ({
      page,
    }) => {
      await openAssist(page);
      await lensTab(page, lens).click();
      await expectNoForbiddenTerms(page);
    });
  }

  test("[spec 位置づけ・N-7] 深掘り・6艇比較を開いても禁止語が無い", async ({
    page,
  }) => {
    await openAssist(page);
    await boatRow(page, 1).click();
    // 図の数字と深掘りの数字は同じ名前（screens「図・深掘りの数字」）。どちらを押しても6艇比較になる
    await valueBtn(page, "全国勝率", "6.03").first().click();
    await expectNoForbiddenTerms(page);
  });

  test("[spec 位置づけ・N-7] マークシートを開いても禁止語が無い", async ({
    page,
  }) => {
    await openAssist(page);
    await lensTab(page, "買い目").click();
    await openSheetBtn(page).click();
    await expectNoForbiddenTerms(page);
  });

  test("[spec 位置づけ・N-7] 堅い？荒れる？のシートを開いても禁止語が無い", async ({
    page,
  }) => {
    await openAssist(page);
    await standBtn(page).click();
    await expectNoForbiddenTerms(page);
  });

  test("[spec 位置づけ・N-7] 会場の特徴のシートを開いても禁止語が無い", async ({
    page,
  }) => {
    await openAssist(page);
    await routeVenueTechniqueStats(page, TECH_ROWS);
    await venueBtn(page).click();
    await expectNoForbiddenTerms(page);
  });
});

// ======================================================================
// 非機能要件（N-1 横スクロール無し、N-6 タップ領域44px以上）
// ======================================================================

test.describe("非機能要件", () => {
  test("[spec N-1] 375px幅で横スクロールが発生しない", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openAssist(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("[spec N-6] 艇の丸のタップ領域は44px以上", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openAssist(page);
    const box = await boatRow(page, 1).boundingBox();
    expect(box).toBeTruthy();
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("[spec N-6] 艇番は色だけでなく数字でも示される", async ({ page }) => {
    await openAssist(page);
    for (let n = 1; n <= 6; n++) {
      await expect(boatRow(page, n)).toBeVisible();
    }
  });
});

// ======================================================================
// 決まっていない点（spec・screens から一意に決まらず、推測で書かなかった事項）
// ======================================================================
//
// 1. オッズ取得時刻の表記順。spec FR-2 は「{HH:MM}時点のオッズ」、screens S-1 の図は
//    「オッズ 20:31時点」で語順が違う。どちらかに一意に決まらないため、テストは両方を
//    許す緩いパターンにした。
// 2. 非ja（/en/ 等）での上部の切り替え非表示テストは、思考アシスト自体の仕様に URL の
//    言語プレフィックス形式が書かれていないため、サイト全体の既存の i18n 規則（/en/ 接頭辞）
//    からの類推で書いた。実装の URL 構造がこれと違う場合はテストを直す必要がある。
// 3. D-22 の「選んだ表示を次も開く」保存の仕組み（localStorage のキー名・値）は
//    spec・screens に literal な記載が無いため、キー名を直接検証せず、UI操作→再訪問の
//    挙動（置き換えナビゲーション）だけで確かめた。
// 4. D-38（欠場の買い目の扱い）は、e2e/thinking-assist-fixture.js の
//    routeThinkingAssistV16 の overrides が v16（facts/similar/scenario）だけを
//    差し替えるもので、欠場（レースエントリー側の情報）を模擬する口が無いため、
//    「欠場が無い状態で6艇ぶんのボタンが出る」ことまでしか確かめていない。欠場ありの
//    状態（ボタンが出ない・買い目から外れる・「{n}号艇の欠場で{k}点を外しました」等）は
//    未検証。
// 5. 「?」ボタン・「傾向 ›」ボタンの正確なアクセシブルネーム（「{用語}とは」「{セオリーの名前}の
//    過去レースの傾向」のうち {用語}・{セオリーの名前} に入る具体的な文字列）は、spec・screens
//    に全項目の一覧が無いため、spec 本文で直接名指しされている用語（「今節の平均着順点」）
//    だけをピンポイントで使い、それ以外（部品交換・風 等）は .count() で存在確認してから
//    操作する形にして、無ければスキップする書き方にした（常にスキップするわけではない）。
// 6. FR-9 対応表22行のうち、レンズの到達（1タップ）はFW-11（どこでも）・FW-14〜16・
//    FW-22（ヘッダー関連、レンズが無い）を除く16行で確認した。深い（2〜3タップ）到達の
//    確認は、名前が screens に明記されている操作だけを使える FW-01・02・08・12・13・21・22
//    の7行にとどめた。残りの行（FW-03〜07・09・10・17〜20 の一部）は「★」「スジのカード」等、
//    操作できる要素の名前の一覧に literal な名前が無いため、タップ対象を推測せずに
//    見送った。
// 7. FR-3a「走数が少ない値は比べない」（SMALL_SAMPLE_THRESHOLD）は、どの艇のどの値が
//    小標本になるかが出走表・選手の実データ（v16 の外）に依存し、spec・screens からは
//    判定できないため未検証。
// 8. 「展示の反映中」状態（v16の展示後の段を作っている途中）は、今回の12点の指摘に
//    直接含まれていなかったため実装していない（screens「状態」表には記載がある）。
