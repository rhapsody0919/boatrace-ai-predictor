// 旧 e2e/layout.spec.js から切り出しスクリプトで移した（CI02。題・中身は元のまま、import の相対の字だけ1段深くした）
import { test, expect, fetchRecorded } from "../fixtures.js";
import { gotoAndSettle, inspectGrids, expectNoWastedGrids } from "./helpers.js";

/**
 * BOA-460 の再現テスト。
 *
 * `/today` のカードは固定列数（480px以上で2列・1024px以上で3列）で並ぶため、
 * 枚数が列数を下回るセクションでは右側に空の列が残っていた
 * （1440pxで718px分の空白）。「まくりが利く選手」は該当が0〜数件の日があり、
 * 実データがたまたま1〜2件になった日だけ上の検査が落ちるため、`src/` を
 * 一切触っていないPRが赤くなった。
 *
 * CSS側は be62d3e3（PR #876）で直っている（auto-fit + 上限列数で割った最小幅）。
 * このテストはその振る舞いを固定するためのもので、実装方法には依存しない
 * （「カードが列数を下回っても右側に幅が余らない」だけを見る）。
 *
 * 再発の検知を実データの巡り合わせに任せないよう、応答をセクションごとに
 * 絞って枚数を固定する。日付も生成済みの過去日に固定する（当日は早朝バッチの
 * 前だと未生成で、ページがカードを出さないため検査が空振りする）。過去日の行は
 * 消えない（generate-morning-digest.js の delete は同じ digest_date だけを消す）。
 */
const DIGEST_FIXED_DATE = "2026-09-22";

/** morning_digest_rows の応答を、セクションごとに先頭 `perSection` 行だけに絞る */
async function capDigestRowsPerSection(page, perSection) {
  await page.route(/\/rest\/v1\/morning_digest_rows/, async (route) => {
    // route.fetch() は録画を通らないため、録画から同じ応答を返す fetchRecorded を使う
    const response = await fetchRecorded(route);
    const rows = await response.json();
    const kept = [];
    const counts = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
      const seen = counts.get(row.section) ?? 0;
      if (seen >= perSection) continue;
      counts.set(row.section, seen + 1);
      kept.push(row);
    }
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      json: kept,
    });
  });
}

test.describe("レイアウト: /today はカードが列数より少なくても幅を余らせない（BOA-460）", () => {
  // 1・2枚は上限列数（480px以上2列・1024px以上3列）を下回る側、3枚は1024px以上で
  // ちょうど、6枚（「もっと見る」の手前まで）は上限を超えて2行になる側（BOA-528）
  for (const perSection of [1, 2, 3, 6]) {
    test(`セクションのカードが${perSection}枚のとき空トラックが出ない`, async ({
      page,
    }) => {
      await capDigestRowsPerSection(page, perSection);
      await gotoAndSettle(page, `/today?date=${DIGEST_FIXED_DATE}`);
      // networkidle はデータが届いた合図にならない。goto が遅いと、Supabase への
      // 要求を出す前に一度 idle になり、その後の waitForLoadState は即座に返る。
      // 2026-09-28/29 の手元実行で、カードが描画される前に数えて0枚になった（BOA-528）
      await expect(page.locator(".digest-grid").first()).toBeVisible({
        timeout: 30000,
      });

      // 絞り込みが効いていない・カードが1枚も出ていない状態で
      // 「空トラックが無い」と判定してしまうのを防ぐ（無言の空振り対策）
      const itemCounts = await page.evaluate(() =>
        [...document.querySelectorAll(".digest-grid")].map(
          (grid) =>
            [...grid.children].filter((child) => {
              const rect = child.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }).length,
        ),
      );
      expect(
        itemCounts.length,
        `.digest-grid が描画されていません（${DIGEST_FIXED_DATE} のダイジェストが読めていない可能性）`,
      ).toBeGreaterThan(0);
      expect(
        Math.max(...itemCounts),
        `カード枚数が${perSection}枚に絞れていません: ${JSON.stringify(itemCounts)}`,
      ).toBeLessThanOrEqual(perSection);
      expect(
        itemCounts,
        `${perSection}枚のセクションが1つも無く、検査が空振りしています: ${JSON.stringify(itemCounts)}`,
      ).toContain(perSection);

      expectNoWastedGrids(await inspectGrids(page));
    });
  }
});
