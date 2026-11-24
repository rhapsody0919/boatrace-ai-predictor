/**
 * 軽い道／重い道の判定（pr-lane.js、config/pr-path-rules.json）を固定する。外部接続なし（tier=ci）。
 * 設計: docs/proposal/dev-process-redesign-2026-11-05.md 1.2・1.5（#2277）。
 *
 * - 1.5 の振り分けの表の代表（PR の差分のパスと状態をそのまま入力にする）が、期待どおりの lane と規則になる
 * - src/utils の変更が SNS の自動送信（H2）と api（H6）に import でたどれる（#2236 → #2251 の壊れ）
 * - scripts/** は H1（新しい verify-*.js だけ除く）、src/locales/ja は H8、判定の script と規則の変更は H5
 * - 既存の src の .css の変更・削除は H7（#2144・#2157 の形）。新しい .css は全体のセレクタを足したときだけ H7
 * - CLI: 一時の git の木で base...head の差分（merge-base から）を判定し、JSON を出して終了 0。判定できなければ 0 以外で heavy
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fsIo } from "../lib/relativeImportGraph.js";
import { TREE_ROOT, classify } from "./pr-lane.js";

import { runPrLaneScenes1 } from "./verifyData/pr-lane-scenes-1.js";
import { runPrLaneScenes2 } from "./verifyData/pr-lane-scenes-2.js";
import { runPrLaneScenes3 } from "./verifyData/pr-lane-scenes-3.js";
import { runPrLaneScenes4, runPrLaneScenes5 } from "./verifyData/pr-lane-scenes-4.js";
import {
  runPrLaneScenes6,
  runPrLaneScenes7,
  runPrLaneScenes8,
  runPrLaneScenes9,
  runPrLaneScenes10,
  runPrLaneScenes11,
  runPrLaneScenes12,
  runPrLaneScenes13,
} from "./verifyData/pr-lane-scenes-5.js";
import { runPrLaneScenes14, runPrLaneScenes15 } from "./verifyData/pr-lane-scenes-6.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// 手元の木（git ls-files の一覧と手元のファイル）を、コミットの木と同じ形で渡す
const files = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const toLocal = (p) => join(ROOT, p.slice(TREE_ROOT.length + 1));
const tree = {
  files,
  io: {
    isFile: (p) => fsIo.isFile(toLocal(p)),
    read: (p) => fsIo.read(toLocal(p)),
  },
};

// patches に無いファイルは行の変化なし（空）として渡す。読めない場合の安全側は fill: false で別に試す。
// 軽い道の例は import の閉包を手元の木で辿らない（関係ない import の追加でこの試験が落ちないように。
// 木で辿って軽い道になることは、下の CLI の一時の git の木で試す）
const run = (
  changes,
  patches = new Map(),
  { trees = [tree], fill = true } = {},
) => {
  const list = changes.map((c) => {
    const [status, path] = c.split(" ");
    return { status, path };
  });
  const all = new Map(
    fill ? list.map((c) => [c.path, { added: [], removed: [] }]) : [],
  );
  for (const [k, v] of patches ?? new Map()) all.set(k, v);
  return classify({ changes: list, patches: all, trees });
};
const rulesOf = (r) => [...new Set(r.hits.map((h) => h.rule))].sort();
// 約束: light なら human・needs は空。heavy なら hits の全部のファイルが human か needs に入る（file・kind の順、同じ組は1回）
const promise = (name, r) => {
  if (r.lane === "light") {
    assert.deepEqual([r.human, r.needs], [[], []], `${name}: light なのに human・needs`);
    return;
  }
  const covered = new Set([...r.human, ...r.needs].map((x) => x.file));
  for (const h of r.hits)
    assert.ok(covered.has(h.file), `${name}: ${h.file} が human にも needs にも入らない`);
  for (const list of [r.human, r.needs]) {
    const keys = list.map((x) => `${x.file}\0${x.kind}`);
    assert.equal(new Set(keys).size, keys.length, `${name}: 同じ組が2回`);
    assert.deepEqual(keys, [...keys].sort((a, b) => a.split("\0")[0].localeCompare(b.split("\0")[0]) || a.split("\0")[1].localeCompare(b.split("\0")[1])), `${name}: 並び`);
  }
};
const expect = (name, changes, lane, rules = [], patches, opts) => {
  const r = run(
    changes,
    patches,
    opts ?? (lane === "light" ? { trees: [] } : undefined),
  );
  assert.equal(
    r.lane,
    lane,
    `${name}: lane ${r.lane}（${JSON.stringify(r.hits)}）`,
  );
  for (const rule of rules)
    assert.ok(
      rulesOf(r).includes(rule),
      `${name}: ${rule} に当たらない（${rulesOf(r)}）`,
    );
  if (lane === "light") assert.deepEqual(r.hits, [], name);
  promise(name, r);
  return r;
};
const patch = (path, added, removed = []) =>
  new Map([[path, { added, removed }]]);

// ---- 軽い道（1.5 の表で軽い） ----
expect(
  "#2267 docs だけ",
  ["A docs/proposal/refactoring-inventory-2026-11-05.md"],
  "light",
);
expect("#2257 用語集", ["M docs/reference/i18n-glossary.md"], "light");
expect(
  "#2252 data/analysis の新規",
  ["A data/analysis/ai-crawler/2026-10-30.json"],
  "light",
);
expect(
  "#2209 ESLint（既存の部品の直し）",
  [
    "M src/components/HitRaces.jsx",
    "M src/components/Toast.jsx",
    "M src/components/VenueMap.jsx",
  ],
  "light",
);
expect(
  "#2261 ページの OGP・title と新しい e2e",
  ["A e2e/venue-grid-social-meta.spec.js", "M src/pages/VenueGridPage.jsx"],
  "light",
);
expect(
  "#2157 から CSS を除いた形（既存の部品の jsx の直しと新しい e2e）",
  [
    "A e2e/today-featured-racer-link.spec.js",
    "M src/components/digest/FeaturedRaceCard.jsx",
  ],
  "light",
);
expect(
  "新しい部品の CSS（クラスの中だけ）",
  ["A src/components/digest/NewCard.css"],
  "light",
  [],
  patch("src/components/digest/NewCard.css", [
    ".new-card {",
    "  color: inherit;",
    "}",
    ".new-card a:hover,",
    "a.new-card__link {",
    "  text-decoration: underline;",
    "}",
    "@media (max-width: 480px) {",
    "  .new-card { padding: 0; }",
    "}",
    "@keyframes new-card-in {",
    "  from { opacity: 0; }",
    "  50%, to { opacity: 1; }",
    "}",
  ]),
);
// #1877（新しい verify と台帳の行の追加だけ）は軽い道のまま。後の #1879 は #1877 の verify が
// KNOWN_GAPS に記録していた前からの不具合（formatters.js の TZ）を直したもので、#1877 が壊したものではない（master の CI は緑）
expect(
  "#1877 新しい verify と台帳の行の追加",
  [
    "A scripts/maintenance/verify-formatters.js",
    "M scripts/maintenance/verify-registry.json",
  ],
  "light",
  [],
  patch("scripts/maintenance/verify-registry.json", [
    "    {",
    '      "script": "verify-formatters.js",',
    "    },",
  ]),
);
expect(
  "訳のキーの追加（ja 以外）",
  ["M src/locales/en/common.json", "M src/locales/ko/common.json"],
  "light",
  [],
  new Map([
    [
      "src/locales/en/common.json",
      { added: ['"x": "Win rate by course"'], removed: [] },
    ],
    [
      "src/locales/ko/common.json",
      { added: ['"x": "코스별 1착률"'], removed: [] },
    ],
  ]),
);

// ---- 後半の場面（verifyData/pr-lane-scenes-1.js・pr-lane-scenes-2.js・pr-lane-scenes-3.js・pr-lane-scenes-4.js） ----
runPrLaneScenes1({ expect, patch });
runPrLaneScenes2({ run, expect, patch });
runPrLaneScenes3({ rulesOf });
runPrLaneScenes4({ files, prlDead1 });

// ---- 死んだ型の検査: 規則の型が手元の木のどのファイルにも当たらないと、移す PR（RA02）で規則が黙って外れる ----
/** { の中身を割った 1/2 */
function prlDead1() {
  const config = JSON.parse(
    readFileSync(join(ROOT, "config/pr-path-rules.json"), "utf8"),
  );
  return { config };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-4.js・pr-lane-scenes-5.js） ----
runPrLaneScenes5({ files, prlDead1 });
runPrLaneScenes6({ promise, patch, prlExp2 });

/** { の中身を割った 2/3 */
function prlExp2({ ex }) {
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n" } } }, { human: ["db scripts/daily/w.js"] });
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes7({ promise, patch, prlExp2 });

// ---- CLI（一時の git の木） ----
/** { の中身を割った 1/19 */
function prlCli1() {
  const repo = mkdtempSync(join(tmpdir(), "pr-lane-"));
  return { repo };
}

/** { の中身を割った 2/19 */
function prlCli2({ repo }) {
  const g = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=pr-lane",
        "-c",
        "user.email=pr-lane@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  return { g };
}

/** { の中身を割った 3/19 */
function prlCli3({ repo }) {
  const put = (p, text) => {
    mkdirSync(dirname(join(repo, p)), { recursive: true });
    writeFileSync(join(repo, p), text);
  };
  return { put };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes8({ promise, patch, prlExp2 });

/** { の中身を割った 5/19 */
function prlCli5({ put }) {
  // 語（H9）は判定する repo の merge-base の木の risk-rules から読む
  put(
    "sns-video-studio/remotion/risk-rules.json",
    readFileSync(
      join(ROOT, "sns-video-studio/remotion/risk-rules.json"),
      "utf8",
    ),
  );
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes9({ promise, patch, prlExp2 });

/** { の中身を割った 7/19 */
function prlCli7({ repo }) {
  mkdirSync(join(repo, "public"), { recursive: true });
}

/** { の中身を割った 8/19 */
function prlCli8({ repo }) {
  writeFileSync(join(repo, "public/img.bin"), Buffer.from([0, 1, 2, 0, 255]));
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes10({ promise, patch, prlExp2 });

/** { の中身を割った 10/19 */
function prlCli10({ repo }) {
  const risk = JSON.parse(
    readFileSync(
      join(repo, "sns-video-studio/remotion/risk-rules.json"),
      "utf8",
    ),
  );
  return { risk };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes11({ promise, patch, prlExp2 });

/** { の中身を割った 12/19 */
function prlCli12({ repo }) {

  const cli = (base, head) =>
    spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/maintenance/pr-lane.js"),
        "--base",
        base,
        "--head",
        head,
        "--repo",
        repo,
      ],
      { encoding: "utf8" },
    );
  return { cli };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes12({ promise, patch, prlExp2 });

/** { の中身を割った 14/19 */
function prlCli14({ repo }) {
  const missing = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/maintenance/pr-lane.js"), "--repo", repo],
    {
      encoding: "utf8",
    },
  );
  return { missing };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-5.js） ----
runPrLaneScenes13({ promise, patch, prlExp2 });

/** { の中身を割った 16/19 */
function prlCli16({ docs, repo }) {
  const flagAsValue = spawnSync(
    process.execPath,
    [
      join(ROOT, "scripts/maintenance/pr-lane.js"),
      "--base",
      "--head",
      docs,
      "--repo",
      repo,
    ],
    { encoding: "utf8" },
  );
  return { flagAsValue };
}

// ---- 後半の場面（verifyData/pr-lane-scenes-6.js） ----
runPrLaneScenes14({ prlCli1, prlCli2, prlCli3, prlCli5, prlCli7, prlCli8, prlCli10, prlCli12, prlCli14, prlCli16, prlCli18, prlCli19 });

/** { の中身を割った 18/19 */
function prlCli18({ master, repo, words }) {

  // hq の写し: pr-lane.js・その部品 prLane(Classify|Human|Lines).js・prLaneMoveOnly*.js・大きさの数え prSize(Git).js・規則・relativeImportGraph.js だけを同じ配置で（node_modules なし）置いても動く
  {
    const copy = mkdtempSync(join(tmpdir(), "pr-lane-hq-"));
    for (const p of [
      "scripts/maintenance/pr-lane.js",
      ...["Classify", "Human", "Lines", "MoveOnly", "MoveOnlyParse"].map((n) => `scripts/maintenance/prLane${n}.js`),
      "scripts/maintenance/prSize.js",
      "scripts/maintenance/prSizeGit.js",
      "config/pr-path-rules.json",
      "scripts/lib/relativeImportGraph.js",
    ]) {
      mkdirSync(dirname(join(copy, p)), { recursive: true });
      copyFileSync(join(ROOT, p), join(copy, p));
    }
    const r = spawnSync(
      process.execPath,
      [
        join(copy, "scripts/maintenance/pr-lane.js"),
        "--base",
        master,
        "--head",
        words,
        "--repo",
        repo,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).lane, "heavy", "写しでも判定できる");
  }
}

/** { の中身を割った 19/19 */
function prlCli19() {

  // risk-rules が merge-base の木に無ければ判定しない（語を確かめられない）
  {
    const bare = mkdtempSync(join(tmpdir(), "pr-lane-bare-"));
    const gb = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=pr-lane",
          "-c",
          "user.email=pr-lane@example.invalid",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: bare, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
    gb("init", "-q", "-b", "main");
    writeFileSync(join(bare, "README.md"), "x\n");
    gb("add", "-A");
    gb("commit", "-q", "-m", "base");
    const b0 = gb("rev-parse", "HEAD");
    writeFileSync(join(bare, "README.md"), "y\n");
    gb("commit", "-q", "-am", "next");
    const b1 = gb("rev-parse", "HEAD");
    const r = spawnSync(
      process.execPath,
      [
        join(ROOT, "scripts/maintenance/pr-lane.js"),
        "--base",
        b0,
        "--head",
        b1,
        "--repo",
        bare,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 0, "risk-rules が無いときは 0 以外");
    assert.equal(JSON.parse(r.stdout).lane, "heavy");
  }
}

// ---- 後半の場面（verifyData/pr-lane-scenes-6.js） ----
runPrLaneScenes15({ prlCli1, prlCli2, prlCli3, prlCli5, prlCli7, prlCli8, prlCli10, prlCli12, prlCli14, prlCli16, prlCli18, prlCli19 });

// hq との約束: Node の組み込みと相対の import だけ（npm の部品を使わない）
for (const p of [
  "scripts/maintenance/pr-lane.js",
  "scripts/maintenance/prLaneClassify.js",
  "scripts/maintenance/prLaneMoveOnly.js",
  "scripts/maintenance/prSizeGit.js",
  "scripts/lib/relativeImportGraph.js",
]) {
  const src = readFileSync(join(ROOT, p), "utf8");
  const specs = [...src.matchAll(/^import[^"']*["']([^"']+)["']/gm)].map(
    (m) => m[1],
  );
  assert.ok(specs.length > 0, p);
  for (const s of specs)
    assert.match(s, /^(node:|\.\.?\/)/, `${p} が組み込み以外を import: ${s}`);
}

console.log("verify-pr-lane: OK");
