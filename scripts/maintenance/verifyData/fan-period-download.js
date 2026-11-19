/**
 * verify-fan-period.js の「6. CLI（取得）」の場面。fetch を差し替え、公式サイトへは接続しない。verify ではない。
 * 変異検証で、壊した版の CLI（取得ループ）にも同じ場面をかける。kit は verify 側の道具（作業場所・オプション・偽の応答・マニフェスト・手作りLZH）
 */
import fs from "node:fs";
import path from "node:path";

// (a) 正常系: 全ファイルOK・生ファイルの保存・sha256・Last-Modified・最小間隔
async function dlNormal(
  add,
  C,
  { newDir, baseOpts, harness, resp, manifestOf, lzh2604 },
) {
  const dir = newDir();
  const o = baseOpts(dir, { from: "fan2510", to: "fan2604" });
  const h = harness(() => resp(200, lzh2604, "Mon, 29 Jun 2026 01:59:31 GMT"));
  const code = await C.cmdDownload(o, h.deps);
  const m = manifestOf(dir);
  add(
    "download: 2ファイル取得（終了コード0）、URLは kibetsu/fan{YYMM}.lzh",
    code === 0 &&
      h.urls.length === 2 &&
      h.urls[0].endsWith("/kibetsu/fan2510.lzh"),
    `code=${code} urls=${h.urls}`,
  );
  add(
    "download: 生LZHをバイト単位で保存し、マニフェストに sha256・Last-Modified を記録",
    m.length === 2 &&
      m.every((e) => e.status === "ok" && e.sha256 && e.lastModified) &&
      Buffer.compare(
        fs.readFileSync(C.rawPath(dir, "fan2510")),
        Buffer.from(lzh2604),
      ) === 0,
  );
  add(
    "download: 全ての間隔が3秒以上（成功経路）",
    h.sleeps.length > 0 && h.sleeps.every((s) => s >= 3000),
    JSON.stringify(h.sleeps),
  );
  // 再実行で未取得なし
  const h2 = harness(() => resp(200, lzh2604));
  const code2 = await C.cmdDownload(o, h2.deps);
  add(
    "download: 再実行は取得済みをスキップ（リクエスト0）",
    code2 === 0 && h2.urls.length === 0,
  );
}

// (b) 403が2回連続 → 即停止（終了コード4）
async function dlStop403(add, C, { newDir, baseOpts, harness, resp }) {
  const dir = newDir();
  const h = harness(() => resp(403));
  const code = await C.cmdDownload(baseOpts(dir), h.deps);
  add(
    "download: 403が2回連続で停止（終了コード4、リクエスト2回、間隔3秒以上）",
    code === 4 && h.urls.length === 2 && h.sleeps.every((s) => s >= 3000),
    `code=${code} n=${h.urls.length} sleeps=${h.sleeps}`,
  );
}

// (c) 503が3回連続 → バックオフ（30→60秒）して停止
async function dlBackoff503(add, C, { newDir, baseOpts, harness, resp }) {
  const dir = newDir();
  const h = harness(() => resp(503));
  const code = await C.cmdDownload(baseOpts(dir), h.deps);
  add(
    "download: 503が3回連続で停止し、バックオフ（30秒→60秒）を挟む",
    code === 4 &&
      h.urls.length === 3 &&
      h.sleeps.includes(30000) &&
      h.sleeps.includes(60000),
    `code=${code} sleeps=${h.sleeps}`,
  );
}

// (d) 404が3回連続（想定外）→ 停止
async function dlStop404(add, C, { newDir, baseOpts, harness, resp }) {
  const dir = newDir();
  const h = harness(() => resp(404));
  const code = await C.cmdDownload(baseOpts(dir, { to: "fan2510" }), h.deps);
  add(
    "download: 過去のファイルが404で3回連続すると停止（URL構造の変更・ブロックの疑い）",
    code === 4 && h.urls.length === 3,
    `code=${code} n=${h.urls.length}`,
  );
}

// (d2) 内容が想定外（LZHとして解析できない）が3回連続 → 間隔を空けて再試行し、3回目で停止
async function dlBadLzh(add, C, { newDir, baseOpts, harness, resp }) {
  const dir = newDir();
  const h = harness(() => resp(200, new Uint8Array([1, 2, 3, 4])));
  const code = await C.cmdDownload(baseOpts(dir, { to: "fan2510" }), h.deps);
  add(
    "download: 内容が想定外（LZH解析失敗）が3回連続で停止し、再試行の間隔は3秒以上",
    code === 4 &&
      h.urls.length === 3 &&
      h.sleeps.length >= 2 &&
      h.sleeps.every((s) => s >= 3000),
    `code=${code} n=${h.urls.length} sleeps=${JSON.stringify(h.sleeps)}`,
  );
}

