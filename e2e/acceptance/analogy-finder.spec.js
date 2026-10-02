import { test, expect } from "../fixtures.js";

// BOA-271 アナロジー・ファインダー 受け入れE2E（2026-10-02 版の spec・screens で全面書き直し）
// 入力: docs/design/analogy-finder/spec.md・screens.md のみ（plan/tasks/src は読んでいない）
// 対象: FR-1（1-b）・FR-1b（1-a）・FR-2（「ほかのテーマでも絞る」を含む）・FR-3
// 画面の構造・操作要素は screens.md「画面の構造と操作要素」、1-a の文言は
// 「1-a の段のラベルと注記」の表に従う。
//
// ---------------------------------------------------------------------------
// 仮定した API 応答のキー（spec・screens に形の記載が無いため。実装側が合わせるか、
// テストを直すかを後で判断する）
// ---------------------------------------------------------------------------
// GET /api/analogy/race-contribution/[raceId]（FR-1b）
//   応答が JSON の null           … 計算できなかったレース（1-a を出さない）
//   status                        … "after_exhibition"（展示後）
//                                   "before_not_yet"（(a) まだ展示が終わっていない）
//                                   "before_reflecting"（(b) 反映中）
//                                   "before_incomplete"（(c) 展示タイムがそろわない）
//                                   "before_no_value"（(d) 締切後も展示後の値が無い）
//                                   "absent"（欠場が分かっている）
//   model_version                 … 1-a の下に出すモデルの版（文字列をそのまま出す前提）
//   exhibition_as_of              … 展示後の時点 "HH:MM"
//   themes[]                      … { key, name, share }（今の段の値。share は 0〜1）
//   boats[]                       … { boat_number, contribution }（符号つき。+ が押し上げ）
//   before_exhibition             … { themes[], boats[] }（展示後のとき、折りたたみに出す出走表時点の値）
//   change                        … { boat_number, feature_group }（変化の1行。展示後のときだけ）
//
// GET /api/analogy/similar/[raceId]?depth=N（FR-2・FR-3 で共有）
//   応答が JSON の null           … get_analogy_similar が NULL（2・3 を出さない）
//   depth 無しの要求              … 自動の深さで返す（auto_depth）
//   as_of                         … データ段の時刻 "HH:MM"（「出走表 7:30 時点」）
//   race_finished                 … 確定済みのレースか（「（発走前）」を付ける）
//   depth / auto_depth            … 使った深さ（4=4条件すべて）／自動で選んだ深さ
//   conditions[]                  … { key, name, value, theme }（自動の4条件、上から順）
//   counts_by_depth               … { "4": n4, "3": n3, "2": n2, "1": n1 }
//   n                             … 今の層の件数
//   period                        … { from: "YYYY-MM", to: "YYYY-MM" }
//   extra_filters[]               … { key, name, value, theme, count }（ほかのテーマでも絞る。
//                                   value が null なら今日の値が分からない＝出さない。count は「足すと N件」）
//   applied_extra[]               … 適用中の任意条件の key
//   distributions                 … { kimarite[], winner_boat[], winner_course[], top_trifecta[] }
//                                   各要素 { label, count }
//   races[]                       … { date: "YYYY-MM-DD", venue, race_number }（新しい順20件）
//   trifecta[]                    … { combo: "1-2-3", count }（FR-3 のサンキー・組み合わせ一覧の元）
//   course_flow[]                 … { winner_course, kimarite, second_course, count }（コールアウト用）
//   任意条件の要求                … クエリに "round" / "motor" を含む文字列があれば、その条件で絞った応答を返す
//                                   （パラメータ名は仮定。key をそのまま使う前提）
// ---------------------------------------------------------------------------

const SECTION_HEADING = "アナロジー・ファインダー";
const H_WHAT = "何が効いているか";
const H_RACE = "このレースの6艇の差の内訳";
const H_SLICE = "同じ条件のレース全体の内訳";
const H_SIMILAR = "類似度の高い過去レース";
const H_COMBO = "組み合わせ";
const THEMES = [
  "会場×枠・進入",
  "選手・基礎成績",
  "ST・直前情報",
  "機力",
  "環境",
  "選手・属性",
];
const ACCIDENT_NOTE = "類似の判定には事故情報を含まない";
const ABSENT_LINE =
  "欠場があったため、このレースの6艇の差の内訳は出していません";
const NOT_AUTO_NOTE = "この条件は自動では使っていません";
const NOTE_A = "展示の後に更新します";
const NOTE_B = "展示の結果を反映しています";
const NOTE_C = "このレースは展示データがそろっていないため、展示前の値です";
const FORBIDDEN = /間に合わない|間に合わなかった|失敗|エラー/;
const DIST_HEADINGS = [
  "決まり手",
  "1着の艇番",
  "1着の進入コース",
  "よく出た出目",
];
const RC_MODEL_VERSION = "rc-2026.10.01";

// ---------------------------------------------------------------------------
// 固定データ
// ---------------------------------------------------------------------------

function themes(shares) {
  const keys = {
    "会場×枠・進入": "venue_lane",
    "選手・基礎成績": "racer_base",
    "ST・直前情報": "st_pre",
    機力: "machine",
    環境: "environment",
    "選手・属性": "racer_attr",
  };
  return Object.entries(shares).map(([name, share]) => ({
    key: keys[name],
    name,
    share,
  }));
}

// 展示後: 上位2テーマの差 .151（強調あり）。機力 > 環境（任意条件はモーターが先）
const AFTER_THEMES = themes({
  "選手・基礎成績": 0.452,
  "会場×枠・進入": 0.301,
  "ST・直前情報": 0.148,
  機力: 0.052,
  "選手・属性": 0.031,
  環境: 0.016,
});
// 展示前（出走表時点）: ST・直前情報 .061 が展示後の .148 と区別できる値
const BEFORE_THEMES = themes({
  "選手・基礎成績": 0.487,
  "会場×枠・進入": 0.336,
  "ST・直前情報": 0.061,
  機力: 0.067,
  "選手・属性": 0.033,
  環境: 0.016,
});
// 上位2テーマの差 .03（強調なし）
const CLOSE_THEMES = themes({
  "選手・基礎成績": 0.4,
  "会場×枠・進入": 0.37,
  "ST・直前情報": 0.12,
  機力: 0.06,
  "選手・属性": 0.03,
  環境: 0.02,
});
const BOATS = [
  { boat_number: 1, contribution: 0.12 },
  { boat_number: 2, contribution: -0.05 },
  { boat_number: 3, contribution: 0.02 },
  { boat_number: 4, contribution: 0.08 },
  { boat_number: 5, contribution: -0.09 },
  { boat_number: 6, contribution: -0.08 },
];

