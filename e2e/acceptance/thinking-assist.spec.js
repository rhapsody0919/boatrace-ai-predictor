import { test, expect } from "../fixtures.js";
import {
  routeThinkingAssistV16,
  THINKING_ASSIST_RACE,
} from "../thinking-assist-fixture.js";

// 思考アシスト（BOA-430）の受け入れE2E。
// docs/design/thinking-assist/spec.md と screens.md だけから書いた（plan/tasks/src は読んでいない）。
// 決定事項 D-1〜D-37（D-37 が最新）の内容で書いている。
//
// ■ 開くレース
//   e2e/thinking-assist-fixture.js の例のレース 2026-10-06 徳山10R（準優勝戦・1号艇B1、venue_code=18）。
//   本番の v16（facts・similar・scenario）はこのレースの展示後の段を持たない（status=exhibition_missing）。
//   出走表・展示・オッズ等（v16 以外のデータ）は本番 Supabase のそのままの値を使う（実際に開催済みのレースなので
//   展示データ等は揃っている前提）。spec・screens に raceId までの導線が書かれていない（新規ページで、
//   公開前はレース詳細からの入口が無い。FR-1）ため、URL を直接組み立てて開いている。
//
// ■ API のモック
//   /api/analogy/{facts,similar,scenario}/** は e2e/thinking-assist-fixture.js の routeThinkingAssistV16 で
//   固定する（本番の v16 の応答をそのまま使った JSON）。overrides で状態を差し替える（D-37 の NCR フォールバック、
//   v16 の保存が無い状態）。/rest/v1/venue_technique_period_stats（D-35 P-2・D-37 U-18）はこのファイルで
//   page.route により差し替える。この表の列名は migration 134 を読んでいない（入力を spec.md・screens.md だけに
//   絞っているため）ので、venueTechniqueRow() は複数の候補の列名を推測で埋めている。実装の列名が違う場合は
//   venueTechniqueRow() の返す行の形だけ直せばよい（検証の expect は変えない。analogy-finder.spec.js と同じ考え方）。
//   それ以外の /rest/v1/* は e2e/fixtures.js の録画の再生（無ければ本番への素通し）に任せる。
//
// ■ ロケータの前提（実装前なので DOM が無い。仕様から読み取れる固定の文言・ロールだけを使っている）
//   - レンズの4ボタンの名前「軸」「展開」「機力」「買い目」はscreens.md Bレンズの節に明記されている
//   - 艇の行の名前に「{n}号艇」が含まれる前提（N-6「艇番を必ず添える」、他の思考アシスト関連ドキュメントの
//     表記に合わせた）。実装がこの文言を使わない場合はズレる
//   - ヘッダーの会場名トリガー「{会場} ›」はボタンかリンクである前提（screens.md「Aヘッダーの会場名」）
//   - 「堅い？荒れる？」の枠・セオリーカードが role="region" 等のアクセシブルな領域を持つかは明記が無いため、
//     ページ全体に対する getByText で確認している（他のセクションの同一文言と衝突するリスクはテストごとに検討した）

const RACE_ID = THINKING_ASSIST_RACE; // "2026-10-06-18-10"
const ASSIST_URL = `/race/${RACE_ID}/assist`;
const RACE_DETAIL_URL = `/race/${RACE_ID}`;
const VENUE = "徳山";

// facts.today.scope_keys["1"]（e2e/thinking-assist-fixture.js の thinkingAssistScopeKeys() と同じ）
const SCOPE_KEYS = {
  VC: "VC:18:2-2-2-0:1B1",
  NC: "NC:2-2-2-0:1B1",
  NCR: "NCR:2-2-2-0:1B1:junyu",
  VA: "VA:18",
  NA: "NA",
};

async function openAssist(page, opts = {}) {
  await routeThinkingAssistV16(page, opts);
  await page.goto(ASSIST_URL);
}

// ---------------------------------------------------------------------------
// 会場の決まり手の期間表（D-35 P-2・D-37 U-18）。venue_technique_period_stats の
// 列名は不明なので、候補になりそうな列名を複数持たせた行を返す
// ---------------------------------------------------------------------------
function venueTechniqueRow(technique, periodDays, raceCount, hitCount) {
  return {
    venue_code: 18,
    venue: VENUE,
    technique,
    kimarite: technique,
    period_days: periodDays,
    window_days: periodDays,
    days: periodDays,
    race_count: raceCount,
    n: raceCount,
    count: raceCount,
    hit_count: hitCount,
    hits: hitCount,
    rate: hitCount / raceCount,
  };
}

