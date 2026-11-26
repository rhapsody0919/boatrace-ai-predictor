/**
 * 進捗の一枚をセッションごとに1枚にし、旧い枝ごとの一枚から続きを読めることを守る（session-progress-file.js、2026-11-26 オーナー）。
 * 枝ごとの判定（置き場・止める条件）は verify-session-progress.js が見る。ここは足した置き場の選び方と見出しだけ。
 */
import {
  chooseProgressFile,
  HEADINGS,
  sessionProgressPath,
  startContext,
} from "./session-progress-file.js";

const failures = [];
let checked = 0;
const check = (name, actual, expected) => {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: 期待 ${JSON.stringify(expected)} 実際 ${JSON.stringify(actual)}`,
    );
  }
};

check(
  "セッションの一枚の置き場",
  sessionProgressPath("abc-123", "/p"),
  "/p/session-abc-123.md",
);
check(
  "id の危ない字は落とす",
  sessionProgressPath("../x/y", "/p"),
  "/p/session-xy.md",
);
check(
  "id が無ければ null",
  [sessionProgressPath("", "/p"), sessionProgressPath(undefined, "/p")],
  [null, null],
);

const has =
  (...files) =>
  (f) =>
    files.includes(f);
check(
  "セッションの一枚があればそれを読み書きする",
  chooseProgressFile({
    sessionFile: "/p/s.md",
    branchFile: "/p/b.md",
    exists: has("/p/s.md", "/p/b.md"),
  }),
  { write: "/p/s.md", read: "/p/s.md" },
);
check(
  "セッションの一枚が無く枝の一枚（旧い置き方）があれば、それを読んでセッションの一枚に書く",
  chooseProgressFile({
    sessionFile: "/p/s.md",
    branchFile: "/p/b.md",
    exists: has("/p/b.md"),
  }),
  { write: "/p/s.md", read: "/p/b.md" },
);
check(
  "どちらも無ければ読まずにセッションの一枚に書く",
  chooseProgressFile({
    sessionFile: "/p/s.md",
    branchFile: "/p/b.md",
    exists: has(),
  }),
  { write: "/p/s.md", read: null },
);
check(
  "id が読めなければ枝の一枚に書く（今までどおり）",
  chooseProgressFile({
    sessionFile: null,
    branchFile: "/p/b.md",
    exists: has(),
  }),
  { write: "/p/b.md", read: null },
);

check(
  "見出しに状態・待ちを書かせない",
  HEADINGS.some((h) => /状態|待ち/.test(h)),
  false,
);
check(
  "見出しはゴール・枝と PR・判断・次にやること",
  ["ゴール", "枝と PR", "判断", "次にやること"].every((w) =>
    HEADINGS.some((h) => h.includes(w)),
  ),
  true,
);
check(
  "旧い置き方から読んだときは、以後の書き先を知らせる",
  startContext({ file: "/p/s.md", content: "続き", from: "/p/b.md" }).includes(
    "以後は /p/s.md に書く",
  ),
  true,
);
check(
  "同じ一枚の続きなら移しの文を出さない",
  startContext({ file: "/p/s.md", content: "続き" }).includes("以後は"),
  false,
);

if (failures.length > 0) {
  console.error("NG: 進捗の一枚の置き場の選び方");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: 進捗の一枚の置き場の選び方 ${checked}件`);