function raceContribution(status, overrides = {}) {
  const after = status === "after_exhibition";
  return {
    status,
    model_version: RC_MODEL_VERSION,
    exhibition_as_of: after ? "15:32" : null,
    themes: after ? AFTER_THEMES : BEFORE_THEMES,
    boats: BOATS,
    before_exhibition: after ? { themes: BEFORE_THEMES, boats: BOATS } : null,
    change: after ? { boat_number: 4, feature_group: "展示タイム" } : null,
    ...overrides,
  };
}

const CONDITIONS = [
  {
    key: "win_rate_diff_band",
    name: "勝率差",
    value: "−0.49〜+0.19",
    theme: "選手・基礎成績",
  },
  {
    key: "boat1_class",
    name: "1号艇の級別",
    value: "A1級",
    theme: "選手・基礎成績",
  },
  { key: "venue", name: "会場", value: "大村", theme: "会場×枠・進入" },
  {
    key: "top_win_rate_boat",
    name: "勝率1位の艇",
    value: "1号艇",
    theme: "選手・基礎成績",
  },
];

// 合計が n になる件数の配列を作る（最後の要素で端数を合わせる）
function dist(labels, n, ratios) {
  const counts = ratios.map((r) => Math.floor(n * r));
  const rest = n - counts.reduce((a, b) => a + b, 0);
  counts[counts.length - 1] += rest;
  return labels.map((label, i) => ({ label, count: counts[i] }));
}
const KIMARITE = ["逃げ", "差し", "まくり", "まくり差し", "抜き", "恵まれ"];
const BOAT_LABELS = ["1号艇", "2号艇", "3号艇", "4号艇", "5号艇", "6号艇"];
const COURSE_LABELS = [
  "1コース",
  "2コース",
  "3コース",
  "4コース",
  "5コース",
  "6コース",
];

// n=640 の基本の層。逃げ 352件 55.0%
const BASE_KIMARITE = [
  { label: "逃げ", count: 352 },
  { label: "差し", count: 102 },
  { label: "まくり", count: 83 },
  { label: "まくり差し", count: 70 },
  { label: "抜き", count: 28 },
  { label: "恵まれ", count: 5 },
];
// 14通り、合計 640。上位10件＋「その他」4件。1号艇以外の1着を含む
const BASE_TRIFECTA = [
  { combo: "1-2-3", count: 120 },
  { combo: "1-3-2", count: 90 },
  { combo: "1-2-4", count: 70 },
  { combo: "1-4-2", count: 52 },
  { combo: "2-1-3", count: 50 },
  { combo: "1-3-4", count: 45 },
  { combo: "3-1-2", count: 40 },
  { combo: "4-1-2", count: 35 },
  { combo: "1-4-3", count: 30 },
  { combo: "2-3-1", count: 28 },
  { combo: "5-1-2", count: 25 },
  { combo: "3-4-1", count: 20 },
  { combo: "6-1-2", count: 20 },
  { combo: "4-5-6", count: 15 },
];

function recentRaces(count) {
  const venues = ["大村", "徳山", "下関", "芦屋"];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 28 - i));
    return {
      date: d.toISOString().slice(0, 10),
      venue: venues[i % venues.length],
      race_number: (i % 12) + 1,
    };
  });
}

function scaledTrifecta(n) {
  const total = BASE_TRIFECTA.reduce((a, b) => a + b.count, 0);
  const rows = BASE_TRIFECTA.map((r) => ({
    combo: r.combo,
    count: Math.max(1, Math.floor((r.count * n) / total)),
  }));
  const rest = n - rows.reduce((a, b) => a + b.count, 0);
  rows[0].count += rest;
  return rows;
}

function similarLayer({
  depth,
  autoDepth,
  counts,
  n,
  extraFilters,
  appliedExtra,
}) {
  const isBase = n === 640;
  return {
    as_of: "07:30",
    race_finished: false,
    depth,
    auto_depth: autoDepth,
    conditions: CONDITIONS,
    counts_by_depth: counts,
    n,
    period: { from: "2019-04", to: "2026-09" },
    extra_filters: extraFilters,
    applied_extra: appliedExtra,
    distributions: {
      kimarite: isBase
        ? BASE_KIMARITE
        : dist(KIMARITE, n, [0.542, 0.2, 0.13, 0.08, 0.04, 0.008]),
      winner_boat: dist(
        BOAT_LABELS,
        n,
        [0.55, 0.156, 0.125, 0.094, 0.047, 0.028],
      ),
      winner_course: dist(
        COURSE_LABELS,
        n,
        [0.555, 0.153, 0.125, 0.092, 0.047, 0.028],
      ),
      top_trifecta: [
        { label: "1-2-3", count: Math.round(n * 0.1875) },
        { label: "1-3-2", count: Math.round(n * 0.14) },
        { label: "1-2-4", count: Math.round(n * 0.109) },
      ],
    },
    races: recentRaces(20),
    trifecta: isBase ? BASE_TRIFECTA : scaledTrifecta(n),
    course_flow: [
      { winner_course: 4, kimarite: "まくり", second_course: 1, count: 12 },
      { winner_course: 4, kimarite: "まくり", second_course: 5, count: 9 },
    ],
  };
}

const COUNTS = { 4: 640, 3: 1204, 2: 3530, 1: 9811 };
const EXTRA_FILTERS = [
  { key: "round", name: "ラウンド", value: "予選", theme: "環境", count: 212 },
  { key: "grade", name: "グレード", value: "G1", theme: "環境", count: 0 },
  {
    key: "motor",
    name: "1号艇のモーター",
    value: "6艇中1〜2位",
    theme: "機力",
    count: 24,
  },
];

// 既定: 4条件のまま 640件
function similarDefault(url) {
  const s = url.toString();
  const depthParam = url.searchParams.get("depth");
  if (s.includes("round")) {
    return similarLayer({
      depth: 4,
      autoDepth: 4,
      counts: COUNTS,
      n: 212,
      extraFilters: EXTRA_FILTERS,
      appliedExtra: ["round"],
    });
  }
  if (s.includes("motor")) {
    return similarLayer({
      depth: 4,
      autoDepth: 4,
      counts: COUNTS,
      n: 24,
      extraFilters: EXTRA_FILTERS,
      appliedExtra: ["motor"],
    });
  }
  const depth = depthParam ? Number(depthParam) : 4;
  return similarLayer({
    depth,
    autoDepth: 4,
    counts: COUNTS,
    n: COUNTS[depth],
    extraFilters: EXTRA_FILTERS,
    appliedExtra: [],
  });
}

