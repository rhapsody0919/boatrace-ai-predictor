/**
 * verify-content-pr-gate.js の記事の PR の写しを作る関数（makePr）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import {
  ID,
  IMG,
  JPEG,
  JSON_JA,
  MANIFEST,
  MD,
  MD_EN,
  baseJson,
  baseMd,
  baseMdEn,
  config,
  enc,
} from "./content-pr-gate-fixtures.js";
import { computeContentSha256, sha256Hex } from "../../lib/contentPrGate.js";

/** 正しい新規記事の PR。over で中身・差分・manifest を差し替える */
export function makePr(over = {}) {
  const { head } = makePrPart1(over);
  return makePrPart2(over, head);
}

function makePrPart1(over) {
  const files = {
    [MD]: over.md ?? baseMd,
    [MD_EN]: over.mdEn ?? baseMdEn,
    [JSON_JA]: JSON.stringify(over.json ?? baseJson, null, 2),
  };
  const head = {
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])),
    [IMG]: over.img ?? JPEG,
    ...Object.fromEntries(
      Object.entries(over.extraFiles ?? {}).map(([k, v]) => [k, enc(v)]),
    ),
    ...(over.headExtra ?? {}),
  };
  return { head };
}

function makePrPart2(over, head) {
  const diff = [
    ...(over.diff ?? [
      { status: "A", path: MD },
      { status: "A", path: MD_EN },
      { status: "A", path: JSON_JA },
      { status: "A", path: IMG },
    ]),
    ...Object.keys(over.extraFiles ?? {}).map((path) => ({
      status: "A",
      path,
    })),
  ].map((d) => ({ mode: "100644", ...d }));
  const live = diff.filter((d) => d.status !== "D").map((d) => d.path);
  const fileShas = Object.fromEntries(
    live.filter((p) => head[p]).map((p) => [p, sha256Hex(head[p])]),
  );
  const contentSha = computeContentSha256(fileShas);
  const review = (role, agent, extra = {}) => ({
    role,
    agent,
    result: "pass",
    p0: 0,
    p1: 0,
    reviewed_sha256: contentSha,
    model: "claude-opus-5-5",
    at: "2026-10-20T01:00:00Z",
    ...extra,
  });
  const manifest = {
    schema: "content-pr-manifest/v1",
    id: ID,
    kind: "new",
    ticket: "BOA-999",
    paths: diff.map((d) => d.path),
    files: fileShas,
    content_sha256: contentSha,
    content_at: "2026-10-20T00:00:00Z",
    judgement_words: [],
    reviews: [
      review("content-qa", "content-qa"),
      review("wording-editor", "wording-editor"),
      review("fan", "boatrace-fan-reviewer"),
      review("seo-marketer", "seo-marketer"),
    ],
    author: { model: "claude-opus-5-5", lane: "hq-writer" },
    created_at: "2026-10-20T02:00:00Z",
  };
  const finalManifest = over.manifest ? over.manifest(manifest) : manifest;
  head[MANIFEST] = enc(
    over.rawManifest !== undefined
      ? over.rawManifest
      : JSON.stringify(finalManifest),
  );
  const basePaths = over.basePaths ?? [
    "public/blog/existing.md",
    "src/data/blog-posts/existing.json",
  ];
  const fullDiff = [
    ...diff,
    { status: over.manifestStatus ?? "A", path: MANIFEST, mode: "100644" },
    ...(over.extraDiff ?? []).map((d) => ({ mode: "100644", ...d })),
  ];
  return {
    diff: fullDiff,
    head: over.head ? over.head(head) : head,
    base: over.base ?? {},
    basePaths,
    headPaths: over.headPaths ?? [
      ...new Set([
        ...basePaths,
        ...fullDiff.filter((d) => d.status !== "D").map((d) => d.path),
      ]),
    ],
    config: over.config ?? config,
  };
}
