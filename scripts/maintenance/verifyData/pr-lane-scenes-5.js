/**
 * verify-pr-lane.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-pr-lane.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { classify } from "../pr-lane.js";
import { SVC, MOVE_BASE, MOVE_HEAD, SQ, MOVE_TO } from "./pr-lane-scenes-3.js";

let promise, patch, prlExp2;

// ---- human（人にしか判断できない理由）と needs（機械の確かめ） ----
/** { の中身を割った 1/3 */
function prlExp1() {
  // blobs: パス → { base, head }（無ければ害のない中身。null は読めない）
  const explain = (changes, { patches, blobs = {} } = {}) => {
    const list = changes.map((c) => {
      const [status, path] = c.split(" ");
      return { status, path };
    });
    const all = new Map(list.map((c) => [c.path, { added: [], removed: [] }]));
    for (const [k, v] of patches ?? new Map()) all.set(k, v);
    const r = classify({
      changes: list,
      patches: all,
      trees: [],
      readBlob: (side, p) =>
        p in blobs && side in blobs[p] ? blobs[p][side] : "const a = 1;\n",
    });
    promise(changes.join(","), r);
    return r;
  };
  const ex = (changes, opts = {}, { human = [], noHuman = [], needs = [], noNeeds = [] } = {}) => {
    const r = explain(changes, opts);
    const h = r.human.map((x) => `${x.kind} ${x.file}`);
    const n = r.needs.map((x) => `${x.kind} ${x.file}`);
    const at = `${changes.join(",")} human=${h} needs=${n}`;
    for (const x of human) assert.ok(h.includes(x), `${at}: human に ${x} が無い`);
    for (const x of noHuman) assert.ok(!h.includes(x), `${at}: human に ${x} がある`);
    for (const x of needs) assert.ok(n.includes(x), `${at}: needs に ${x} が無い`);
    for (const x of noNeeds) assert.ok(!n.includes(x), `${at}: needs に ${x} がある`);
  };
  const upsert = { "scripts/daily/w.js": { head: 'await sb.from("x").upsert(rows);\n' } };

  ex(["M .github/workflows/ci.yml"], {}, { human: ["github .github/workflows/ci.yml"] });
  ex(["A scripts/maintenance/ryujin-maker-token.js"], {}, { human: ["secret scripts/maintenance/ryujin-maker-token.js"] });
  ex(["M package-lock.json"], {}, { human: ["secret package-lock.json"] });
  ex(["M scripts/analysis/foo.js"], {}, {
    noHuman: ["secret scripts/analysis/foo.js", "db scripts/analysis/foo.js", "github scripts/analysis/foo.js"],
    needs: ["line-mutation scripts/analysis/foo.js"],
  });
  // DB の書き手（db）にも line-mutation を課す（人の理由は残したまま。免除は judge だけ）
  ex(["M scripts/lib/x.js"], {}, { human: ["db scripts/lib/x.js"], needs: ["line-mutation scripts/lib/x.js"] });
  ex(["M scripts/daily/w.js"], { blobs: upsert }, { human: ["db scripts/daily/w.js"], needs: ["line-mutation scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { base: 'sb\n.from("x")\n  .delete()\n', head: "" } } }, { human: ["db scripts/daily/w.js"] });
  return { ex };
}

/** { の中身を割った 3/3 */
function prlExp3({ ex }) {
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: null } } }, { human: ["db scripts/daily/w.js"] });
  ex(["M scripts/daily/w.js"], { blobs: { "scripts/daily/w.js": { head: 'sb.from("x").select("*");\n' } } }, { noHuman: ["db scripts/daily/w.js"], needs: ["line-mutation scripts/daily/w.js"] });
  ex(["M scripts/sns/post.js"], {}, { human: ["sns scripts/sns/post.js"], noHuman: ["terms scripts/sns/post.js"] });
  ex(["M src/components/Foo.jsx"], { patches: patch("src/components/Foo.jsx", ["<p>回収率</p>"]) }, { human: ["terms src/components/Foo.jsx"], noHuman: ["sns src/components/Foo.jsx"] });
  ex(["M public/robots.txt"], {}, { human: ["seo public/robots.txt"] });
  ex(["M scripts/maintenance/pr-lane.js"], {}, { human: ["judge scripts/maintenance/pr-lane.js"], noNeeds: ["line-mutation scripts/maintenance/pr-lane.js"] });
  ex(["M e2e/fixtures.js"], {}, { human: ["fixture e2e/fixtures.js"], noNeeds: ["base-spec-on-head e2e/fixtures.js"] });
  ex(["M e2e/recordings/x.json.gz"], {}, { human: ["fixture e2e/recordings/x.json.gz"], noNeeds: ["base-spec-on-head e2e/recordings/x.json.gz"] });
  ex(["D scripts/maintenance/verify-foo.js"], {}, { human: ["weaken scripts/maintenance/verify-foo.js"] });
  ex(["M scripts/maintenance/verify-foo.js"], {}, { noHuman: ["weaken scripts/maintenance/verify-foo.js"], needs: ["verify-mutation scripts/maintenance/verify-foo.js"] });
  ex(["M scripts/maintenance/verify-foo.mjs"], {}, { human: ["weaken scripts/maintenance/verify-foo.mjs"] });
  ex(["D e2e/foo.spec.js"], {}, { human: ["weaken e2e/foo.spec.js"] });
  ex(["M e2e/foo.spec.js"], {}, { noHuman: ["weaken e2e/foo.spec.js"], needs: ["base-spec-on-head e2e/foo.spec.js"] });
  ex(["M docs/x-allowlist.json"], { patches: patch("docs/x-allowlist.json", ['  "a",']) }, { human: ["weaken docs/x-allowlist.json"] });
  ex(["M docs/x-allowlist.json"], { patches: patch("docs/x-allowlist.json", [], ['  "a",']) }, { noHuman: ["weaken docs/x-allowlist.json"], human: ["unclassified docs/x-allowlist.json"] });
  const reg = "scripts/maintenance/verify-registry.json";
  ex([`M ${reg}`], { patches: patch(reg, ['{ "name": "b" }'], ['{ "name": "a" }']) }, { human: [`weaken ${reg}`] });
  ex(["M AGENTS.md"], { patches: patch("AGENTS.md", ["b"], ["a"]) }, { human: ["weaken AGENTS.md"] });
  ex(["M AGENTS.md"], { patches: patch("AGENTS.md", ["b"]) }, { noHuman: ["weaken AGENTS.md"], human: ["unclassified AGENTS.md"] });
  ex(["M src/App.css"], {}, { human: ["css-core src/App.css"], noNeeds: ["screenshot-diff src/App.css"] });
  ex(["M src/components/Foo.css"], {}, { noHuman: ["css-core src/components/Foo.css"], needs: ["screenshot-diff src/components/Foo.css"] });
  ex(["M src/pure/x.js"], {}, { needs: ["line-mutation src/pure/x.js"] });
  ex(["M api/x.js"], {}, { needs: ["line-mutation api/x.js"] });
  ex(["A src/pages/NewPage.jsx"], {}, { needs: ["route-in-e2e src/pages/NewPage.jsx"] });
  ex(["M data/x.json"], {}, { needs: ["line-mutation data/x.json"] });
}

