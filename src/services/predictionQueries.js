// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: prediction）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { PAYOUT_BET_TYPES } from "../utils/raceOutcome.js";

/**
 * getPredictions()の取得失敗を表す空レスポンス。
 * races: [] は既存の呼び出し側（HitRaces等、`data.races || []`で読むもの）を壊さない
 * ための互換値で、「取得に成功したが開催なし（fetchFailedなし）」との区別は
 * fetchFailed: true で行う。withCache()はこの値をキャッシュしない
 */
export function buildFetchFailedPredictions(date) {
  return {
    date,
    generatedAt: null,
    updatedAt: null,
    races: [],
    fetchFailed: true,
  };
}

/**
 * 会場コード→会場名のマッピング
 */
export const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

/**
 * race_results 1件分（camelCaseに正規化済み）から raceData.result を組み立てる共通ヘルパー
 * （BOA-238。Edge API経路/直接クエリ経路の2箇所から呼ばれるため重複を避けるために切り出した）
 * rank4〜6・追加payout種別・人気はバックフィルしていない過去データではnullのため、
 * 各セクションはpayoutが存在する場合のみエントリを持つ設計にしている
 *
 * ⚠️ 命名注意: 引数r（DB race_results由来）のpayoutTrifecta/payoutTrioは歴史的経緯で
 * 英語名と実態が逆転している（Trifecta=3連単/Trio=3連複が正しい英語ギャンブル用語で、
 * アプリ内の他機能（TrifectaReferenceCard.jsx等）もこの正しい意味で使っている）。
 * この関数の出力オブジェクトでは同じ混乱を持ち込まないよう、実際の意味で
 * sanrenpuku（3連複）/sanrentan（3連単）という曖昧さの無いキー名で正規化する
 */
/**
 * RPC の payoutRows（race_payouts の行の配列）を、結果タブの払戻表の行へ変換する（BOA-543）。
 * status: paid=通常 / special=特払 / no_amount=組番のみ（払戻金が空欄）/ no_race=不成立（返還）。
 * combination は「1-2-5」（079）。配列でなければ null（旧列へのフォールバック）
 */
function buildPayoutRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const order = new Map(PAYOUT_BET_TYPES.map((b, i) => [b.betType, i]));
  const known = rows.filter((row) => order.has(row?.betType));
  // 知らない勝式しか無い（将来の追加等）ときは、空の払戻表を出さず旧列にフォールバックさせる
  if (known.length === 0) return null;
  return known
    .map((row) => {
      const meta = PAYOUT_BET_TYPES[order.get(row.betType)];
      return {
        betType: row.betType,
        typeKey: meta.typeKey,
        separator: meta.separator,
        seq: Number(row.seq) || 1,
        boats: row.combination
          ? String(row.combination)
              .split("-")
              .map(Number)
              .filter((n) => Number.isInteger(n))
          : [],
        amount: typeof row.payout === "number" ? row.payout : null,
        status: row.payoutStatus ?? null,
        popularity: row.popularity ?? null,
      };
    })
    .sort(
      (a, b) => order.get(a.betType) - order.get(b.betType) || a.seq - b.seq,
    );
}

