/**
 * verify-full-picture-scene2.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { VOICE, f01Check } from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";

async function scene1() {
  // 禁止表現・回収率・章の条件（Orchestrate 11/2）: わざと落ちる入力で、f01 の実行時の検査が落とすことを固定する
  {
    const { NO_RETURN_RATE } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
    const { chaptersOk } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/bundle.mjs");
    const base = {
      title: "ボートレース大村10R 準優勝戦 10/26｜1号艇を崩す材料はどの艇に？",
      chapters: [
        {
          id: "c2",
          voice: "類似レースの1着は1号艇が313件。",
          subs: ["類似レースの1着は1号艇が313件。"],
          answer: "1着 1号艇 313件",
        },
      ],
    };
    const ok = (s6, desc = VOICE.credit) =>
      f01Check(s6, { desc, kana: {}, shots: {} });
    assert.deepEqual(ok(base), [], "ふつうの文は通る");
    // banned: risk-rules.json の禁止表現（「稼げる」は既存の「稼げ」で当たる）を、声・字幕・右の列・題・説明欄のどこに入れても落とす
    for (const w of ["必ず当たる", "稼げる", "万舟券", "儲かる"]) {
      assert.ok(
        ok({
          ...base,
          chapters: [{ ...base.chapters[0], voice: `${w}レース。` }],
        }).some((x) => x.startsWith("c2: 禁止表現")),
        `声の「${w}」`,
      );
      assert.ok(
        ok({ ...base, chapters: [{ ...base.chapters[0], answer2: w }] }).some(
          (x) => x.startsWith("c2: 禁止表現"),
        ),
        `右の列の「${w}」`,
      );
      assert.ok(
        ok({ ...base, title: `${base.title}${w}` }).some((x) =>
          x.startsWith("題: 禁止表現"),
        ),
        `題の「${w}」`,
      );
      assert.ok(
        ok(base, `${VOICE.credit}\n${w}`).some((x) =>
          x.startsWith("説明欄: 禁止表現"),
        ),
        `説明欄の「${w}」`,
      );
    }
    // no-return-rate: 回収率を出さない
    assert.ok(NO_RETURN_RATE.test("回収率"));
    assert.ok(
      ok({
        ...base,
        chapters: [{ ...base.chapters[0], subs: ["回収率は120%。"] }],
      }).some((x) => x.includes("回収率を出さない")),
      "字幕の回収率",
    );
    assert.ok(
      ok(base, `${VOICE.credit}\n回収率`).some((x) =>
        x.includes("回収率を出さない"),
      ),
      "説明欄の回収率",
    );
    // chapters: 0:00 から・3つ以上・各10秒以上でなければ落とす（run-full の qa.chapters。f01Chapters は短い最後の章を前に含める）
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n1:00 締め\n", 80),
      true,
    );
    assert.equal(
      chaptersOk("0:05 冒頭\n0:30 類似レース\n1:00 締め\n", 80),
      false,
      "0:00 から始まらない",
    );
    assert.equal(chaptersOk("0:00 冒頭\n0:30 締め\n", 80), false, "3つ未満");
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n0:35 締め\n", 80),
      false,
      "10秒未満の章",
    );
    assert.equal(
      chaptersOk("0:00 冒頭\n0:30 類似レース\n1:00 締め\n", 68),
      false,
      "最後の章が10秒未満",
    );
  }
}

async function scene2() {
  // 撮影の時間切れは1回だけ撮り直す（オーナー 11/2）。時間切れ以外はやり直さない、2回とも時間切れなら止める
  {
    const { retryOnTimeout } =
      await import("../../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
    const timeout = () =>
      Object.assign(new Error("locator.click: Timeout 30000ms exceeded."), {
        name: "TimeoutError",
      });
    let n = 0;
    const warned = [];
    const r1 = await retryOnTimeout(
      async () => {
        n += 1;
        if (n === 1) throw timeout();
        return "shots";
      },
      (e) => warned.push(e.message),
    );
    assert.deepEqual(
      [r1.value, r1.retries, n, warned.length],
      ["shots", 1, 2, 1],
      "1回目が時間切れ・2回目が通る",
    );
    n = 0;
    await assert.rejects(
      retryOnTimeout(async () => {
        n += 1;
        throw timeout();
      }),
      (e) => e.name === "TimeoutError" && e.retries === 1 && n === 2,
      "2回とも時間切れなら止める（やり直しは1回だけ）",
    );
    n = 0;
    await assert.rejects(
      retryOnTimeout(async () => {
        n += 1;
        throw new Error("類似レースの1着の棒の行が見つからない");
      }),
      () => n === 1,
      "時間切れ以外はやり直さない",
    );
    assert.deepEqual(await retryOnTimeout(async () => "ok"), {
      value: "ok",
      retries: 0,
    });
  }
  // 選手名を声で読まない
  assert.ok(
    f01Check(
      { chapters: [{ id: "c1", voice: "西村は", subs: [] }] },
      { desc: VOICE.credit, kana: {}, shots: {}, names: ["西村"] },
    ).some((w) => w.includes("選手名")),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export async function runFullPictureScene2C13() {
  await scene1();
  await scene2();
}
