const anyMatch = (patterns = [], path, flags = "") =>
  patterns.some((p) => new RegExp(p, flags).test(path));

/** 既存の行を変えた・消した行（配列の末尾に足したときの "}" → "}," は数えない） */
const changedRows = (patch) =>
  patch.removed.filter((line) => !patch.added.includes(`${line},`));

/** human のうち、足した行・消した行を読む必要があるファイル（CLI が patch を取る対象） */
export const weakenRowPatterns = (human) => [
  ...(human.weaken?.addedRows ?? []),
  ...(human.weaken?.registryRows ?? []),
  ...(human.weaken?.removedRows ?? []),
];

/** DB の書き手: 中身は base・head の木から読む。無い側（追加の base・削除の head）は見ない。読めなければ当てる（安全側） */
function writerReason({ spec, file, status, readBlob }) {
  if (!anyMatch(spec.writerFiles, file)) return null;
  const sides = [status !== "A" && "base", status !== "D" && "head"];
  const texts = sides.filter(Boolean).map((s) => readBlob(s, file));
  const hit = texts.some(
    (t) =>
      typeof t !== "string" ||
      spec.writerContent.some((p) => new RegExp(p).test(t)),
  );
  return hit
    ? `${spec.reason}（.from(…).upsert 等・SERVICE_ROLE を持つ、または中身を読めない）`
    : null;
}

/** weaken（守りを弱める変更）の当たりと理由 */
function weakenReason({ spec: w, file, status, patch }) {
  const del = status === "D";
  // 行を読めない（patch 無し）ときは当てる（安全側）
  const rows = (pick) => del || !patch || pick(patch).length > 0;
  const cases = [
    [del && anyMatch(w.deleted, file), "削除"],
    [
      status !== "A" && anyMatch(w.changedScripts, file),
      "既存の .mjs・.cjs・.sh の verify の変更",
    ],
    [
      !del &&
        anyMatch(w.addedRows, file) &&
        (!patch || patch.added.length > 0),
      "allowlist に行を足す",
    ],
    [
      anyMatch(w.registryRows, file) && rows(changedRows),
      "台帳の既存の行の変更・削除",
    ],
    [
      status !== "A" &&
        anyMatch(w.removedRows, file) &&
        rows((p) => p.removed),
      "行の削除・書き換え",
    ],
  ];
  const found = cases.find(([ok]) => ok);
  return found ? `${w.reason}（${found[1]}）` : null;
}

/** 1つの kind が1ファイルに当たる理由（当たらなければ null） */
function humanReason(kind, ctx) {
  const { spec, file, hits } = ctx;
  if (anyMatch(spec.paths, file, "i")) return spec.reason;
  if (spec.fromRule) {
    const h = hits.find((x) => x.rule === spec.fromRule && x.file === file);
    return h ? `${spec.reason}（${h.reason}）` : null;
  }
  if (spec.writerFiles) return writerReason(ctx);
  return kind === "weaken" ? weakenReason(ctx) : null;
}

/** 1ファイルが当たる human の kind と理由（heavy の hits のファイルだけに使う） */
function humanKinds({ human, file, status, patch, hits, readBlob }) {
  const found = [];
  for (const [kind, spec] of Object.entries(human)) {
    const ctx = { spec, file, status, patch, hits, readBlob };
    const reason = humanReason(kind, ctx);
    if (reason) found.push({ kind, file, reason });
  }
  return found;
}

/**
 * heavy の hits について、人にしか判断できない理由（human）と機械の確かめ（needs）を出す。lane の判定には使わない。
 * hits のファイルで、どちらにも入らない物は unclassified として human に入れる（黙って抜けないように）
 */
function explain({ hits, changes, patches, rules, human, readBlob }) {
  const status = new Map(changes.map((c) => [c.path, c.status]));
  const files = [...new Set(hits.map((h) => h.file))];
  const humans = [];
  const needs = [];
  for (const file of files) {
    const mine = humanKinds({
      human,
      file,
      status: status.get(file),
      patch: patches.get(file),
      hits,
      readBlob,
    });
    const own = [];
    for (const h of hits.filter((x) => x.file === file)) {
      const rule = rules.find((r) => r.id === h.rule);
      if (!rule?.needs) continue;
      if ((rule.needsUnlessHuman ?? []).some((k) => mine.some((m) => m.kind === k)))
        continue;
      const kinds =
        typeof rule.needs === "string"
          ? [rule.needs]
          : Object.keys(rule.needs).filter((k) =>
              anyMatch(rule.needs[k], file),
            );
      for (const kind of kinds)
        if (!own.some((n) => n.kind === kind))
          own.push({ kind, file, rule: h.rule });
    }
    humans.push(...mine);
    needs.push(...own);
    if (mine.length === 0 && own.length === 0)
      humans.push({
        kind: "unclassified",
        file,
        reason: hits
          .filter((x) => x.file === file)
          .map((x) => `${x.rule}: ${x.reason}`)
          .join(" / "),
      });
  }
  const order = (x, y) =>
    x.file.localeCompare(y.file) || x.kind.localeCompare(y.kind);
  return { human: humans.sort(order), needs: needs.sort(order) };
}

export { anyMatch, explain };