export function buildRaceResult(r) {
  if (!r || !r.rank1) return null;

  const sortAsc = (nums) => [...nums].sort((a, b) => a - b);
  const wideEntry = (amount, popularity, boats) =>
    amount
      ? { boats: sortAsc(boats), amount, popularity: popularity ?? null }
      : null;

  return {
    finished: true,
    isCancelled: r.isCancelled || false,
    // レースの成立状態と返還艇（078。109でRPCに追加）。判定は src/utils/raceOutcome.js を通す。
    // 旧フラグ isNoRace（is_no_race）は全行 false で機能していないため持たない（BOA-543）。
    // RPC未適用・078以前の行は null（＝未判定。今までどおり通常のレースとして扱う）
    raceStatus: r.raceStatus ?? null,
    refundBoats: Array.isArray(r.refundBoats) ? r.refundBoats : null,
    remark: r.remark ?? null,
    // 払戻明細（race_payouts、109でRPCに追加）。無ければ null で、結果タブは旧 payout_* 列の
    // payouts にフォールバックする（RPC未適用・過去データ・直接クエリのフォールバック経路）
    payoutRows: buildPayoutRows(r.payoutRows),
    rank1: r.rank1,
    rank2: r.rank2,
    rank3: r.rank3,
    rank4: r.rank4 ?? null,
    rank5: r.rank5 ?? null,
    rank6: r.rank6 ?? null,
    raceTimes: [
      r.raceTime1,
      r.raceTime2,
      r.raceTime3,
      r.raceTime4,
      r.raceTime5,
      r.raceTime6,
    ].map((t) => t || null),
    winningTechnique: r.winningTechnique || null,
    payouts: {
      win: r.payoutWin ? { boats: [r.rank1], amount: r.payoutWin } : null,
      place: [
        r.payoutPlace1 ? { boat: r.rank1, amount: r.payoutPlace1 } : null,
        r.payoutPlace2 ? { boat: r.rank2, amount: r.payoutPlace2 } : null,
      ].filter(Boolean),
      // DB列名はpayout_trifectaだが実態は3連複（順不同）
      sanrenpuku: r.payoutTrifecta
        ? {
            boats: sortAsc([r.rank1, r.rank2, r.rank3]),
            amount: r.payoutTrifecta,
            popularity: r.popularityTrifecta ?? null,
          }
        : null,
      // DB列名はpayout_trioだが実態は3連単（着順通り）
      sanrentan: r.payoutTrio
        ? {
            boats: [r.rank1, r.rank2, r.rank3],
            amount: r.payoutTrio,
            popularity: r.popularityTrio ?? null,
          }
        : null,
      exacta: r.payoutExacta
        ? {
            boats: [r.rank1, r.rank2],
            amount: r.payoutExacta,
            popularity: r.popularityExacta ?? null,
          }
        : null,
      quinella: r.payoutQuinella
        ? {
            boats: sortAsc([r.rank1, r.rank2]),
            amount: r.payoutQuinella,
            popularity: r.popularityQuinella ?? null,
          }
        : null,
      wide: [
        wideEntry(r.payoutWide1, r.popularityWide1, [r.rank1, r.rank2]),
        wideEntry(r.payoutWide2, r.popularityWide2, [r.rank1, r.rank3]),
        wideEntry(r.payoutWide3, r.popularityWide3, [r.rank2, r.rank3]),
      ].filter(Boolean),
    },
  };
}

/**
 * 予想根拠を生成する関数
 * 各モデルの特性に基づいた詳細な分析結果を生成
 */
