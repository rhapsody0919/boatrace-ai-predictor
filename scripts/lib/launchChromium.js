/**
 * Chromium の起動（ビルド時の AI スナップショット scripts/generate-ai-snapshots.js と、
 * SNS の送る前の表示の確認 api/_lib/snsHeadless.js（sns-pdca-loop tasks 10、ADR 0091）で共用）。
 */
import path from "node:path";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  statfs,
} from "node:fs/promises";
import { freemem, tmpdir } from "node:os";

// @sparticuz/chromium が持つフォントは Open Sans だけで、日本語が描かれない（2026-10-16、/today の X 投稿の画像で
// 見出し・会場名・選手名が空白になった）。同梱の Noto Sans JP（SIL OFL、scripts/lib/fonts/）を、Chromium の起動の前に
// fontconfig が読む /tmp/fonts（fonts.conf の <dir>）に置く。関数には vercel.json の includeFiles で同梱する
export const JAPANESE_FONT = new URL(
  "./fonts/NotoSansJP-wght.ttf",
  import.meta.url,
);

/** 日本語フォントを fontconfig の読む場所へ置く（置いてあれば何もしない）。返り値は置いた先 */
export async function installJapaneseFont(dir = path.join(tmpdir(), "fonts")) {
  const target = path.join(dir, "NotoSansJP-wght.ttf");
  const exists = await stat(target).then(
    (s) => s.size > 0,
    () => false,
  );
  if (!exists) {
    await mkdir(dir, { recursive: true });
    await copyFile(JAPANESE_FONT, target);
  }
  return target;
}

/**
 * 前の起動の Chromium が残っていれば止める（Linux の /proc を見る）。返り値は止めた数。
 * Vercel の関数は同じインスタンスが次の実行にも使われる。--single-process の Chromium がページの途中で落ちると、
 * プロセスが残ってメモリを持ったままになり、実行を重ねるほど撮れなくなった
 * （2026-10-18 朝: 1回目は4枚中3枚撮れ、4回目は /today を開く段で ERR_INSUFFICIENT_RESOURCES）
 */
export async function reapChromium(
  executable,
  { procDir = "/proc", kill = process.kill } = {},
) {
  const pids = await readdir(procDir).catch(() => []);
  let reaped = 0;
  for (const pid of pids.filter((p) => /^\d+$/.test(p))) {
    if (Number(pid) === process.pid) continue;
    const cmdline = await readFile(
      path.join(procDir, pid, "cmdline"),
      "utf8",
    ).catch(() => "");
    if (!cmdline.startsWith(executable)) continue;
    try {
      kill(Number(pid), "SIGKILL");
      reaped += 1;
    } catch {
      // 既に終わっている
    }
  }
  return reaped;
}

// 前の起動が /tmp に残すもの（プロファイル・--disable-dev-shm-usage の共有メモリのファイル・クラッシュのダンプ）
const TMP_LEFTOVER =
  /^(playwright_chromiumdev_profile-|\.org\.chromium\.Chromium\.|core\.)/;

/**
 * 前の起動の残りを /tmp から消す。返り値は消した数。Vercel の /tmp は容量に上限があり、Chromium の本体（約 220 MB）も
 * そこに置かれる。落ちた起動の残りが溜まると、共有メモリを /tmp に作れず ERR_INSUFFICIENT_RESOURCES になる（推定、2026-10-18）。
 * 残った Chromium を止めた後に呼ぶ
 */
export async function cleanTmpLeftovers(dir = tmpdir()) {
  const names = (await readdir(dir).catch(() => [])).filter((n) =>
    TMP_LEFTOVER.test(n),
  );
  for (const name of names)
    await rm(path.join(dir, name), { recursive: true, force: true });
  return names.length;
}

const tmpFreeMb = (dir = tmpdir()) =>
  statfs(dir).then(
    (s) => Math.round((s.bavail * s.bsize) / 1048576),
    () => null,
  );

/** 直近の起動の様子（失敗の理由に添える。本番の関数のログを見ずに切り分けるため） */
export const lastLaunch = {
  reaped: 0,
  cleaned: 0,
  freeMb: null,
  tmpFreeMb: null,
};

// Vercelのビルドサンドボックスはplaywrightが正式サポートしないLinux環境で、
// `playwright`パッケージがダウンロードするChromiumバイナリはシステム共有
// ライブラリ（libnspr4等）が無く起動時に落ちる（2026-09-15判明、PR#652参照）。
// `@sparticuz/chromium`はサーバーレス環境向けに必要なライブラリを同梱した
// 静的ビルドを提供するため、Vercel上ではそちらを`playwright-core`経由で
// 起動する。ローカル開発機（macOS等）では従来通り`playwright`本体の
// Chromiumを使う（`@sparticuz/chromium`はLinux専用バイナリのため）。
export async function launchChromium() {
  if (process.env.VERCEL) {
    const { chromium: chromiumCore } = await import("playwright-core");
    const sparticuzChromium = (await import("@sparticuz/chromium")).default;
    if (typeof sparticuzChromium.setGraphicsMode === "function") {
      sparticuzChromium.setGraphicsMode(false);
    }
    const executablePath = await sparticuzChromium.executablePath();
    lastLaunch.reaped = await reapChromium(executablePath);
    lastLaunch.cleaned = await cleanTmpLeftovers();
    lastLaunch.freeMb = Math.round(freemem() / 1048576);
    lastLaunch.tmpFreeMb = await tmpFreeMb();
    // executablePath() が /tmp/fonts に fonts.conf と既定のフォントを展開した後に置く。先に /tmp/fonts を作ると、
    // @sparticuz/chromium は展開済みとみなして fonts.conf を置かない（lambdafs.js の existsSync）
    await installJapaneseFont();
    process.env.LD_LIBRARY_PATH = [
      path.dirname(executablePath),
      process.env.LD_LIBRARY_PATH || "",
    ]
      .filter(Boolean)
      .join(":");
    return chromiumCore.launch({
      args: sparticuzChromium.args,
      executablePath,
      headless: true,
    });
  }

  const { chromium: chromiumLocal } = await import("playwright");
  return chromiumLocal.launch();
}