// 自動で「勝率1位の艇」を外した: 4条件 41件 → 3条件 286件
const AUTO_COUNTS = { 4: 41, 3: 286, 2: 2210, 1: 9811 };
function similarAutoDropped(url) {
  const depthParam = url.searchParams.get("depth");
  const depth = depthParam ? Number(depthParam) : 3;
  return similarLayer({
    depth,
    autoDepth: 3,
    counts: AUTO_COUNTS,
    n: AUTO_COUNTS[depth],
    extraFilters: EXTRA_FILTERS,
    appliedExtra: [],
  });
}

// ---------------------------------------------------------------------------
// ルートと画面の操作
// ---------------------------------------------------------------------------

// state は可変。値を変えて page.reload() すると別の状態を返す（unroute を使わないため）
async function mockAnalogyApis(page, state) {
  await page.route(
    /\/api\/analogy\/race-contribution\/[^/?#]+/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.contribution ?? null),
      });
    },
  );
  await page.route(/\/api\/analogy\/similar\/[^/?#]+/, async (route) => {
    const url = new URL(route.request().url());
    const body = state.similar ? state.similar(url) : null;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// レース詳細は /race/:raceId（screens.md）。API は固定データを返すが、レース詳細そのものは
// 本番（録画）のデータで開くため、レースIDを固定値で書かず日別一覧 /races から辿る。
// /races のレースへのリンク名は仕様に無いため「NR」を含むリンクを仮定する（報告の曖昧点参照）
async function openRaceDetail(page) {
  await page.goto("/races");
  const raceLink = page.getByRole("link", { name: /\d{1,2}\s*R/ }).first();
  await expect(raceLink).toBeVisible();
  await raceLink.click();
  await expect(page).toHaveURL(/\/race\/[^/?#]+/);
}

async function openAiPredictionTab(page) {
  // タブ名「AI予想」（screens.md）。既存タブの role は仕様に無いので tab/button を許容する
  const aiTab = page
    .getByRole("tab", { name: /AI予想/ })
    .or(page.getByRole("button", { name: /AI予想/ }))
    .first();
  await expect(aiTab).toBeVisible();
  await aiTab.click();
}

function sectionOf(page) {
  // <section aria-labelledby> → 見出しで名前の付いた region
  return page.getByRole("region", { name: SECTION_HEADING });
}

async function openSection(page, state) {
  await mockAnalogyApis(page, state);
  await openRaceDetail(page);
  await openAiPredictionTab(page);
  const section = sectionOf(page);
  await expect(section).toBeVisible();
  return section;
}

async function reopenSection(page) {
  await page.reload();
  await openAiPredictionTab(page);
  const section = sectionOf(page);
  await expect(section).toBeVisible();
  return section;
}

// 節の innerText のうち、start の見出しから end の見出しの手前まで
async function textBetween(section, start, end) {
  const text = await section.innerText();
  const from = text.indexOf(start);
  if (from < 0) return "";
  const rest = text.slice(from);
  if (!end) return rest;
  const to = rest.indexOf(end, start.length);
  return to > 0 ? rest.slice(0, to) : rest;
}

// 2（似ている過去レース）の範囲: 見出しから h3「組み合わせ」の行の手前まで
const COMBO_LINE = /\n\s*組み合わせ\s*\n/;
async function part2Text(section) {
  const text = await section.innerText();
  const from = text.indexOf(H_SIMILAR);
  if (from < 0) return "";
  const rest = text.slice(from);
  const to = rest.search(COMBO_LINE);
  return to > 0 ? rest.slice(0, to) : rest;
}
async function part3Text(section) {
  const text = await section.innerText();
  const from = text.indexOf(H_SIMILAR);
  const rest = from >= 0 ? text.slice(from) : text;
  const m = rest.search(COMBO_LINE);
  return m >= 0 ? rest.slice(m) : "";
}
async function part1aText(section) {
  return textBetween(section, H_RACE, H_SLICE);
}

function conditionGroup(section) {
  return section.getByRole("group", { name: "条件", exact: true });
}
function extraGroup(section) {
  return section.getByRole("group", {
    name: "ほかのテーマでも絞る",
    exact: true,
  });
}
async function highlightedChipTexts(group) {
  // data-highlight="true" は screens.md の構造の表で決まっている属性
  return group.evaluate((el) =>
    Array.from(el.querySelectorAll('[data-highlight="true"]')).map(
      (e) => e.textContent ?? "",
    ),
  );
}

// シェア（0〜1）が % または小数で出ていることを表す正規表現
function shareRe(share) {
  const pct = share * 100;
  const int = Math.round(pct);
  const one = pct.toFixed(1).replace(".", "\\.").replace(/\\\.0$/, "(?:\\.0)?");
  const dec = String(share).replace(/^0/, "").replace(".", "\\.");
  return new RegExp(`(^|[^\\d.])(${one}|${int})\\s*%|(^|[^\\d])0?${dec}(?!\\d)`);
}

function num(n) {
  // 1,204 と 1204 の両方を許す
  const s = String(n);
  return s.length > 3 ? `${s.slice(0, -3)},?${s.slice(-3)}` : s;
}

// ---------------------------------------------------------------------------
// S-1 節の配置・全体の流れ
// ---------------------------------------------------------------------------

test.describe("S-1 節の構造", () => {
  test("[screens S-1/構造] AI予想タブに見出し（h2相当）「アナロジー・ファインダー」の節（region）が出る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByRole("heading", { name: SECTION_HEADING, level: 2 }),
    ).toBeVisible();
  });

  test("[screens S-1 Q1] 中は「何が効いているか」→「似ている過去レース」→「組み合わせ」の順の縦の1本の流れ（h3）", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const h1 = section.getByRole("heading", { name: H_WHAT, level: 3 });
    const h2 = section.getByRole("heading", { name: H_SIMILAR, level: 3 });
    const h3 = section.getByRole("heading", {
      name: H_COMBO,
      exact: true,
      level: 3,
    });
    await expect(h1).toBeVisible();
    await expect(h2).toBeVisible();
    await expect(h3).toBeVisible();
    const [b1, b2, b3] = await Promise.all([
      h1.boundingBox(),
      h2.boundingBox(),
      h3.boundingBox(),
    ]);
    expect(b1 && b2 && b3).toBeTruthy();
    expect(b1.y).toBeLessThan(b2.y);
    expect(b2.y).toBeLessThan(b3.y);
    // Q1: タブ切り替えはやめる
    await expect(section.getByRole("tab", { name: "類似レース" })).toHaveCount(
      0,
    );
  });

  test("[spec 2段階の全体計画/screens S-1] 既存の展開予測・イン崩れ注意度は残り、節はその下にある", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const heading = section.getByRole("heading", { name: SECTION_HEADING });
    const turn = page.getByText(/展開予測/).first();
    const volatility = page.getByText(/イン崩れ注意度/).first();
    // 節は予想の有無と切り離して出るが、既存ブロックは予想が無いレースでは出ない
    test.skip(
      !(await turn.isVisible()) || !(await volatility.isVisible()),
      "このレースには既存の予想ブロックが無い（予想なしのレース）",
    );
    const [hBox, tBox, vBox] = await Promise.all([
      heading.boundingBox(),
      turn.boundingBox(),
      volatility.boundingBox(),
    ]);
    expect(hBox && tBox && vBox).toBeTruthy();
    expect(tBox.y).toBeLessThan(hBox.y);
    expect(vBox.y).toBeLessThan(hBox.y);
  });

  test("[spec FR-1b/screens 1 の見出し] h3「何が効いているか」の下に「寄与度用のモデルの説明」の1行がある", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByRole("heading", { name: H_WHAT, level: 3 }),
    ).toBeVisible();
    await expect(
      section.getByText(/寄与度用のモデルの説明/).first(),
    ).toBeVisible();
  });

  test("[spec 位置づけ・非機能要件] 「AI がやらないこと」の説明文・「競艇」・総合点（AI指数）が節に無い", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await section.getByText(H_SLICE, { exact: true }).click();
    const text = await section.innerText();
    expect(text).not.toMatch(/AI\s*がやらないこと/);
    expect(text).not.toContain("競艇");
    expect(text).not.toMatch(/AI指数|総合点|総合スコア/);
  });

  test("[screens 1-a の段のラベルと注記] どの状態でも節に「間に合わない」「失敗」「エラー」が出ない", async ({
    page,
  }) => {
    const state = {
      contribution: raceContribution("before_not_yet"),
      similar: similarDefault,
    };
    let section = await openSection(page, state);
    const statuses = [
      "before_not_yet",
      "before_reflecting",
      "before_incomplete",
      "before_no_value",
      "after_exhibition",
      "absent",
    ];
    for (const status of statuses) {
      state.contribution = raceContribution(status);
      section = await reopenSection(page);
      await expect(section.getByText(H_SIMILAR)).toBeVisible();
      expect(await section.innerText(), `状態 ${status}`).not.toMatch(
        FORBIDDEN,
      );
    }
    // 計算できなかったレース・似たレースが無いレース
    state.contribution = null;
    state.similar = () => null;
    section = await reopenSection(page);
    expect(await section.innerText()).not.toMatch(FORBIDDEN);
  });
});