async function routeVenueTechniqueStats(page, rows) {
  await page.route("**/rest/v1/venue_technique_period_stats*", (route) =>
    route.fulfill({ json: rows }),
  );
}

async function clickLens(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}

// ======================================================================
// FR-1 入口とフラグ
// ======================================================================

test.describe("思考アシスト: 入口とフラグ", () => {
  test("[spec FR-1 受入基準] フラグが無い状態ではレース詳細に思考アシストの入口が出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: false });
    await page.goto(RACE_DETAIL_URL);
    await expect(
      page
        .getByRole("link", { name: /思考アシスト/ })
        .or(page.getByRole("button", { name: /思考アシスト/ })),
    ).toHaveCount(0);
  });

  test("[screens 状態 フラグが無い] フラグが無くても /race/{id}/assist を直接開くと表示される", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page, { preview: false });
    await page.goto(ASSIST_URL);
    await expect(page.getByText(VENUE)).toBeVisible();
    await expect(page.getByText(/準優勝戦/)).toBeVisible();
  });
});

// ======================================================================
// D-37 U-17: 準優勝戦の日の「全国・級の並びが同じ」はラウンドをそろえる（NCR）
// ======================================================================

test.describe("思考アシスト: 準優勝戦の数え方（D-37 U-17）", () => {
  test("[spec D-37 U-17] 準優勝戦の日は「全国・級の並びが同じ」が同じラウンド（NCR・112件）に絞られ、58%・矢印なしの「差ははっきりしない」になる", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(
      page.getByText("全国・級の並びが同じ準優勝戦 112件"),
    ).toBeVisible();
    await expect(page.getByText("58%")).toBeVisible();
    await expect(page.getByText("差ははっきりしない")).toBeVisible();
  });

  test("[spec D-37 U-17] 「数え方は2つ ›」を開くと予選も含めた33%（3,276件）が1行で出る", async ({
    page,
  }) => {
    await openAssist(page);
    await page
      .getByRole("button", { name: /数え方は2つ/ })
      .first()
      .click();
    await expect(
      page.getByText(/予選も含めると\s*33%（?3,276件）?/),
    ).toBeVisible();
  });

  test("[spec D-37 U-17] NCRが30件未満ならラウンドを問わないNC（3,276件）に戻り、矢印なし・「件数少なめ」になる", async ({
    page,
  }) => {
    await openAssist(page, {
      overrides: {
        scenario: (body) => {
          if (body.scope === SCOPE_KEYS.NCR) {
            body.scenario.n = 12;
            body.scenario.cells.all.forms.any.n = 12;
            body.scenario.cells.all.forms.any.payout_known = 12;
          }
          return body;
        },
      },
    });
    await expect(
      page.getByText(/全国・級の並びが同じ\s*3,276件・件数少なめ/),
    ).toBeVisible();
    await expect(page.getByText("全国・級の並びが同じ準優勝戦")).toHaveCount(0);
    await expect(page.getByText(/高め|低め/)).toHaveCount(0);
  });
});

// ======================================================================
// D-37 U-18: 会場の決まり手「最近↑／↓」は直近90日 対 それより前の275日
// ======================================================================

test.describe("思考アシスト: 会場の決まり手（D-37 U-18）", () => {
  test("[spec D-37 U-18] 直近90日と前275日のぶれ幅が重ならない行にだけ「最近↑／↓」が付き、重なる行には矢印も「変化なし」も出ない", async ({
    page,
  }) => {
    await routeThinkingAssistV16(page);
    await routeVenueTechniqueStats(page, [
      // 差し: 直近90日50%(50/100)、前275日20%((130-50)/(500-100))。ぶれ幅が重ならない差 → 最近↑
      venueTechniqueRow("差し", 90, 100, 50),
      venueTechniqueRow("差し", 365, 500, 130),
      // まくり: 直近90日30%(30/100)、前275日31%((154-30)/(500-100))。ぶれ幅が重なる → 矢印なし
      venueTechniqueRow("まくり", 90, 100, 30),
      venueTechniqueRow("まくり", 365, 500, 154),
    ]);
    await page.goto(ASSIST_URL);
    await page
      .getByRole("button", { name: new RegExp(VENUE) })
      .or(page.getByRole("link", { name: new RegExp(VENUE) }))
      .first()
      .click();

    await expect(page.getByText(/差し.*最近↑/)).toBeVisible();
    await expect(page.getByText(/90日50%/)).toBeVisible();
    await expect(page.getByText(/前20%/)).toBeVisible();

    await expect(page.getByText(/まくり.*最近[↑↓]/)).toHaveCount(0);
    await expect(page.getByText("変化なし")).toHaveCount(0);
  });
});

