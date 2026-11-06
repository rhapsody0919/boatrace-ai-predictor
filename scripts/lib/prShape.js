/**
 * PR の差分の形の機械の検査（symlink・submodule・LFS・バイナリ・.gitattributes・上限超え）。純粋関数。
 *
 * もとは AI 審査（review.yml の gate、scripts/lib/reviewPr.js）の1段目。ゼロベース再設計 v3.3（2026-11-06、
 * 別ベンダーの LLM 審査をやめる）で審査を外し、この検査だけを verify（scripts/maintenance/verify-pr-shape.js）へ移した。
 * 判定は gate と同じ（入力は GitHub の compare API の files と同じ形）。git の差分からその形を作るのは verify 側。
 */

export const LIMITS = {
  maxFiles: 299, // compare API は files を最大300件しか返さない。300件ちょうどは「切られた」とみなして落とした（gate と同じ線）
  maxPatchChars: 200_000,
};

/**
 * 機械で落とす形。1つでもあれば落とす（fail closed）
 *
 * @param {{ filename: string, status: string, patch?: string, previous_filename?: string }[]} files compare の files と同じ形（使う欄だけ）
 * @param {Map<string, string>} headModes PR の head の木での、変更したパスのモード（"100644"・"120000" 等）
 * @param {boolean} treeTruncated 木の取得が切られたか
 * @returns {string[]}
 */
export function mechanicalRejections(files, headModes, treeTruncated) {
  const reasons = [];
  if (files.length === 0) reasons.push("差分が無い");
  if (files.length > LIMITS.maxFiles)
    reasons.push(
      `変更したファイルが多すぎる（${files.length}件、上限 ${LIMITS.maxFiles}）`,
    );
  if (treeTruncated)
    reasons.push("head の木が大きすぎて、ファイルの種類を確かめられない");
  const patchChars = files.reduce((n, f) => n + (f.patch?.length ?? 0), 0);
  if (patchChars > LIMITS.maxPatchChars)
    reasons.push(
      `差分が大きすぎる（${patchChars}字、上限 ${LIMITS.maxPatchChars}）`,
    );
  for (const f of files) {
    const names = [f.filename, f.previous_filename].filter(Boolean);
    if (
      names.some((n) => n === ".gitattributes" || n.endsWith("/.gitattributes"))
    )
      reasons.push(`${f.filename}: .gitattributes の変更`);
    if (names.some((n) => n === ".gitmodules"))
      reasons.push(`${f.filename}: submodule の設定の変更`);
    // 本文の無い差分は、消したファイル以外は全部落とす。バイナリ（NUL を1つ含むだけの JS も git はバイナリと扱う）は
    // changes が0で patch が無いので、changes で絞ると中身を見せないまま通る。中身を変えない改名・複製も本文が無く、
    // 中身を危険な場所（.github/workflows/・api/）へ移せるので同じく落とす
    if (f.patch === undefined && f.status !== "removed")
      reasons.push(
        `${f.filename}: 差分の本文が無い（バイナリ・大きすぎる・中身を変えない改名や複製）`,
      );
    if (f.patch !== undefined && /git-lfs\.github\.com\/spec/.test(f.patch))
      reasons.push(`${f.filename}: Git LFS のポインタ`);
    const mode = headModes.get(f.filename);
    if (mode === "120000") reasons.push(`${f.filename}: シンボリックリンク`);
    if (mode === "160000") reasons.push(`${f.filename}: submodule`);
    if (f.status !== "removed" && mode === undefined && !treeTruncated)
      reasons.push(`${f.filename}: head の木に見つからない`);
  }
  return reasons;
}

const STATUS = {
  A: "added",
  M: "modified",
  D: "removed",
  R: "renamed",
  C: "copied",
  T: "changed",
};

/**
 * `git diff --raw -z -M --no-abbrev` の出力を、compare の files に近い形の土台（パス・状態・モード）にする
 * @param {string} rawZ
 * @returns {{ filename: string, status: string, previous_filename?: string, dstMode: string }[]}
 */
