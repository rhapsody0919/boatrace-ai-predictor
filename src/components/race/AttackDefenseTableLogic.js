const TECH_LABEL_KEYS = {
  sashi: {
    defense: "attackDefense.sashiDefense",
    attack: "attackDefense.sashiAttack",
  },
  makuri: {
    defense: "attackDefense.makuriDefense",
    attack: "attackDefense.makuriAttack",
  },
  makurizashi: {
    defense: "attackDefense.makurizashiDefense",
    attack: "attackDefense.makurizashiAttack",
  },
};

const TECHS = ["sashi", "makuri", "makurizashi"];

// 技の中で最初に「rate>0 かつ round(rate*base)>0」になるもの（なければ null）
function pickTech(dist, base) {
  for (const tech of TECHS) {
    const rate = dist[tech];
    if (rate && rate > 0) {
      const count = Math.round(rate * base);
      if (count > 0) return { tech, count };
    }
  }
  return null;
}

// 1コースの防御例（差され/まくられ/捲差されで回数>0のもの）
function buildDefenseExample(c1, t) {
  const counts = c1.wakuRaceCounts?.["1"];
  const total = counts?.total || 0;
  const wins = counts?.wins || 0;
  const losses = total - wins;
  const defDist = c1.defenseDistribution?.["1"];
  if (!defDist || !(losses > 0) || !(total > 0)) return null;
  const picked = pickTech(defDist, losses);
  if (!picked) return null;
  const { tech, count } = picked;
  const label = t(TECH_LABEL_KEYS[tech].defense);
  return {
    title: t("attackDefense.exampleDefenseTitle", { label, count, total }),
    desc: t("attackDefense.exampleDefenseDesc", {
      count,
      total,
      attackLabel: t(TECH_LABEL_KEYS[tech].attack),
    }),
  };
}

// 2-6コースの攻撃例（差し/まくり/まくり差しで回数>0のもの）
function buildAttackExample(s, t) {
  const waku = s.boatNumber;
  const wakuStr = String(waku);
  const counts = s.wakuRaceCounts?.[wakuStr];
  const wins = counts?.wins || 0;
  const total = counts?.total || 0;
  const atkDist = s.attackDistribution?.[wakuStr];
  if (!atkDist || !wins || !total) return null;
  const picked = pickTech(atkDist, wins);
  if (!picked) return null;
  const { tech, count } = picked;
  const label = t(TECH_LABEL_KEYS[tech].attack);
  const params = { waku, label, count, total };
  return {
    title: t("attackDefense.exampleAttackTitle", params),
    desc: t("attackDefense.exampleAttackDesc", params),
  };
}

// 実データから凡例の例文を生成
export function buildExamples(sorted, t) {
  const examples = [];
  const c1 = sorted[0];
  if (c1) {
    const def = buildDefenseExample(c1, t);
    if (def) examples.push(def);
  }
  for (let i = 1; i < sorted.length; i++) {
    const atk = buildAttackExample(sorted[i], t);
    if (atk) examples.push(atk);
    if (examples.length >= 2) break;
  }
  return examples;
}