export function generateReasoning(topPickPlayer, modelType) {
  if (!topPickPlayer) return ["予想データなし"];

  const reasons = [];
  const number = topPickPlayer.number;
  const name = topPickPlayer.name;
  const grade = topPickPlayer.grade || "";
  const winRate = parseFloat(topPickPlayer.winRate) || 0;
  const localWinRate = parseFloat(topPickPlayer.localWinRate) || 0;
  const motor2Rate = parseFloat(topPickPlayer.motor2Rate) || 0;
  const boat2Rate = parseFloat(topPickPlayer.boat2Rate) || 0;

  if (modelType === "standard") {
    // スタンダードモデル: 選手実力・機材・コース・当地相性を総合評価
    reasons.push(`【総合分析】${number}号艇 ${name}選手を本命に選定`);

    // 選手評価
    const playerAnalysis = [];
    if (grade === "A1") playerAnalysis.push("最高峰A1級の実力");
    else if (grade === "A2") playerAnalysis.push("上位A2級の安定感");
    else if (grade === "B1") playerAnalysis.push("B1級");

    if (winRate >= 7.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}はトップクラス`);
    else if (winRate >= 6.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}の高水準`);
    else if (winRate >= 5.0)
      playerAnalysis.push(`全国勝率${topPickPlayer.winRate}`);

    if (playerAnalysis.length > 0) {
      reasons.push(`選手力: ${playerAnalysis.join("、")}`);
    }

    // 機材評価
    const equipAnalysis = [];
    if (motor2Rate >= 45)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%は上位機`);
    else if (motor2Rate >= 35)
      equipAnalysis.push(`モーター2連率${topPickPlayer.motor2Rate}%で安定`);
    if (boat2Rate >= 40)
      equipAnalysis.push(`ボート2連率${topPickPlayer.boat2Rate}%の好艇`);

    if (equipAnalysis.length > 0) {
      reasons.push(`機材力: ${equipAnalysis.join("、")}`);
    }

    // 当地・コース評価
    const courseAnalysis = [];
    if (number === 1) courseAnalysis.push("1コースの圧倒的有利を活かせる位置");
    else if (number <= 3)
      courseAnalysis.push(`${number}コースからのスタート展開に期待`);

    if (localWinRate >= 7.0)
      courseAnalysis.push(`当地勝率${topPickPlayer.localWinRate}と抜群の相性`);
    else if (localWinRate >= 5.5)
      courseAnalysis.push(
        `当地勝率${topPickPlayer.localWinRate}で水面適性あり`,
      );

    if (courseAnalysis.length > 0) {
      reasons.push(`展開: ${courseAnalysis.join("、")}`);
    }

    reasons.push("→ 独自の重み付けアルゴリズムにより総合スコア最高と判定");
  } else if (modelType === "safeBet") {
    // 本命狙いモデル: 的中率重視、1コース・A級選手・安定性を重視
    reasons.push(`【堅実分析】${number}号艇 ${name}選手を本命に選定`);

    // コース優位性（本命狙いでは最重要）
    if (number === 1) {
      reasons.push(`コース: 1号艇は統計上55%以上の1着率、最も信頼できるコース`);
    } else if (number === 2) {
      reasons.push(`コース: 2号艇から差し・まくりの展開を想定`);
    } else if (number === 3) {
      reasons.push(`コース: 3号艇からまくり展開の可能性を評価`);
    } else {
      reasons.push(`コース: ${number}号艇ながら他要素で高評価`);
    }

    // 選手の安定性評価
    const stabilityAnalysis = [];
    if (grade === "A1") {
      stabilityAnalysis.push("A1級選手は安定した成績を残す傾向が強い");
      if (winRate >= 7.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}は信頼度◎`);
    } else if (grade === "A2") {
      stabilityAnalysis.push("A2級選手として堅実なレース運び");
      if (winRate >= 6.0)
        stabilityAnalysis.push(`勝率${topPickPlayer.winRate}で期待十分`);
    } else if (grade === "B1" && winRate >= 5.5) {
      stabilityAnalysis.push(
        `B1級ながら勝率${topPickPlayer.winRate}と実力上位`,
      );
    }

    if (stabilityAnalysis.length > 0) {
      reasons.push(`安定性: ${stabilityAnalysis.join("、")}`);
    }

    // 機材の信頼性
    if (motor2Rate >= 40 || boat2Rate >= 40) {
      const equipParts = [];
      if (motor2Rate >= 40)
        equipParts.push(`モーター${topPickPlayer.motor2Rate}%`);
      if (boat2Rate >= 40) equipParts.push(`ボート${topPickPlayer.boat2Rate}%`);
      reasons.push(`機材信頼度: ${equipParts.join("・")}で堅実`);
    }

    reasons.push("→ 的中率を最大化する独自ロジックにより選出");
  } else if (modelType === "upsetFocus") {
    // 穴狙いモデル: 期待値・回収率重視、過小評価されている要素を発掘
    reasons.push(`【穴馬分析】${number}号艇 ${name}選手を本命に選定`);

    // 穴要素の分析
    const upsetFactors = [];

    // アウトコースからの逆転要素
    if (number >= 4) {
      if (motor2Rate >= 40) {
        upsetFactors.push(
          `${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の上位機で逆転機会あり`,
        );
      } else if (motor2Rate >= 33) {
        upsetFactors.push(
          `${number}号艇でもモーター${topPickPlayer.motor2Rate}%でまくり展開を狙える`,
        );
      }
    } else if (number >= 2 && number <= 3) {
      if (localWinRate > winRate + 0.5) {
        upsetFactors.push(
          `当地勝率${topPickPlayer.localWinRate}が全国勝率を上回る隠れた適性`,
        );
      }
    }

    // 過小評価されがちな要素
    if (grade === "B1" && winRate >= 5.5) {
      upsetFactors.push(`B1級でも勝率${topPickPlayer.winRate}は侮れない実力`);
    }
    if (grade === "B1" && localWinRate >= 6.5) {
      upsetFactors.push(
        `当地勝率${topPickPlayer.localWinRate}は格上選手に匹敵`,
      );
    }
    if (grade === "A2" && number >= 3 && motor2Rate >= 38) {
      upsetFactors.push("A2級×好モーターの組み合わせで高配当狙い");
    }

    // ボート・モーターの爆発力
    if (motor2Rate >= 45) {
      upsetFactors.push(
        `モーター2連率${topPickPlayer.motor2Rate}%は上位3%の好機、波乱の主役候補`,
      );
    }

    if (upsetFactors.length > 0) {
      reasons.push(`発掘要素: ${upsetFactors.join("。")}`);
    } else {
      reasons.push(
        "発掘要素: 独自の期待値計算により高配当時の回収効率が高いと判定",
      );
    }

    // 期待値の説明
    if (number >= 4) {
      reasons.push(`配当期待: ${number}号艇の1着時は高配当が見込める`);
    } else if (grade === "B1") {
      reasons.push("配当期待: B1級選手の1着は配当妙味あり");
    }

    reasons.push("→ 回収率最大化を目指す独自アルゴリズムにより選出");
  }

  return reasons;
}