// (e) 最新の期のファイルが未公開（404）は想定内。完了扱いにせず、次回も試す
async function dlLatestUnpublished(
  add,
  C,
  { newDir, baseOpts, harness, resp, manifestOf, lzh2604 },
) {
  const dir = newDir();
  const o = baseOpts(dir, { from: "fan2510", to: "fan2604" });
  const h = harness((url) =>
    url.endsWith("fan2604.lzh") ? resp(404) : resp(200, lzh2604),
  );
  const code = await C.cmdDownload(o, h.deps);
  const m = manifestOf(dir);
  add(
    "download: 最新期の404は想定内（終了コード0、expected=true）",
    code === 0 && m.find((e) => e.key === "fan2604")?.expected === true,
    `code=${code}`,
  );
  const h2 = harness(() => resp(200, lzh2604));
  await C.cmdDownload(o, h2.deps);
  add(
    "download: 未公開だった最新期は、次回の実行で再取得される（fan2510は再取得しない）",
    h2.urls.length === 1 && h2.urls[0].endsWith("fan2604.lzh"),
    `urls=${h2.urls}`,
  );
}

// (f) LZHでない200が3回連続 → 停止、保存しない
async function dlNotLzh(add, C, { newDir, baseOpts, harness, resp }) {
  const dir = newDir();
  const h = harness(() =>
    resp(200, new Uint8Array(Buffer.from("<html>blocked</html>"))),
  );
  const code = await C.cmdDownload(baseOpts(dir), h.deps);
  add(
    "download: LZHでない応答が3回連続で停止し、生ファイルを保存しない",
    code === 4 && !fs.existsSync(path.join(dir, "raw")),
    `code=${code}`,
  );
}

// (g) 窓の外・日次上限 → 安全停止（終了コード2）
async function dlWindowAndLimit(
  add,
  C,
  { newDir, baseOpts, harness, resp, manifestOf, lzh2604 },
) {
  const dir = newDir();
  const h = harness(() => resp(200, lzh2604), "2026-09-21T03:00:00Z"); // JST 12:00
  const code = await C.cmdDownload(baseOpts(dir, { window: "22-06" }), h.deps);
  add(
    "download: 実行窓（JST 22-06）の外では、1件も取得せず安全停止（終了コード2）",
    code === 2 && h.urls.length === 0,
  );
  const dir2 = newDir();
  const h2 = harness(() => resp(200, lzh2604));
  const code2 = await C.cmdDownload(baseOpts(dir2, { dailyLimit: 2 }), h2.deps);
  add(
    "download: 日次上限に到達すると安全停止（終了コード2、リクエストは上限まで）",
    code2 === 2 && h2.urls.length === 2,
    `code=${code2} n=${h2.urls.length}`,
  );
  const h3 = harness(() => resp(200, lzh2604), "2026-09-22T13:00:00Z");
  const code3 = await C.cmdDownload(baseOpts(dir2, { dailyLimit: 2 }), h3.deps);
  add(
    "download: 翌日の再実行で続きから再開する（取得済みは再取得しない）",
    code3 === 2 &&
      h3.urls.length === 2 &&
      !h3.urls.some((u) =>
        manifestOf(dir2)
          .slice(0, 2)
          .some((e) => e.url === u),
      ),
    `urls=${h3.urls}`,
  );
}

// (h) 0件を成功にしない
async function dlZeroIsNotSuccess(
  add,
  C,
  { newDir, baseOpts, harness, resp, lzh2604 },
) {
  const dir = newDir();
  const h = harness(() => resp(200, lzh2604));
  // 全て取得済みの状態で、planは何も取らない
  const o = baseOpts(dir, { from: "fan2604", to: "fan2604" });
  await C.cmdDownload(o, h.deps);
  const n = h.urls.length;
  const code = await C.cmdDownload(
    { ...o, dryRun: true },
    harness(() => resp(200)).deps,
  );
  add(
    "plan/--dry-run: ネットワークに接続しない（終了コード0）",
    code === 0 && n === 1,
  );
}

const SCENES = [
  dlNormal,
  dlStop403,
  dlBackoff503,
  dlStop404,
  dlBadLzh,
  dlLatestUnpublished,
  dlNotLzh,
  dlWindowAndLimit,
  dlZeroIsNotSuccess,
];

/** 取得の場面を順に回し、結果の配列を返す（順は旧の downloadTests と同じ） */
export async function downloadTests(C, kit) {
  const out = [];
  const add = (label, pass, detail = "") => out.push({ label, pass, detail });
  for (const scene of SCENES) await scene(add, C, kit);
  return out;
}
