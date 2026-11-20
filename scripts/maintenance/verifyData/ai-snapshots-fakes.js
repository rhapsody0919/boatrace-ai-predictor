/**
 * ai-snapshots-fakes.js - scripts/generate-ai-snapshots.js の main が描く・書く道具の偽（ai-snapshots-main.js が
 * generate-ai-snapshots.js からの import だけをここへ向ける。verify ではない）。ブラウザ・dist・選手ページの描きは起こさない。
 *
 * - aiSnapshots/staticServer.js の withSnapshotBrowser: ブラウザを開かず、渡された関数を1回回す
 * - aiSnapshots/runSteps.js: generateBlogFamily を呼んだかを記録する（status へ足す部品は本物のまま）
 * - generateAiSnapshotsRacers.js: 書き先（DIST_DIR・SNAPSHOT_DIR）を disk に無い名前に（書きは ai-snapshots-fake-fs.js が受ける）、
 *   選手ページの描きは何もしない
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AI_SNAPSHOT_SCENE = Symbol.for("verify-ai-snapshots.scene");
const scene = () => {
  const s = globalThis[AI_SNAPSHOT_SCENE];
  if (!s) throw new Error("AI スナップショットの偽: 場面が置かれていない（ai-snapshots-main.js の runMain を使う）");
  return s;
};

// --- aiSnapshots/staticServer.js
export async function withSnapshotBrowser(distDir, fn) {
  scene().calls.push(["withSnapshotBrowser", distDir]);
  await fn(() => {
    throw new Error("偽のブラウザ: ページは開かない");
  }, "http://127.0.0.1:0");
  return { relaunches: 0, fatalError: null };
}

// --- aiSnapshots/runSteps.js
export {
  addChartPngStatus,
  addRacerStatus,
  addTranslatedStatus,
} from "../../aiSnapshots/runSteps.js";
export async function generateBlogFamily(openPage, baseUrl, steps) {
  scene().calls.push(["generateBlogFamily", Object.keys(steps).sort()]);
  return { failed: [], translatedResult: null, listResult: null };
}
export async function exportChartPngsSafely() {
  scene().calls.push(["exportChartPngsSafely"]);
  return null;
}
export async function generateRacerSnapshotsSafely() {
  scene().calls.push(["generateRacerSnapshotsSafely"]);
  return null;
}

// --- generateAiSnapshotsRacers.js
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const DIST_DIR = "/verify-ai-snapshots/dist";
export const SNAPSHOT_DIR = path.join(DIST_DIR, "ai-snapshots");
export const dedupeDefaultTitle = (html) => html;
export async function generateRacerSnapshots() {
  return null;
}
