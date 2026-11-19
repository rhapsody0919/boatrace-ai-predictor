/**
 * 取得ループ（archiveDownloader.js）の、マニフェスト（JSONL）と内容ハッシュの小さな部品。
 * archiveDownloader.js が再公開する（呼び出し側の import は変わらない）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const sha256 = (buf) =>
  crypto.createHash("sha256").update(buf).digest("hex");

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${file} の${i + 1}行目が不正なJSONです: ${e.message}`);
      }
    });
}

export const appendJsonl = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
};