export function parseRawDiff(rawZ) {
  const parts = rawZ.split("\0");
  const out = [];
  let i = 0;
  while (i < parts.length) {
    const head = parts[i];
    if (head === "") {
      i += 1;
      continue;
    }
    const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([AMDRCTUX])(\d*)$/.exec(
      head,
    );
    if (!m) throw new Error(`git diff --raw の行を読めない: ${head}`);
    const [, , dstMode, letter] = m;
    const status = STATUS[letter];
    if (!status) throw new Error(`git diff --raw の状態を扱えない: ${letter}`);
    if (letter === "R" || letter === "C") {
      out.push({
        filename: parts[i + 2],
        previous_filename: parts[i + 1],
        status,
        dstMode,
      });
      i += 3;
    } else {
      out.push({ filename: parts[i + 1], status, dstMode });
      i += 2;
    }
  }
  return out;
}

/**
 * 1ファイルの `git diff` の出力から、compare の patch に当たる部分（最初の @@ から）を取り出す。
 * 本文（@@ の塊）が無ければ undefined（バイナリ・空のファイル・モードだけ・中身を変えない改名。compare も patch を返さない）
 * @param {string} diffText
 * @returns {string | undefined}
 */
export function patchOf(diffText) {
  const lines = diffText.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  if (start === -1) return undefined;
  return lines.slice(start).join("\n").replace(/\n$/, "");
}

/**
 * 画像・動画・音・フォント・gzip の拡張子と、その形式の先頭の印（magic bytes）。
 * gate（AI 審査）は本文の無い差分を全部落とした。LLM が中身を読めない物を承認しないためで、そうした変更は
 * オーナーが入れていた（ADR-0097）。verify は必須の check なので、同じ線のままだとモックの画像（review-fix-cycle の
 * 承認の記録）・ブログの画像も入れられなくなる。そこで、拡張子と先頭の印が合う追加・変更だけを通す。
 * NUL を含む JS・圧縮の束・拡張子を偽った物・中身を変えない改名は今までどおり落とす
 */
const MEDIA_MAGIC = {
  png: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  jpg: [[0, [0xff, 0xd8, 0xff]]],
  jpeg: [[0, [0xff, 0xd8, 0xff]]],
  gif: [[0, [0x47, 0x49, 0x46, 0x38]]],
  webp: [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x45, 0x42, 0x50]],
  ],
  wav: [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x41, 0x56, 0x45]],
  ],
  mp4: [[4, [0x66, 0x74, 0x79, 0x70]]],
  woff2: [[0, [0x77, 0x4f, 0x46, 0x32]]],
  ttf: [[0, [0x00, 0x01, 0x00, 0x00]]],
  // 試験の固定データ（e2e・scripts/ml・sns-video-studio の *.json.gz）。gzip の印（deflate）
  gz: [[0, [0x1f, 0x8b, 0x08]]],
};

/**
 * 本文の無い差分のうち、通してよい画像・動画・音・フォントか（追加・変更だけ。拡張子と先頭の印が合うこと）
 * @param {{ filename: string, status: string, patch?: string }} file
 * @param {Uint8Array | null} head head の中身の先頭（16バイト以上）。読めなければ null
 */
export function isAllowedMedia(file, head) {
  if (file.patch !== undefined) return false;
  if (file.status !== "added" && file.status !== "modified") return false;
  const ext = /\.([a-z0-9]+)$/.exec(file.filename.toLowerCase())?.[1];
  const marks = ext ? MEDIA_MAGIC[ext] : undefined;
  if (!marks || !head) return false;
  return marks.every(([at, bytes]) =>
    bytes.every((b, i) => head[at + i] === b),
  );
}

/**
 * 機械の検査（gate と同じ判定）から、通してよい画像等の「差分の本文が無い」だけを外す
 * @param {string[]} reasons mechanicalRejections の結果
 * @param {Set<string>} allowedMedia isAllowedMedia が真のファイル名
 */
export function withoutAllowedMedia(reasons, allowedMedia) {
  return reasons.filter(
    (r) =>
      ![...allowedMedia].some((name) =>
        r.startsWith(`${name}: 差分の本文が無い`),
      ),
  );
}