/** { の中身を割った 4/19 */
export function prlCli4({ g, put }) {
  g("init", "-q", "-b", "main");
  put("README.md", "x\n");
  put("src/utils/shared.js", "export const a = 1;\n");
  put("src/pages/Other.jsx", "export default 1;\n");
}

/** { の中身を割った 6/19 */
export function prlCli6({ g, put }) {
  put(
    "sns-video-studio/remotion/src/Root.jsx",
    'import { a } from "../../../src/utils/shared.js";\nexport default a;\n',
  );
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  const start = g("rev-parse", "HEAD");
  // master 側だけが進めた変更（head の差分には入らない）
  put("scripts/other.js", "x\n");
  g("add", "-A");
  g("commit", "-q", "-m", "master moves");
  const master = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "docs", start);
  put("docs/a.md", "a\n");
  g("add", "-A");
  g("commit", "-q", "-m", "docs");
  const docs = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "utils", start);
  put("src/utils/shared.js", "export const a = 2;\n");
  g("add", "-A");
  g("commit", "-q", "-m", "utils");
  const utils = g("rev-parse", "HEAD");
  // SNS・api から届かない画面の直し・バイナリ・空のファイル・空白を含むパス（語なし）
  g("checkout", "-q", "-b", "page", start);
  put("src/pages/Other.jsx", "export default 2;\n");
  put("src/a b.jsx", "export default 1;\n");
  put("src/empty.js", "");
  return { start, master, docs, utils };
}

