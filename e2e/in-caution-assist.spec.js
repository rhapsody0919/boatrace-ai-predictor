import { test, expect, fetchRecorded } from "./fixtures.js";
import {
  THINKING_ASSIST_RACE,
  routeThinkingAssistV16,
} from "./thinking-assist-fixture.js";

/**
 * 思考アシスト「堅い？荒れる？」の1着のバー（BOA-822 task 23、FR-4、承認モック mock/4-assist-375.png (a)。機能フラグの裏、?caution=1）。
 *   - 1着のバーはイン崩れ注意度の裏返し（100 − pct）。AI予想タブの注意度と足して 100%
 *   - 行ごとに数えた範囲の名前と件数（1着は勝率差が同じくらい、万舟は級の並びが同じ）
 *   - 枠の下に裏返しの1行
 *   - フラグの外は今のまま（級の並びの1着の割合）
 * 例のレースは 2026-10-06 徳山10R（準優勝戦）。出走表は録画、v16 は固定データ。録画は 157 の適用前で inCaution が無いので、
 * 予想の応答に注意度を足す（試験の値）
 */

const URL_ = `/race/${THINKING_ASSIST_RACE}/assist`;
const IN_CAUTION = {
  pct: 41,
  n: 2967,
  nonWin: 1216,
  level: "mid",
  gapCents: 24,
  band: 0,
  round: "junyu",
  boat1WinRate: 6.81,
  topOtherBoat: 2,
  topOtherWinRate: 6.57,
  basePct: 45,
  absentBoats: [],
  lowSample: false,
  through: "2026-10-05",
  def: "gapband-r-v1",
};

async function routeInCaution(page) {
  await page.route("**/api/predictions/**", async (route) => {
    try {
      const res = await fetchRecorded(route);
      const body = await res.json();
      for (const race of body.races ?? []) {
        if (race.raceId === THINKING_ASSIST_RACE) race.inCaution = IN_CAUTION;
      }
      await route.fulfill({ response: res, json: body });
    } catch (e) {
      // テストの終わった後に届いた応答（light の取得など）だけは無視する（thinking-assist-states.spec.js の routeExhibition と同じ）
      if (page.isClosed() || /has been closed/.test(String(e?.message))) return;
      throw e;
    }
  });
}

const roughCard = (page) => page.locator(".ta-rough");

test.describe("思考アシストの1着のバー（BOA-822、?caution=1）", () => {
  test.beforeEach(async ({ page }) => {
    await routeThinkingAssistV16(page);
    await routeInCaution(page);
  });

  test("1着のバーは注意度の裏返しで、行ごとに範囲の名前と件数、枠の下に裏返しの1行", async ({
    page,
  }) => {
    await page.goto(`${URL_}?caution=1`);
    const card = roughCard(page);
    // 準優勝戦は1着の行にもラウンドを書く（#1604 ファン評価1周目 P2）
    await expect(card).toContainText("勝率差が同じくらいの準優勝戦 2,967件", {
      timeout: 20000,
    });
    // 準優勝戦に絞った級の並びの件数（NCR 112件）は万舟の行に
    await expect(card).toContainText("級の並びが同じ準優勝戦 112件");
    const nums = card.locator(".baseline-bar-num");
    await expect(nums.first()).toContainText("59%");
    await expect(nums.first()).toContainText("全国55%");
    await expect(page.getByTestId("rough-in-caution-flip")).toHaveText(
      "1号艇の1着 59% は、イン崩れ注意度 41%（1着を逃した割合）の裏返し",
    );
    // 準優勝戦の矢印は全レースとの比べであることを書く（2周目 P2）
    await expect(page.getByTestId("rough-in-caution-round")).toContainText(
      "準優勝戦は、勝率差が違っても割合があまり変わらない",
    );
    // 軸レンズの畳んだ中は数え方の話だけなので、見出しも合わせる（2周目 P2）
    await expect(page.getByText("件数が上の枠と違う理由")).toHaveCount(0);
    // 級の並びの絵は万舟の範囲と名前を付ける（同 P2）
    await expect(card.locator(".ta-rough-lineup")).toContainText("万舟の範囲");
    // 軸レンズの「上の枠と違う理由」は集め方の違いを書く（同 P1）
    await expect(page.getByTestId("axis-why-in-caution")).toContainText(
      "上の枠の1号艇の1着は、勝率差が同じくらいの全国のレース（準優勝戦だけ） 2,967件で集めた",
    );
    // 材料のシート: 1着の集め方と勝率差の定義、級の並びの1着の割合（予選も含めると）は出さない（同 P2）
    await page.getByRole("button", { name: "堅い？荒れる？の材料" }).click();
    await expect(
      page.getByTestId("rough-sheet-in-caution-scope"),
    ).toContainText("勝率差（1号艇と、他の艇で一番高い全国勝率の差）");
    // シートの文は下の表と食い違わない（2周目 P2: 「下の表の2通りとは別」と書いていた）
    await expect(
      page.getByTestId("rough-sheet-in-caution-scope"),
    ).toContainText("1号艇の1着の1本目は");
    await page.getByRole("button", { name: /集めたレースは/ }).click();
    await expect(page.getByText(/予選も含めると/)).toHaveCount(0);
  });

  test("フラグの外は今のまま（級の並びの1着 58%、裏返しの1行は出さない）", async ({
    page,
  }) => {
    await page.goto(URL_);
    const card = roughCard(page);
    await expect(card.locator(".baseline-bar-num").first()).toContainText(
      "58%",
      { timeout: 20000 },
    );
    await expect(card).not.toContainText("勝率差が同じくらい");
    await expect(page.getByTestId("rough-in-caution-flip")).toHaveCount(0);
  });
});