// ---------------------------------------------------------------------------
// FR-1b 1-a このレースの6艇の差の内訳
// ---------------------------------------------------------------------------

test.describe("FR-1b 1-a", () => {
  test("[spec FR-1b/screens 1-a 展示後] 段のラベル「展示後」と小さく「展示 15:32 時点」、変化の1行に艇番が入る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(section.getByRole("heading", { name: H_RACE })).toBeVisible();
    const t = await part1aText(section);
    expect(t).toContain("展示後");
    expect(t).toMatch(/展示\s*15:32\s*時点/);
    // spec FR-1b: 「展示タイムが押し上げたのは4号艇」
    expect(t).toMatch(/展示タイムが押し上げたのは\s*4号艇/);
    // 展示後の段では「展示前の値」のラベル・注記は出ない（折りたたみの summary を除く）
    expect(t).not.toContain(NOTE_A);
    expect(t).not.toContain(NOTE_B);
    expect(t).not.toContain(NOTE_C);
  });

  test("[spec FR-1b 受入基準] 展示後の段で「展示前の値を見る」を開くと出走表時点の値が出る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const summary = section.getByText("展示前の値を見る", { exact: true });
    await expect(summary).toBeVisible();
    // 展示後の ST・直前情報 .148 は見えていて、展示前の .061 は閉じている間は見えない
    expect(await part1aText(section)).toMatch(shareRe(0.148));
    expect(await part1aText(section)).not.toMatch(shareRe(0.061));
    await summary.click();
    await expect.poll(async () => part1aText(section)).toMatch(shareRe(0.061));
  });

  test("[spec FR-1b] テーマ別のシェアを6テーマで出し、「市場」は出さない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const t = await part1aText(section);
    for (const theme of THEMES) expect(t).toContain(theme);
    expect(t).not.toContain("市場");
    // 選手・基礎成績 .452
    expect(t).toMatch(shareRe(0.452));
  });

  test("[spec FR-1b/screens RaceContributionView] 艇ごとの押し上げ／押し下げを符号つきで出す", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const t = await part1aText(section);
    expect(t).toMatch(/[+＋]\s*(0?\.\d+|\d+(\.\d+)?\s*(pt|%))/);
    expect(t).toMatch(/[−-]\s*(0?\.\d+|\d+(\.\d+)?\s*(pt|%))/);
  });

  test("[screens 1-a (a)] まだ展示が終わっていない: 「展示前の値」＋「展示の後に更新します」、変化の1行・折りたたみは無い", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("before_not_yet"),
      similar: similarDefault,
    });
    await expect(section.getByRole("heading", { name: H_RACE })).toBeVisible();
    const t = await part1aText(section);
    expect(t).toContain("展示前の値");
    expect(t).toContain(NOTE_A);
    expect(t).not.toMatch(/押し上げたのは/);
    expect(t).not.toMatch(/展示\s*\d{1,2}:\d{2}\s*時点/);
    await expect(
      section.getByText("展示前の値を見る", { exact: true }),
    ).toHaveCount(0);
  });

  test("[screens 1-a (b)] 展示後まだ反映されていない: 「展示前の値」＋「展示の結果を反映しています」", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("before_reflecting"),
      similar: similarDefault,
    });
    await expect(section.getByRole("heading", { name: H_RACE })).toBeVisible();
    const t = await part1aText(section);
    expect(t).toContain("展示前の値");
    expect(t).toContain(NOTE_B);
    expect(t).not.toContain(NOTE_A);
    expect(t).not.toContain(NOTE_C);
  });

  test("[screens 1-a (c)] 展示タイムがそろわない: 「展示前の値」＋「このレースは展示データがそろっていないため、展示前の値です」", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("before_incomplete"),
      similar: similarDefault,
    });
    await expect(section.getByRole("heading", { name: H_RACE })).toBeVisible();
    const t = await part1aText(section);
    expect(t).toContain("展示前の値");
    expect(t).toContain(NOTE_C);
  });

  test("[screens 1-a (d)] 締切後も展示後の値が無い: 「展示前の値」だけで注記（理由）を書かない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("before_no_value"),
      similar: similarDefault,
    });
    await expect(section.getByRole("heading", { name: H_RACE })).toBeVisible();
    const t = await part1aText(section);
    expect(t).toContain("展示前の値");
    expect(t).not.toContain(NOTE_A);
    expect(t).not.toContain(NOTE_B);
    expect(t).not.toContain(NOTE_C);
    // 事実でない理由（データがそろっていない等）を書かない
    expect(t).not.toMatch(/そろっていない|取得できな|遅れ/);
  });

  test("[spec FR-1b 受入基準/screens S-1] 欠場があるレースでは1-aを出さず、欠場の1行を出す。1-b は出す", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("absent"),
      similar: similarDefault,
    });
    await expect(section.getByText(ABSENT_LINE)).toBeVisible();
    await expect(section.getByRole("heading", { name: H_RACE })).toHaveCount(0);
    await expect(section.getByText(/展示前の値|展示後/)).toHaveCount(0);
    await expect(section.getByText(H_SLICE, { exact: true })).toBeVisible();
  });

  test("[screens S-1] 計算できなかったレースでは1-aを出さず、1-b は出す", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: null,
      similar: similarDefault,
    });
    await expect(
      section.getByRole("heading", { name: H_WHAT, level: 3 }),
    ).toBeVisible();
    await expect(section.getByRole("heading", { name: H_RACE })).toHaveCount(0);
    await expect(section.getByText(H_SLICE, { exact: true })).toBeVisible();
  });

  test("[screens S-1] 1-a の下にモデルの版を出す（展示前・展示後とも）", async ({
    page,
  }) => {
    const state = {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    };
    let section = await openSection(page, state);
    expect(await part1aText(section)).toContain(RC_MODEL_VERSION);
    state.contribution = raceContribution("before_not_yet");
    section = await reopenSection(page);
    expect(await part1aText(section)).toContain(RC_MODEL_VERSION);
  });

  test("[spec FR-1b] 変化の1行はテーマのシェアの差を文にしない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const t = await part1aText(section);
    // 「ST・直前の比重が上がった」のような文を出さない
    expect(t).not.toMatch(/(比重|シェア|割合)が(上が|下が|増え|減)/);
  });
});

