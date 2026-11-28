#!/usr/bin/env node
/**
 * 記憶の索引（MEMORY.md）が読み込みの上限（先頭200行か25KB）に近い・越えたときだけ起動時に知らせること（memory-index-check.js）を固定の入力で確かめる。
 * 作業場所の鍵の作り方（/ と . を -）も確かめる。ファイル・通信には触らない。
 */
import {
  MAX_BYTES,
  MAX_LINES,
  memoryIndexLines,
  memoryIndexPath,
  projectKey,
} from "./memory-index-check.js";

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(
    `${ok ? "OK" : "NG"} ${label}${ok || !detail ? "" : `\n   ${detail}`}`,
  );
  if (!ok) failures++;
};
const rows = (n, w = 10) =>
  Array.from({ length: n }, () => "x".repeat(w)).join("\n") + "\n";
const f = "/h/.claude/projects/k/memory/MEMORY.md";

check(
  projectKey("/Users/a/boatrace-ai-predictor") ===
    "-Users-a-boatrace-ai-predictor",
  "鍵は / を - に",
);
check(
  projectKey("/Users/a/x/.claude/worktrees/w") ===
    "-Users-a-x--claude-worktrees-w",
  "鍵は . も - に",
);
check(
  memoryIndexPath("/Users/a/p", "/h") ===
    "/h/.claude/projects/-Users-a-p/memory/MEMORY.md",
  "索引の置き場",
);
check(
  memoryIndexLines({ file: f, text: null }).length === 0,
  "索引が無ければ何も出さない",
);
check(
  memoryIndexLines({ file: f, text: rows(100) }).length === 0,
  "線の遠く（100行・小さい）なら何も出さない",
);
const near = memoryIndexLines({ file: f, text: rows(185) });
check(
  near.length === 2 && near[0].includes("近づいて") && near[1].includes(f),
  "行数が線の9割を越えたら近いと知らせる",
  JSON.stringify(near),
);
const overLines = memoryIndexLines({ file: f, text: rows(MAX_LINES + 1) });
check(
  overLines[0]?.includes("越えています") &&
    overLines[0].includes(`${MAX_LINES + 1}行`),
  "200行を越えたら越えたと知らせる",
  JSON.stringify(overLines),
);
const overBytes = memoryIndexLines({ file: f, text: rows(50, 600) });
check(
  overBytes[0]?.includes("越えています") && 50 * 601 > MAX_BYTES,
  "行は少なくても 25KB を越えたら越えたと知らせる",
  JSON.stringify(overBytes),
);
const jp = memoryIndexLines({
  file: f,
  text: rows(120, 80).replace(/x/g, "あ"),
});
check(
  jp[0]?.includes("越えています"),
  "大きさは UTF-8 のバイトで数える（日本語は1字3バイト）",
  JSON.stringify(jp),
);

if (failures > 0) {
  console.error(`verify-memory-index-check: ${failures} 件の失敗`);
  process.exit(1);
}
console.log("verify-memory-index-check: すべて通った");
