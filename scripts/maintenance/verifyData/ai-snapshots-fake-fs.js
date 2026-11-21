/**
 * ai-snapshots-fake-fs.js - node:fs の偽（ai-snapshots-main.js が scripts/generate-ai-snapshots.js からの import だけをここへ向ける。
 * verify ではない）。書きは disk に出さず WRITTEN（パス → 本文）に残し、mkdir は何もしない。読み（locales の JSON 等）は本物。
 */
export { readFileSync } from "node:fs";

export const WRITTEN = new Map();

function captureWrite(file, data) {
  WRITTEN.set(String(file), String(data));
}
function noMkdir() {}

export { captureWrite as writeFileSync, noMkdir as mkdirSync };