// ---------------------------------------------------------------------------
// FR-1 1-b 同じ条件のレース全体の内訳（既存の寄与度の部品。API は固定しない）
// ---------------------------------------------------------------------------

test.describe("FR-1 1-b", () => {
  async function openSlice(page) {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const summary = section.getByText(H_SLICE, { exact: true });
    await expect(summary).toBeVisible();
    await summary.click();
    return section;
  }

  test("[screens 1-b Q2] 「同じ条件のレース全体の内訳」は折りたたみで、開くと各テーマに「全体との差 ±N.Npt」か「全体とほぼ同じ」が出る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const diff = section.getByText(
      /全体との差\s*[+＋−-]?\s*\d+(\.\d+)?\s*pt|全体とほぼ同じ/,
    );
    await expect(diff.first()).toBeHidden();
    await section.getByText(H_SLICE, { exact: true }).click();
    await expect(diff.first()).toBeVisible();
    const t = await textBetween(section, H_SLICE, H_SIMILAR);
    for (const theme of THEMES) expect(t).toContain(theme);
    const matches = t.match(
      /全体との差\s*[+＋−-]?\s*\d+(\.\d+)?\s*pt|全体とほぼ同じ/g,
    );
    expect((matches ?? []).length).toBeGreaterThanOrEqual(THEMES.length);
    expect(t).not.toContain("市場");
  });

  test("[spec FR-1 受入基準] 着順タブ（1着／2着以内／3着以内）の切り替えで内訳が変わる", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const tab = (name) =>
      section
        .getByRole("tab", { name, exact: true })
        .or(section.getByRole("button", { name, exact: true }))
        .first();
    for (const name of ["1着", "2着以内", "3着以内"]) {
      await expect(tab(name)).toBeVisible();
    }
    await tab("1着").click();
    const before = await textBetween(section, H_SLICE, H_SIMILAR);
    await tab("3着以内").click();
    await expect
      .poll(async () => textBetween(section, H_SLICE, H_SIMILAR))
      .not.toBe(before);
  });

  test("[spec FR-1 受入基準] グレード・ラウンドの切り替えでシェアと n が変わる", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const detail = section.getByText("詳細条件", { exact: true });
    if (await detail.isVisible()) await detail.click();
    const grade = section.getByRole("combobox", { name: /グレード/ });
    const round = section.getByRole("combobox", { name: /ラウンド/ });
    await grade.selectOption({ label: "一般" });
    const before = await textBetween(section, H_SLICE, H_SIMILAR);
    await grade.selectOption({ label: "SG" });
    await expect
      .poll(async () => textBetween(section, H_SLICE, H_SIMILAR))
      .not.toBe(before);
    await round.selectOption({ label: "予選" });
    const mid = await textBetween(section, H_SLICE, H_SIMILAR);
    await round.selectOption({ label: "優勝戦" });
    await expect
      .poll(async () => textBetween(section, H_SLICE, H_SIMILAR))
      .not.toBe(mid);
  });

  test("[spec FR-1] グレード（一般／G3／G2／G1／SG）とラウンド（予選／準優勝戦／優勝戦／その他）を選べる", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const detail = section.getByText("詳細条件", { exact: true });
    if (await detail.isVisible()) await detail.click();
    const grade = section.getByRole("combobox", { name: /グレード/ });
    const round = section.getByRole("combobox", { name: /ラウンド/ });
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

  test("[spec FR-1] n（レース数と艇数）・集計期間・モデル版を出し、n（レース数）<30 のときだけ「小標本」", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const t = await textBetween(section, H_SLICE, H_SIMILAR);
    const m = t.match(/([\d,]+)\s*レース/);
    expect(m, "レース数の表示が無い").toBeTruthy();
    expect(t).toMatch(/[\d,]+\s*艇/);
    expect(t).toMatch(/\d{4}.{0,2}\d{1,2}.{0,3}〜/);
    expect(t).toMatch(/モデル/);
    const races = Number(m[1].replace(/,/g, ""));
    if (races < 30) expect(t).toContain("小標本");
    else expect(t).not.toContain("小標本");
  });

  test("[spec FR-1 受入基準] 艇番比較の比較表（テーマ／艇番A／艇番B）に両艇番の値が並ぶ", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const toggle = section
      .getByRole("checkbox", { name: /比較/ })
      .or(section.getByRole("button", { name: /艇番.*比較|比較/ }))
      .first();
    await toggle.click();
    const table = section.getByRole("table").filter({
      has: page.getByRole("columnheader", { name: /テーマ/ }),
    });
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(3);
    for (const theme of THEMES) {
      const row = table.getByRole("row").filter({ hasText: theme });
      await expect(row).toBeVisible();
      const cells = await row.getByRole("cell").allInnerTexts();
      expect(cells.length).toBeGreaterThanOrEqual(2);
      expect(cells.at(-1)).toMatch(/\d/);
      expect(cells.at(-2)).toMatch(/\d/);
    }
  });

  test("[spec FR-1 受入基準] テーマを押すと個別項目の内訳が開き、個別値は参考である旨が出る", async ({
    page,
  }) => {
    const section = await openSlice(page);
    const theme = section
      .getByRole("button", { name: /選手・基礎成績/ })
      .first();
    await expect(theme).toBeVisible();
    await theme.click();
    await expect(section.getByText(/参考/).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// FR-2 似ている過去レース
// ---------------------------------------------------------------------------

test.describe("FR-2 似ている過去レース", () => {
  test("[screens 2 の見出し Q7/S-1 データ段] h3「類似度の高い過去レース」の下に「出走表 7:30 時点のデータ（前日までの成績）」", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const heading = section.getByRole("heading", { name: H_SIMILAR, level: 3 });
    await expect(heading).toBeVisible();
    const tier = section.getByText(
      /出走表\s*7:30\s*時点のデータ（前日までの成績）/,
    );
    await expect(tier.first()).toBeVisible();
    const [hb, tb] = await Promise.all([
      heading.boundingBox(),
      tier.first().boundingBox(),
    ]);
    expect(hb && tb).toBeTruthy();
    expect(tb.y).toBeGreaterThan(hb.y);
    // 発走前のレースでは「（発走前）」を付けない
    expect(await part2Text(section)).not.toContain("（発走前）");
  });

  test("[screens S-1 データ段] 確定済みのレースはデータ段に「（発走前）」を付ける", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: (url) => ({ ...similarDefault(url), race_finished: true }),
    });
    await expect(
      section
        .getByText(
          /出走表\s*7:30\s*時点のデータ（前日までの成績）\s*（発走前）/,
        )
        .first(),
    ).toBeVisible();
  });

  test("[spec FR-1b] 展示後でも似ているレースは出走表時点のまま（データ段に展示の時刻が入らない）", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const t = await part2Text(section);
    expect(t).toMatch(/出走表\s*7:30\s*時点/);
    expect(t).not.toMatch(/展示\s*15:32/);
  });

  test("[spec FR-2/screens 条件チップ] 「条件」グループに4条件（名前と値）が並び、「外す」は末尾の1つだけ", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = conditionGroup(section);
    await expect(group).toBeVisible();
    const t = await group.innerText();
    for (const name of ["勝率差", "1号艇の級別", "会場", "勝率1位の艇"]) {
      expect(t).toContain(name);
    }
    expect(t).toMatch(/[−-]0\.49\s*〜\s*[+＋]0\.19/);
    expect(t).toContain("A1");
    expect(t).toContain("大村");
    await expect(group.getByRole("button", { name: /外す/ })).toHaveCount(1);
    await expect(group.getByRole("button", { name: /戻す/ })).toHaveCount(0);
  });

  test("[spec FR-2 文面ルール1・2・4] 理由の一文は条件の値と「この4つがすべて同じ過去レース」と件数。%を見出しに出さず、帯は範囲のまま", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const reason = section.getByText(/この4つがすべて同じ過去レース/).first();
    await expect(reason).toBeVisible();
    const r = await reason.innerText();
    expect(r).toMatch(/640\s*件/);
    expect(r).not.toMatch(/%/);
    expect(r).toMatch(/[−-]0\.49\s*〜\s*[+＋]0\.19/);
    expect(r).not.toMatch(/勝率差が(大きい|小さい|拮抗|近い)/);
    expect(r).toContain("大村");
    expect(r).toContain("A1");
  });

  test("[spec FR-2 文面ルール5・6] 2 の中に「AI」「類似度○%」「ほぼ同じ」、条件外の項目が似ているという言い方が無い", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByText(/この4つがすべて同じ過去レース/).first(),
    ).toBeVisible();
    const t = await part2Text(section);
    expect(t).not.toMatch(/AI/);
    expect(t).not.toMatch(/類似度\s*\d+\s*%/);
    expect(t).not.toContain("ほぼ同じ");
    expect(t).not.toMatch(/(モーター|機力|展示|気象|風|波).{0,8}似て/);
  });

  test("[spec FR-2 受入基準] 階級ラベル（鉄板級／有力／混戦／大混戦／まだ参考程度）を出さない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByText(/この4つがすべて同じ過去レース/).first(),
    ).toBeVisible();
    const t = (await part2Text(section)) + (await part3Text(section));
    for (const label of ["鉄板級", "有力", "混戦", "まだ参考程度"]) {
      expect(t).not.toContain(label);
    }
    for (const emoji of ["🔥", "📌", "⚖️", "🌊", "🌀"]) {
      expect(t).not.toContain(emoji);
    }
  });

  test("[spec FR-2 受入基準/screens 条件チップ] 末尾を「外す」と親の層に広がり件数・分布・n が連動し、「戻す」で元に戻る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = conditionGroup(section);
    await expect(
      section.getByText(/352\s*件\s*55\.0\s*%/).first(),
    ).toBeVisible();
    await group.getByRole("button", { name: /外す/ }).click();
    // 4条件 640件 → 3条件 1,204件
    await expect
      .poll(async () => part2Text(section))
      .toMatch(new RegExp(`${num(1204)}\\s*件`));
    await expect(section.getByText(/352\s*件\s*55\.0\s*%/)).toHaveCount(0);
    // 外したチップの先頭に「戻す」、末尾（3つ目）に「外す」
    await expect(group.getByRole("button", { name: /戻す/ })).toHaveCount(1);
    await expect(group.getByRole("button", { name: /外す/ })).toHaveCount(1);
    // 使った条件・外した条件・件数が常に出る
    const g = await group.innerText();
    expect(g).toContain("勝率1位の艇");
    await group.getByRole("button", { name: /戻す/ }).click();
    await expect(
      section.getByText(/352\s*件\s*55\.0\s*%/).first(),
    ).toBeVisible();
    await expect(group.getByRole("button", { name: /戻す/ })).toHaveCount(0);
  });

  test("[spec FR-2 件数と戻し方/screens 似ている理由] 自動で外したときは「同じ4条件では 41件と少ないため、『勝率1位の艇』を外して 286件で見ています」", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarAutoDropped,
    });
    await expect(
      section
        .getByText(
          /同じ4条件では\s*41\s*件と少ないため、『勝率1位の艇』を外して\s*286\s*件で見ています/,
        )
        .first(),
    ).toBeVisible();
    const group = conditionGroup(section);
    await expect(group.getByRole("button", { name: /戻す/ })).toHaveCount(1);
    // 戻すと4条件（41件）でも表示する
    await group.getByRole("button", { name: /戻す/ }).click();
    await expect
      .poll(async () => part2Text(section))
      .toMatch(/この4つがすべて同じ過去レース[\s\S]*41\s*件/);
  });

  test("[spec FR-1b/screens 条件チップ Q4] 1-a の上位2テーマのシェアの差が .05 以上なら、上位テーマ（選手・基礎成績）のチップだけ強調する", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = conditionGroup(section);
    await expect(group).toBeVisible();
    const texts = (await highlightedChipTexts(group)).join(" | ");
    expect(texts).toContain("勝率1位の艇");
    expect(texts).toContain("級別");
    expect(texts).toContain("勝率差");
    expect(texts).not.toContain("大村");
  });

  test("[spec FR-1b/screens 条件チップ Q4] 上位2テーマのシェアの差が .05 未満ならチップを強調しない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition", {
        themes: CLOSE_THEMES,
        before_exhibition: { themes: CLOSE_THEMES, boats: BOATS },
      }),
      similar: similarDefault,
    });
    const group = conditionGroup(section);
    await expect(group).toBeVisible();
    expect(await highlightedChipTexts(group)).toHaveLength(0);
  });

  test("[spec FR-2/screens 分布] 「決まり手」「1着の艇番」「1着の進入コース」「よく出た出目」の4ブロックに n と期間、行は「N件 x.x%」（件数÷n）", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    for (const name of DIST_HEADINGS) {
      await expect(
        section.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    // 逃げ 352 ÷ 640 = 55.0%
    await expect(
      section.getByText(/352\s*件\s*55\.0\s*%/).first(),
    ).toBeVisible();
    const t = await part2Text(section);
    const periods =
      t.match(/2019.{0,3}0?4[\s\S]{0,6}〜[\s\S]{0,3}2026.{0,3}0?9/g) ?? [];
    expect(periods.length).toBeGreaterThanOrEqual(DIST_HEADINGS.length);
    const ns = t.match(/n\s*[=＝]\s*640(?!\d)|640\s*件/g) ?? [];
    expect(ns.length).toBeGreaterThanOrEqual(DIST_HEADINGS.length);
  });

  test("[spec FR-2 件数と戻し方 Q5] 30件未満でも割合（件数÷n）を出し、件数を添える", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const motor = extraGroup(section).getByRole("button", {
      name: /1号艇のモーター/,
    });
    await motor.click();
    // 24件の層: 逃げ 13 ÷ 24 = 54.2%
    await expect(
      section.getByText(/13\s*件\s*54\.2\s*%/).first(),
    ).toBeVisible();
    expect(await part2Text(section)).toMatch(/24\s*件/);
  });

  test("[spec FR-2/screens 一覧] 「同じ条件の過去レース」に新しい順20件（日付 会場 R）", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByText("同じ条件の過去レース", { exact: true }).first(),
    ).toBeVisible();
    const items = section
      .getByRole("listitem")
      .filter({ hasText: /(大村|徳山|下関|芦屋)[\s\S]*\d{1,2}\s*R/ });
    await expect(items).toHaveCount(20);
    // 新しい順: 先頭が 2026-09-28 大村 1R
    const first = await items.first().innerText();
    expect(first).toMatch(/9.{0,2}28/);
    expect(first).toContain("大村");
    const last = await items.last().innerText();
    expect(last).toMatch(/9.{0,2}0?9(?!\d)/);
  });

  test("[spec FR-2] 常設の注記「類似の判定には事故情報を含まない」が出る", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(section.getByText(ACCIDENT_NOTE).first()).toBeVisible();
  });

  test("[screens S-1] get_analogy_similar が NULL なら 2・3 を出さず、1 は出す", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: () => null,
    });
    await expect(
      section.getByRole("heading", { name: H_WHAT, level: 3 }),
    ).toBeVisible();
    await expect(section.getByRole("heading", { name: H_SIMILAR })).toHaveCount(
      0,
    );
    await expect(
      section.getByRole("heading", { name: H_COMBO, exact: true }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// FR-2 ほかのテーマでも絞る（Q6）
// ---------------------------------------------------------------------------

test.describe("FR-2 ほかのテーマでも絞る", () => {
  test("[spec FR-2 Q6/screens] 今日の値と「足すと N件」を名前に持つトグル（aria-pressed）が並び、0件のものは押せない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = extraGroup(section);
    await expect(group).toBeVisible();
    const round = group.getByRole("button", {
      name: /ラウンド[:：]\s*予選.*足すと\s*212\s*件/,
    });
    const grade = group.getByRole("button", {
      name: /グレード[:：]\s*G1.*足すと\s*0\s*件/,
    });
    const motor = group.getByRole("button", {
      name: /1号艇のモーター[:：]\s*6艇中1〜2位.*足すと\s*24\s*件/,
    });
    await expect(round).toHaveAttribute("aria-pressed", "false");
    await expect(motor).toHaveAttribute("aria-pressed", "false");
    await expect(grade).toBeDisabled();
    await expect(round).toBeEnabled();
  });

  test("[spec FR-2 Q6/screens] 押すと aria-pressed が true、理由に「さらに『ラウンド: 予選』で絞って N件」、下に「この条件は自動では使っていません」", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = extraGroup(section);
    await expect(section.getByText(NOT_AUTO_NOTE)).toHaveCount(0);
    const round = group.getByRole("button", { name: /ラウンド[:：]\s*予選/ });
    await round.click();
    await expect(round).toHaveAttribute("aria-pressed", "true");
    await expect(section.getByText(NOT_AUTO_NOTE).first()).toBeVisible();
    await expect(
      section
        .getByText(/さらに『ラウンド[:：]\s*予選』で絞って\s*212\s*件/)
        .first(),
    ).toBeVisible();
    // 4条件の部分はそのまま残る
    await expect(
      section.getByText(/この4つがすべて同じ過去レース/).first(),
    ).toBeVisible();
    // オフに戻すと注記が消え、640件に戻る
    await round.click();
    await expect(round).toHaveAttribute("aria-pressed", "false");
    await expect(section.getByText(NOT_AUTO_NOTE)).toHaveCount(0);
    await expect(
      section.getByText(/352\s*件\s*55\.0\s*%/).first(),
    ).toBeVisible();
  });

  test("[spec FR-2 Q6] 今日のレースの値が分からない条件は出さない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: (url) => ({
        ...similarDefault(url),
        extra_filters: EXTRA_FILTERS.map((f) =>
          f.key === "motor" ? { ...f, value: null } : f,
        ),
      }),
    });
    const group = extraGroup(section);
    await expect(group.getByRole("button", { name: /ラウンド/ })).toBeVisible();
    await expect(group.getByRole("button", { name: /モーター/ })).toHaveCount(
      0,
    );
  });

  test("[screens ほかのテーマでも絞る] 並びは 1-a の寄与度の順（機力 > 環境 ならモーターが先）で、「効く順」とは書かない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const group = extraGroup(section);
    const motor = group.getByRole("button", { name: /1号艇のモーター/ });
    const round = group.getByRole("button", { name: /ラウンド/ });
    await expect(motor).toBeVisible();
    await expect(round).toBeVisible();
    const names = await group
      .getByRole("button")
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") || e.textContent || ""),
      );
    const iMotor = names.findIndex((n) => n.includes("モーター"));
    const iRound = names.findIndex((n) => n.includes("ラウンド"));
    expect(iMotor).toBeGreaterThanOrEqual(0);
    expect(iMotor).toBeLessThan(iRound);
    expect(await section.innerText()).not.toContain("効く順");
  });
});