// ======================================================================
// FR-2 / D-36 (1): 展示後の段が無い状態・FR-11 v16の状態
// ======================================================================

test.describe("思考アシスト: 時点とv16の状態", () => {
  test("[spec FR-2 / D-36 (1)] v16の展示後の段が無いときは展示の表は出すが「今日当てはまる」は出さず、類似レースは「出走表の時点」と書く", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "機力");
    await expect(page.getByText("展示タイム")).toBeVisible();
    await expect(page.getByText("今日当てはまる")).toHaveCount(0);
    await expect(page.getByText("出走表の時点")).toBeVisible();
  });

  test("[spec FR-11 / screens 状態] v16の保存が無いレースは「このレースは、過去レースの傾向を表示できるデータがありません」になる", async ({
    page,
  }) => {
    await openAssist(page, {
      overrides: {
        facts: (body) => ({ ...body, status: "not_saved" }),
      },
    });
    await expect(
      page.getByText(
        "このレースは、過去レースの傾向を表示できるデータがありません",
      ),
    ).toBeVisible();
  });
});

// ======================================================================
// 用語（生データ主義・N-7・D-20・D-24）
// ======================================================================

test.describe("思考アシスト: 用語", () => {
  test("[spec 生データ主義 / FR-6 表現 / D-20・D-24 / N-7] 「似たレース」「いつも」「競艇」が画面に出ない", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(page.getByText("似たレース")).toHaveCount(0);
    await expect(page.getByText("いつも")).toHaveCount(0);
    await expect(page.getByText("競艇")).toHaveCount(0);
  });

  test("[spec FR-6 表現] セオリーカードに「鉄板」「大本線」等の断定が出ない", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(page.getByText("鉄板")).toHaveCount(0);
    await expect(page.getByText("大本線")).toHaveCount(0);
  });
});

// ======================================================================
// FR-6 セオリーカード: 実測と準備中の区別
// ======================================================================

test.describe("思考アシスト: セオリーカード", () => {
  test("[spec FR-6 受入基準 / screens S-1b] 文だけのセオリー（部品交換）は「過去レースの傾向」を「準備中（まだ数えていない）」とし、数値を出さない", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "機力");
    await page.getByRole("button", { name: /部品交換/ }).click();
    await expect(page.getByText("準備中（まだ数えていない）")).toBeVisible();
  });
});

// ======================================================================
// FR-5 優勝戦・準優勝戦の日は深掘りの今節の順位を使わない
// ======================================================================

test.describe("思考アシスト: 優勝戦・準優勝戦の扱い", () => {
  test("[spec FR-5 / D-36 (4) / screens 細部] 準優勝戦の日は、今節の平均着順点の差がつく材料の札が「準優勝戦の日は使わない」になる", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "軸");
    await expect(page.getByText("準優勝戦の日は使わない")).toBeVisible();
  });
});

// ======================================================================
// FR-4 レンズの切り替えで買い目（固定フッター）が残る
// ======================================================================

test.describe("思考アシスト: レンズと固定フッター", () => {
  test("[spec FR-4 受入基準] どのレンズに切り替えても固定フッターの買い目表示が残る", async ({
    page,
  }) => {
    await openAssist(page);
    for (const lens of ["軸", "展開", "機力", "買い目"]) {
      await clickLens(page, lens);
      await expect(page.getByText("3連単")).toBeVisible();
    }
  });

  test("[spec FR-3 受入基準] レンズを切り替えても1〜6号艇の行がすべて表示される", async ({
    page,
  }) => {
    await openAssist(page);
    for (const lens of ["軸", "展開", "機力", "買い目"]) {
      await clickLens(page, lens);
      for (let boat = 1; boat <= 6; boat++) {
        await expect(page.getByText(`${boat}号艇`).first()).toBeVisible();
      }
    }
  });
});

