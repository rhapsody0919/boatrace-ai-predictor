/**
 * verify-sns-headless.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-headless.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createChromiumHeadless } from "../../../api/_lib/snsHeadless.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";

let fakeBrowser;

function scene1() {
  test("screenshot の element・label（龍神ソナーの図、2026-10-16）: 要素の先頭に見出しを差し込み、その要素だけを撮る。要素が見えなければ撮らない", async () => {
    const URL_RACE = "https://www.boat-ai.jp/race/2026-10-16-19-12?tab=sonar";
    const fake = fakeBrowser({
      visible: [...SCREEN_MARKERS["race-sonar"], ".af-hep .af-dark"],
    });
    const shot = await createChromiumHeadless({ launch: fake.launch }).screenshot(
      {
        url: URL_RACE,
        requiredSelectors: SCREEN_MARKERS["race-sonar"],
        viewport: { width: 390, height: 844 },
        element: ".af-hep .af-dark",
        label: "下関12R 22:45締切",
      },
    );
    assert.equal(String(shot.png), "element");
    assert.deepEqual(fake.log.labels, [
      { selector: ".af-hep .af-dark", arg: "下関12R 22:45締切" },
    ]);
    assert.deepEqual(fake.log.elementShots, [
      { selector: ".af-hep .af-dark", options: { type: "png" } },
    ]);
    assert.equal(fake.log.screenshots, undefined);
    const hidden = fakeBrowser({ visible: SCREEN_MARKERS["race-sonar"] });
    await assert.rejects(
      createChromiumHeadless({ launch: hidden.launch }).screenshot({
        url: URL_RACE,
        requiredSelectors: SCREEN_MARKERS["race-sonar"],
        element: ".af-hep .af-dark",
      }),
      /screenshot_component_missing/,
    );
  });
  test("screenshot の element: 位置と大きさが落ち着くまで待ってから撮る。落ち着かなければ screenshot_unstable（2026-10-19 /today の4枚目の帯と切れ）", async () => {
    const { waitForStableBox } = await import("../../../api/_lib/snsHeadless.js");
    const boxes = [
      { x: 0, y: 120, width: 375, height: 300 },
      { x: 0, y: 60, width: 375, height: 300 },
      { x: 0, y: 10, width: 375, height: 300 },
      { x: 0, y: 10, width: 375, height: 300 },
    ];
    const waits = [];
    const page = { waitForTimeout: async (ms) => waits.push(ms) };
    const box = await waitForStableBox(page, {
      boundingBox: async () => boxes.shift(),
    });
    assert.equal(box.y, 10);
    assert.equal(waits.length, 3);
    let y = 0;
    await assert.rejects(
      waitForStableBox(
        page,
        { boundingBox: async () => ({ x: 0, y: (y += 5), width: 1, height: 1 }) },
        { tries: 4, gapMs: 1 },
      ),
      /screenshot_unstable/,
    );
  });
}

function scene2() {
  test("captureElement（2026-10-24 BOA-1013）: 撮る途中で位置がずれたら撮り直し、上下の色が図の外周の色でなければ撮り直す。決めた回数で合わなければ screenshot_misframed", async () => {
    const { captureElement } = await import("../../../api/_lib/snsHeadless.js");
    const page = { waitForTimeout: async () => {} };
    const target = (boxes, edges = []) => {
      const log = { shots: 0, edgeArgs: [] };
      return {
        log,
        boundingBox: async () => boxes.shift(),
        screenshot: async () => {
          log.shots += 1;
          return Buffer.from(`png${log.shots}`);
        },
        evaluate: async (fn, arg) => {
          log.edgeArgs.push(arg);
          return edges.shift();
        },
      };
    };
    const at = (y) => ({ x: 0, y, width: 374, height: 303 });
    // 1回目: 落ち着いた（10・10）後、撮った直後に 185 へずれた（上の部品が広がった）→ 撮り直す。2回目は合う
    const moved = target([at(10), at(10), at(185), at(185), at(185), at(185)]);
    assert.equal(String(await captureElement(page, moved)), "png2");
    assert.equal(moved.log.shots, 2);
    // 色の検査: 1回目は外れ（別の部品が入った）、2回目で合う。検査には撮った画像と CSS の変数名を渡す
    const framed = target(
      [at(10), at(10), at(10), at(10), at(10), at(10)],
      [false, true],
    );
    assert.equal(
      String(
        await captureElement(page, framed, {
          edgeColorVar: "--ryujin-navy-600",
        }),
      ),
      "png2",
    );
    assert.equal(framed.log.edgeArgs[0].edgeColorVar, "--ryujin-navy-600");
    assert.equal(
      framed.log.edgeArgs[0].edgeCheck,
      Buffer.from("png1").toString("base64"),
    );
    // 3回とも外れたら撮れなかった扱い（投稿に崩れた画像を載せない）
    const never = target(Array(9).fill(at(10)), [false, false, false]);
    await assert.rejects(
      captureElement(page, never, { edgeColorVar: "--ryujin-navy-600" }),
      /screenshot_misframed/,
    );
    assert.equal(never.log.shots, 3);
    // 比べる色が分からない（CSS の変数が無い）ときは撮り直さず、理由を分けて止める（2026-10-24 審査の P2）
    const noColor = target(Array(3).fill(at(10)), ["no_color"]);
    await assert.rejects(
      captureElement(page, noColor, { edgeColorVar: "--ryujin-navy-600" }),
      /screenshot_edge_color_missing/,
    );
    assert.equal(noColor.log.shots, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（fakeBrowser） */
export function runSnsHeadlessScenes1(env) {
  ({ fakeBrowser } = env);
  scene1();
  scene2();
}
