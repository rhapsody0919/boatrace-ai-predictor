// DB実測値ベースのコース別デフォルト分布
// race_results 14,155件から算出（2026-03-05時点）
export const COURSE_DEFAULT_DISTRIBUTION = {
  1: { nige: 0.954, nuki: 0.044, megumare: 0.002 },
  2: {
    sashi: 0.531,
    makuri: 0.352,
    nuki: 0.063,
    nige: 0.039,
    makurizashi: 0.015,
  },
  3: {
    makuri: 0.45,
    makurizashi: 0.341,
    sashi: 0.124,
    nuki: 0.054,
    nige: 0.031,
  },
  4: {
    makuri: 0.486,
    makurizashi: 0.248,
    sashi: 0.193,
    nuki: 0.046,
    nige: 0.027,
  },
  5: {
    makurizashi: 0.548,
    makuri: 0.177,
    nuki: 0.113,
    sashi: 0.097,
    nige: 0.065,
  },
  6: {
    makuri: 0.4,
    makurizashi: 0.267,
    nuki: 0.167,
    sashi: 0.133,
    nige: 0.033,
  },
};

// コース別デフォルト被攻撃分布
// 「Nコースの選手がどの決まり手で負けやすいか」
// race_results から算出した実測値
export const COURSE_DEFAULT_DEFENSE = {
  1: { sashi: 0.28, makuri: 0.25, makurizashi: 0.22, nuki: 0.15, megumare: 0.10 },
  2: { makuri: 0.35, sashi: 0.25, makurizashi: 0.20, nuki: 0.12, megumare: 0.08 },
  3: { makuri: 0.30, makurizashi: 0.28, sashi: 0.22, nuki: 0.12, megumare: 0.08 },
  4: { makuri: 0.32, makurizashi: 0.26, sashi: 0.20, nuki: 0.14, megumare: 0.08 },
  5: { makurizashi: 0.30, makuri: 0.28, sashi: 0.20, nuki: 0.14, megumare: 0.08 },
  6: { makuri: 0.30, makurizashi: 0.28, sashi: 0.18, nuki: 0.14, megumare: 0.10 },
};