// ---------------------------------------------------------------------------
// FR-3 組み合わせ
// ---------------------------------------------------------------------------

const BAND_12 = /^1着 ([1-6])号艇→2着 ([1-6])号艇 (\d+)件 (\d+(?:\.\d+)?)%$/;
const BAND_23 = /^2着 [1-6]号艇→3着 [1-6]号艇 \d+件 \d+(?:\.\d+)?%$/;

test.describe("FR-3 組み合わせ", () => {
  test("[spec FR-3 受入基準] サンキーは1着→2着→3着の3段が常に出て、1→2 の帯の件数・%（件数÷n）が類似レースの層と一致する", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByRole("heading", { name: H_COMBO, exact: true, level: 3 }),
    ).toBeVisible();
    // 1-2: 1-2-3(120) + 1-2-4(70) = 190 → 190/640 = 29.7%
    await expect(
      section.getByRole("button", { name: "1着 1号艇→2着 2号艇 190件 29.7%" }),
    ).toBeVisible();
    await expect(
      section.getByRole("button", { name: BAND_23 }).first(),
    ).toBeAttached();
    // 少ない流れ（4-5: 15件）も「その他」にまとめない
    await expect(
      section.getByRole("button", { name: "1着 4号艇→2着 5号艇 15件 2.3%" }),
    ).toBeAttached();
    await expect(section.getByRole("button", { name: /その他/ })).toHaveCount(
      0,
    );
    // 図の下に全体の n
    expect(await part3Text(section)).toMatch(/n\s*[=＝]\s*640(?!\d)|640\s*件/);
  });

  test("[spec FR-3] 帯をタップすると件数と%を出す", async ({ page }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const band = section.getByRole("button", {
      name: "1着 1号艇→2着 2号艇 190件 29.7%",
    });
    await band.click();
    await expect(
      section.getByText(/190\s*件[・\s]*29\.7\s*%/).first(),
    ).toBeVisible();
  });

  test("[spec FR-3/screens 3] 組み合わせ一覧は上位10件と「その他」の1行で、シェアの合計が100%（丸め誤差を除く）", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await expect(
      section.getByRole("heading", { name: H_COMBO, exact: true }),
    ).toBeVisible();
    const lines = (await part3Text(section))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const comboLines = lines.filter(
      (l) => /(^|\D)[1-6]-[1-6]-[1-6](\D|$)/.test(l) && /%/.test(l),
    );
    const otherLines = lines.filter((l) => /^その他/.test(l) && /%/.test(l));
    const combos = new Set(
      comboLines.map((l) => l.match(/[1-6]-[1-6]-[1-6]/)[0]),
    );
    expect(combos.size).toBe(10);
    // 11位以下（5-1-2・3-4-1・6-1-2・4-5-6）は一覧に個別の行を持たない
    for (const c of ["5-1-2", "3-4-1", "6-1-2", "4-5-6"])
      expect(combos.has(c)).toBe(false);
    expect(otherLines).toHaveLength(1);
    // 同じ組み合わせが複数行に出ても1回だけ数える
    const byCombo = new Map();
    for (const l of comboLines) {
      const c = l.match(/[1-6]-[1-6]-[1-6]/)[0];
      if (!byCombo.has(c)) byCombo.set(c, l);
    }
    let total = 0;
    for (const l of [...byCombo.values(), ...otherLines]) {
      total += Number(l.match(/(\d+(?:\.\d+)?)\s*%/)[1]);
    }
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  test("[spec FR-3/screens 3] 「1号艇以外が1着のレースだけ」を押すと aria-pressed が true になり、1号艇1着の帯・組み合わせが消える", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    const toggle = section.getByRole("button", {
      name: "1号艇以外が1着のレースだけ",
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(
      section.getByRole("button", { name: /^1着 1号艇→/ }),
    ).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: /^1着 2号艇→/ }).first(),
    ).toBeVisible();
    const t = await part3Text(section);
    expect(t).not.toMatch(/(^|\D)1-[2-6]-[2-6]/m);
  });

  test("[spec FR-3/screens 3] 組み合わせは2と同じ層: 条件を外すと n が連動する", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    expect(await part3Text(section)).toMatch(/640/);
    await conditionGroup(section).getByRole("button", { name: /外す/ }).click();
    await expect
      .poll(async () => part3Text(section))
      .toMatch(new RegExp(num(1204)));
    await expect(
      section.getByRole("button", { name: BAND_12 }).first(),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 非機能要件
// ---------------------------------------------------------------------------

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("[spec 非機能要件] 375px で節（展示後・1-b と展示前を開いた状態）に横スクロールが出ない", async ({
    page,
  }) => {
    const section = await openSection(page, {
      contribution: raceContribution("after_exhibition"),
      similar: similarDefault,
    });
    await section.getByText("展示前の値を見る", { exact: true }).click();
    await section.getByText(H_SLICE, { exact: true }).click();
    await expect(
      section.getByRole("heading", { name: H_COMBO, exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
