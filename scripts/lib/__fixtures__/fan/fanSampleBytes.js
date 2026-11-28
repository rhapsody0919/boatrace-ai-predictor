/**
 * fan-sample.json（fan2604 の実レコード12人分、base64）→ fan ファイルのバイト列（CRLF 区切り）。試験用。
 * LZH の展開は呼び手が差し替える（decode: (b) => b）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fan-sample.json",
);

/** @param {string} id fan ファイル名（例 fan2604） */
export function fanSampleBytes(id) {
  const fixture = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  return new Uint8Array(
    Buffer.concat(
      fixture.files[id].records.flatMap((r) => [
        Buffer.from(r.b64, "base64"),
        Buffer.from([0x0d, 0x0a]),
      ]),
    ),
  );
}
