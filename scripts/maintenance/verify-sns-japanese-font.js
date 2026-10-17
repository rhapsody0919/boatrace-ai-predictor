// /today の X 投稿の画像で日本語が描かれなかった不具合（2026-10-16）の再現テスト。
// 本番（Vercel）と同じ @sparticuz/chromium を、同じ起動の部品（scripts/lib/launchChromium.js）で開き、
// 日本語の文字に画素が描かれることを確かめる。@sparticuz/chromium は Linux 専用なので、Linux（CI）でだけ起動のテストを行う。
// 外部接続なし（page.setContent の文字だけ）。撮った見本は tmp/sns-font-check.png に保存する（CI の artifact）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  JAPANESE_FONT,
  installJapaneseFont,
  launchChromium,
  reapChromium,
} from "../lib/launchChromium.js";

test("日本語フォントを fontconfig の読む場所へ置く（2回目は置き直さない）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "fonts-"));
  const target = await installJapaneseFont(dir);
  const size = (await stat(target)).size;
  assert.equal(size, (await stat(JAPANESE_FONT)).size);
  assert.ok(size > 1_000_000);
  assert.equal(await installJapaneseFont(dir), target);
});

test("前の起動の Chromium が残っていれば止め、ほかのプロセスは止めない（2026-10-18 朝、実行を重ねるほど撮れなくなった）", async () => {
  const proc = await mkdtemp(path.join(tmpdir(), "proc-"));
  const put = async (pid, cmdline) => {
    await mkdir(path.join(proc, pid));
    await writeFile(path.join(proc, pid, "cmdline"), cmdline);
  };
  await put("101", "/tmp/chromium\0--single-process\0");
  await put("102", "/tmp/chromium\0--type=renderer\0");
  await put("103", "node\0/var/task/api/cron/sns-auto-plan.js\0");
  await put(String(process.pid), "/tmp/chromium\0");
  await mkdir(path.join(proc, "self"));
  const killed = [];
  const reaped = await reapChromium("/tmp/chromium", {
    procDir: proc,
    kill: (pid, signal) => killed.push([pid, signal]),
  });
  assert.equal(reaped, 2);
  assert.deepEqual(killed.sort(), [
    [101, "SIGKILL"],
    [102, "SIGKILL"],
  ]);
  // /proc が無い環境（macOS）では何もしない
  assert.equal(
    await reapChromium("/tmp/chromium", { procDir: path.join(proc, "none") }),
    0,
  );
});

// canvas に文字を描き、濃い画素を数える。字形が無ければ0（空白）か、どの文字でも同じ形（豆腐）になる
const COUNT = `(() => {
  const count = (text) => {
    const c = document.createElement("canvas");
    c.width = 400; c.height = 80;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 400, 80);
    g.fillStyle = "#000"; g.font = "48px sans-serif"; g.textBaseline = "top";
    g.fillText(text, 4, 8);
    const d = g.getImageData(0, 0, 400, 80).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    return n;
  };
  return { ja: count("日本語"), other: count("競走水面"), latin: count("ABC") };
})()`;

test(
  "本番と同じ Chromium（@sparticuz/chromium）で日本語の文字に画素が描かれる",
  { skip: process.platform !== "linux" && "Linux 専用（CI で実行）" },
  async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    const browser = await launchChromium();
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 488 },
        deviceScaleFactor: 3,
      });
      await page.setContent(
        `<html lang="ja"><body style="margin:16px;font-family:sans-serif">
          <h1 style="font-size:22px">本日のデータ一覧（10月16日）</h1>
          <p style="font-size:16px">下関12R 22:45締切｜1号艇 篠崎 元志</p>
          <p style="font-size:16px">逃げが堅い選手・まくりが利く選手</p>
        </body></html>`,
      );
      await page.evaluate(() => document.fonts.ready);
      const counts = await page.evaluate(COUNT);
      await mkdir("tmp", { recursive: true });
      await writeFile(
        "tmp/sns-font-check.png",
        await page.screenshot({ type: "png" }),
      );
      assert.ok(counts.latin > 100, JSON.stringify(counts));
      // 日本語が描かれている（空白でない）・別の文字は別の形（豆腐の同じ箱でない）
      assert.ok(counts.ja > 300, JSON.stringify(counts));
      assert.notEqual(counts.ja, counts.other, JSON.stringify(counts));
    } finally {
      await browser.close();
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  },
);