/** { の中身を割った 9/19 */
export function prlCli9({ g, put, start }) {
  g("add", "-A");
  g("commit", "-q", "-m", "page");
  const page = g("rev-parse", "HEAD");
  // 空白・引用符を含むパスに語が入る（H9）
  g("checkout", "-q", "-b", "words", start);
  put("src/a b.jsx", "<p>回収率</p>\n");
  put('src/q"x.jsx', "<p>競艇</p>\n");
  g("add", "-A");
  g("commit", "-q", "-m", "words");
  const words = g("rev-parse", "HEAD");
  // 別のファイルへ字のまま移す（H9 に当てない）・移して新しい語・PR で risk-rules の語を消す（merge-base の語で当てる）
  g("checkout", "-q", "-b", "split", start);
  put(
    "src/pages/Long.jsx",
    "export default () => (\n  <div>\n        <p>回収率は未達</p>\n        <p>一攫千金ではない</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split base");
  const splitBase = g("rev-parse", "HEAD");
  put(
    "src/pages/Long.jsx",
    'import Part from "./long/Part.jsx";\nexport default () => <Part />;\n',
  );
  put(
    "src/pages/long/Part.jsx",
    "export default () => (\n  <div>\n    <p>回収率は未達</p>\n    <p>一攫千金ではない</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split");
  const splitHead = g("rev-parse", "HEAD");
  put(
    "src/pages/long/Part.jsx",
    "export default () => (\n  <div>\n    <p>回収率は未達</p>\n    <p>一攫千金ではない</p>\n    <p>的中率</p>\n  </div>\n);\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "split and new word");
  const splitFresh = g("rev-parse", "HEAD");
  g("checkout", "-q", "-b", "weaken", start);
  return { page, words, splitBase, splitHead, splitFresh };
}

/** { の中身を割った 11/19 */
export function prlCli11({ g, put, risk, start }) {
  put(
    "sns-video-studio/remotion/risk-rules.json",
    JSON.stringify({
      ...risk,
      rules: risk.rules.filter((r) => !r.patterns.includes("一攫千金")),
    }),
  );
  put("src/pages/Other.jsx", "export default () => <p>一攫千金</p>;\n");
  g("add", "-A");
  g("commit", "-q", "-m", "weaken words");
  const weaken = g("rev-parse", "HEAD");
  // 移すだけ（BOA-1433）: git から base・head の字を読む道。移す前の殻・移した木・移して1字変えた木
  const moveCommit = (files, msg) => {
    for (const [p, text] of files) put(p, text);
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  g("checkout", "-q", "-b", "move", start);
  const moveBase = moveCommit([[SVC, MOVE_BASE]], "move base");
  const moveHead = moveCommit(
    [
      [SVC, MOVE_HEAD],
      [SQ, MOVE_TO],
    ],
    "move",
  );
  const moveChanged = moveCommit(
    [[SQ, MOVE_TO.replace("n + m +", "n - m +")]],
    "move and change",
  );
  return { weaken, moveBase, moveHead, moveChanged };
}

/** { の中身を割った 13/19 */
export function prlCli13({ cli, docs, master, moveBase, moveChanged, moveHead, page, splitBase, splitFresh, splitHead, utils, weaken, words }) {
  const light = cli(master, docs);
  assert.equal(light.status, 0, light.stderr);
  assert.deepEqual(
    JSON.parse(light.stdout),
    { lane: "light", hits: [], human: [], needs: [] },
    "master だけの変更（scripts/other.js）は差分に入れない",
  );

  const heavy = cli(master, utils);
  assert.equal(heavy.status, 0, heavy.stderr);
  const out = JSON.parse(heavy.stdout);
  assert.equal(out.lane, "heavy");
  assert.deepEqual(
    out.hits.map((h) => [h.rule, h.file]),
    [["H2", "src/utils/shared.js"]],
    "SNS の入口から届く src/utils はコミットの木で辿る",
  );
  assert.deepEqual(
    [out.human.map((x) => x.kind), out.needs],
    [["sns"], []],
    "CLI: heavy の出力に human（sns）・needs がある",
  );

  const pageRun = cli(master, page);
  assert.equal(pageRun.status, 0, pageRun.stderr);
  assert.deepEqual(
    JSON.parse(pageRun.stdout),
    { lane: "light", hits: [], human: [], needs: [] },
    "届かない画面・バイナリ・空のファイル・空白を含むパスは軽い道",
  );
  const wordsRun = cli(master, words);
  assert.equal(wordsRun.status, 0, wordsRun.stderr);
  assert.deepEqual(
    JSON.parse(wordsRun.stdout).hits.map((h) => [h.rule, h.file]),
    [
      ["H9", "src/a b.jsx"],
      ["H9", 'src/q"x.jsx'],
    ],
    "空白・引用符を含むパスでも足した行の語を読む",
  );
  const h9Files = (base, head) => {
    const r = cli(base, head);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout)
      .hits.filter((h) => h.rule === "H9")
      .map((h) => h.file);
  };
  assert.deepEqual(
    h9Files(splitBase, splitHead),
    [],
    "CLI: 別のファイルへ字のまま移しただけは H9 に当てない",
  );
  assert.deepEqual(
    h9Files(splitBase, splitFresh),
    ["src/pages/long/Part.jsx"],
    "CLI: 移した上に新しい語を足せば H9",
  );
  assert.deepEqual(
    h9Files(master, weaken),
    ["src/pages/Other.jsx"],
    "CLI: PR が risk-rules から語を消しても merge-base の語で H9",
  );
  assert.deepEqual(
    JSON.parse(cli(moveBase, moveHead).stdout),
    { lane: "light", hits: [], human: [], needs: [] },
    "CLI: 移すだけ→軽",
  );
  assert.equal(
    JSON.parse(cli(moveBase, moveChanged).stdout).lane,
    "heavy",
    "CLI: 移して1字変える→重",
  );

  const bad = cli(master, "0000000000000000000000000000000000000000");
  assert.notEqual(bad.status, 0, "判定できないときは 0 以外");
  assert.equal(JSON.parse(bad.stdout).lane, "heavy");
  assert.deepEqual(
    [JSON.parse(bad.stdout).human.map((x) => [x.kind, x.file]), JSON.parse(bad.stdout).needs],
    [[["error", ""]], []],
    "判定できないときは human に error の要素",
  );
  assert.ok(JSON.parse(bad.stdout).human[0].reason, "error の reason");
}

/** { の中身を割った 15/19 */
export function prlCli15({ missing }) {
  assert.notEqual(missing.status, 0, "--base・--head が無いときは 0 以外");
}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes6(env) {
  ({ promise, patch, prlExp2 } = env);

}

function prl5Scene1() {
  {
    const { ex } = prlExp1();
    prlExp2({ ex });
    prlExp3({ ex });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes7(env) {
  ({ promise, patch, prlExp2 } = env);
  prl5Scene1();
}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes8(env) {
  ({ promise, patch, prlExp2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes9(env) {
  ({ promise, patch, prlExp2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes10(env) {
  ({ promise, patch, prlExp2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes11(env) {
  ({ promise, patch, prlExp2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes12(env) {
  ({ promise, patch, prlExp2 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（promise・patch・prlExp2） */
export function runPrLaneScenes13(env) {
  ({ promise, patch, prlExp2 } = env);

}
