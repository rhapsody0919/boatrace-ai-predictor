import { test, expect } from "./fixtures.js";

/**
 * 今期の事故率（目安、BOA-327）の固定。承認済みモック: docs/design/racer-accident-rate/mock/。
 *
 * RPC get_racer_accident_records（マイグレーション126）の応答を差し替えて、画面の振る舞いだけを確かめる
 * （計算の正しさは scripts/maintenance/verify-accident-rate.js が固定する）。登録番号の小さい順に
 *   1人目: 出走38・F1・失格1 → 0.78 超え（行に赤の目印）
 *   2人目: 出走64・F1・失格2 → 0.62 あと6点（行に無色の目印）
 *   3人目: 出走28・F1 → 0.71 超えだが出走30走未満なので行には出さない（開いた欄には出す）
 *   4人目以降: 事故なし
 */
test.describe.configure({ timeout: 180_000 });

const RPC = /\/rest\/v1\/rpc\/get_racer_accident_records/;
const RACE = "/race/2026-09-29-13-12";

async function mockRpc(page, handler) {
  await page.route(RPC, async (route) => {
    const body = route.request().postDataJSON() ?? {};
    await handler(
      route,
      [...(body.p_racer_ids ?? [])].sort((a, b) => a - b),
    );
  });
}

function rows(ids) {
  const inc = (code, race_id) => ({ race_id, code, stage: "予選" });
  return ids.map((racer_id, i) =>
    i === 0
      ? {
          racer_id,
          starts: 38,
          incidents: [
            inc("F", "2026-05-30-11-03"),
            inc("S1", "2026-07-01-01-01"),
          ],
        }
      : i === 1
        ? {
            racer_id,
            starts: 64,
            incidents: [
              inc("S1", "2026-05-11-23-02"),
              inc("F", "2026-06-11-03-10"),
              inc("S1", "2026-09-02-24-04"),
            ],
          }
        : i === 2
          ? { racer_id, starts: 28, incidents: [inc("F", "2026-06-01-01-01")] }
          : { racer_id, starts: 90, incidents: [] },
  );
}

async function openBasicInfo(page) {
  await page.goto(RACE);
  await page.locator(".race-tabs-btn", { hasText: "基本情報" }).click();
  await expect(page.locator(".rbit-bar-row")).toHaveCount(6, {
    timeout: 25000,
  });
}

test("行は「超え」と「あと20点以内」の選手にだけ目印を出し、開いた欄に事故率・内訳・B2ラインまでを出す", async ({
  page,
}) => {
  await mockRpc(page, (route, ids) => route.fulfill({ json: rows(ids) }));
  await openBasicInfo(page);

  const badges = page.locator(".rbit-accident-badge");
  await expect(badges).toHaveCount(2, { timeout: 25000 });
  await expect(page.locator(".rbit-accident-badge.is-over")).toHaveText(
    "事故率0.78 B2ライン超え",
  );
  await expect(page.locator(".rbit-accident-badge:not(.is-over)")).toHaveText(
    "B2ラインまで あと6点",
  );

  // 超えの選手を開く
  await page
    .locator(".rbit-bar-row", {
      has: page.locator(".rbit-accident-badge.is-over"),
    })
    .click();
  const box = page.locator(".rbit-accident");
  await expect(box).toHaveClass(/is-over/);
  await expect(box.locator(".rbit-accident-heading")).toHaveText(
    "今期の事故率（目安・2026-05-01〜09-28）",
  );
  await expect(box.locator(".rbit-accident-rate")).toHaveText("事故率 0.78");
  await expect(box.locator(".rbit-accident-breakdown")).toHaveText(
    "事故点30÷出走38（F1・失格1）",
  );
  await expect(box.locator(".rbit-accident-line")).toHaveText(
    "B2ライン（0.70）超え",
  );
  await expect(box.locator(".rbit-accident-note")).toContainText(
    "不良航法・待機行動違反（2点）は含まないため、公式の値より低いことがあります",
  );

  // ライン付近の選手を開く（開いた欄は1人ずつ）
  await page
    .locator(".rbit-bar-row", {
      has: page.locator(".rbit-accident-badge:not(.is-over)"),
    })
    .click();
  await expect(page.locator(".rbit-accident")).not.toHaveClass(/is-over/);
  await expect(page.locator(".rbit-accident-line")).toHaveText(
    "B2ライン（0.70）まで あと6点",
  );
  await expect(page.locator(".rbit-accident-breakdown")).toHaveText(
    "事故点40÷出走64（F1・失格2）",
  );
});

test("RPC が未適用（関数が無い）なら、目印も欄も出さない", async ({ page }) => {
  await mockRpc(page, (route) =>
    route.fulfill({
      status: 404,
      json: {
        code: "PGRST202",
        message:
          "Could not find the function public.get_racer_accident_records",
      },
    }),
  );
  await openBasicInfo(page);
  await page.locator(".rbit-bar-row").first().click();
  await expect(page.locator(".rbit-expanded-tab").first()).toBeVisible();
  await expect(page.locator(".rbit-accident-badge")).toHaveCount(0);
  await expect(page.locator(".rbit-accident")).toHaveCount(0);
  await expect(page.locator(".rbit-expanded .inline-fetch-error")).toHaveCount(
    0,
  );
});

test("取得に失敗したら、開いた欄に再試行つきのエラーを出す（事故なしと同じ見た目にしない）", async ({
  page,
}) => {
  let calls = 0;
  await mockRpc(page, (route, ids) => {
    calls += 1;
    return calls === 1
      ? route.fulfill({ status: 500, json: { message: "boom" } })
      : route.fulfill({ json: rows(ids) });
  });
  await openBasicInfo(page);
  await page.locator(".rbit-bar-row").first().click();
  const err = page
    .locator(".rbit-expanded")
    .getByText("今期の事故率を取得できませんでした");
  await expect(err).toBeVisible({ timeout: 25000 });
  await page
    .locator(".rbit-expanded .inline-fetch-error__retry")
    .first()
    .click();
  await expect(page.locator(".rbit-accident-badge")).toHaveCount(2, {
    timeout: 25000,
  });
});