// ======================================================================
// FR-9 思考フレームワークの対応表: 3タップ以内（N-3）
//
// 22行すべては網羅していない（多くの行は、まだ実装が無く仕様・画面設計にも
// アクセシブルな名前が明記されていないタップ対象（艇の丸・★印・各種「傾向 ›」等）を
// 経由する必要があり、名前を推測で決め打ちするとテストの意図（仕様の取り違え検出）を
// 損なうため）。レンズの切り替えだけで届く行（0〜1タップ）を代表として確認する。
// 残りの行の確認は「テストにしなかった要件」として報告する。
// ======================================================================

test.describe("思考アシスト: 思考フレームワークの対応表（FR-9・代表行）", () => {
  test("[screens 対応表 FW-01/FW-22] 軸レンズ（既定・0タップ）で1号艇の1着率と差がつく材料が見える", async ({
    page,
  }) => {
    await openAssist(page);
    await expect(page.getByText(/1号艇.*1着/).first()).toBeVisible();
    await expect(page.getByText("差がつく材料")).toBeVisible();
  });

  test("[screens 対応表 FW-06/FW-17] 展開レンズに1タップで類似レースの決まり手が見える", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "展開");
    await expect(page.getByText("決まり手")).toBeVisible();
  });

  test("[screens 対応表 FW-08] 機力レンズに1タップでモーター2連率が見える", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "機力");
    await expect(page.getByText("モーター2連率")).toBeVisible();
  });

  test("[screens 対応表 FW-18/FW-19] 買い目レンズに1タップで合成オッズ・人気順の要素が見える", async ({
    page,
  }) => {
    await openAssist(page);
    await clickLens(page, "買い目");
    await expect(page.getByText(/合成オッズ|人気順/).first()).toBeVisible();
  });
});

// ======================================================================
// FR-10 ガイド
// ======================================================================

test.describe("思考アシスト: ガイド", () => {
  test("[spec FR-10 / screens S-1c 受入基準] ガイドを開くと5段あり、「次へ」で「堅い？荒れる？」から「買い目を組む」まで案内する", async ({
    page,
  }) => {
    await openAssist(page);
    await page.getByRole("button", { name: "ガイド" }).click();
    await expect(page.getByText(/堅い.*荒れる/).first()).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "次へ" }).click();
    }
    await expect(page.getByText(/買い目を組む|買い目/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "閉じる" })).toBeVisible();
  });
});

// 決まっていない点（spec・screens から一意に決まらなかった点）はファイル末尾のコメントを参照。
//
// 1. FR-1「公開までは切り替えを出さない」とD-22の「出走表とタブ／思考アシスト」の切り替え（P2）の関係。
//    FR-1の受入基準は「フラグが無い状態で入口が出ない」とだけ書かれ、プレビューフラグがある状態で
//    レース詳細に入口（切り替え）が出るかは明記が無い。D-22本文は「公開時（P2）に…置く」とあるため、
//    今回のP0/P1実装ではフラグの有無に関わらず常に出ない可能性がある。テストはフラグ無し状態の
//    非表示だけを確認し、フラグあり状態での入口有無は検証していない。
// 2. 「堅い？荒れる？」の枠・セオリーカード・会場の特徴のシートがrole="region"等のアクセシブルな
//    領域（ランドマーク）を持つかは明記が無い。テストはページ全体に対するgetByTextで文言を確認して
//    おり、同じ文言が別の節に偶然出た場合は誤検出しうる（今回使った文言・数値は十分固有と判断した）。
// 3. 艇の行の名前に「{n}号艇」という文字列が実際に含まれるか。screens.mdは「艇番を必ず添える」
//    （N-6）としか書いておらず、具体的な表記（「1号艇」か「1」単独か）は決めていない。
//    「{n}号艇」表記は、同じドキュメント内の他の記述（例: FW-01の「1号艇の丸」）に合わせた推測。
// 4. venue_technique_period_stats（会場の決まり手の期間表、migration 134）の列名。入力を
//    spec.md・screens.mdだけに絞っているため実際の列名は不明。venueTechniqueRow()は候補を
//    複数持たせているが、実装側のSELECT文によっては一致しない可能性がある。
// 5. ヘッダーの会場名トリガーの正確なアクセシブルネーム（「{会場} ›」の「›」が名前に含まれるか）。
//    テストはボートレース場名の部分一致（正規表現）で寛容に探している。
// 6. FR-9対応表22行のうち、艇の丸・★印・「傾向 ›」等のタップを経由する行（大半）は、
//    対象要素のアクセシブルな名前が仕様・画面設計に明記されていないため確認していない
//    （「テストにしなかった要件」参照）。
