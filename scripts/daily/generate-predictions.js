// AI予想生成スクリプト
// data/races.json を読み込んで、data/predictions/YYYY-MM-DD.json を生成
// Supabaseにも同時書き込み（デュアルライト）

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, isSupabaseEnabled, VENUE_CODES, VENUE_NAMES } from '../lib/supabaseClient.js';
import { getTodayDateJST, parseDateArg } from '../lib/dateUtils.js';
import { getRaceSchedule, getRacesInWindow } from '../lib/raceSchedule.js';
import { predictFirstMark } from '../lib/turnPrediction.js';
import { COURSE_DEFAULT_DISTRIBUTION, COURSE_DEFAULT_DEFENSE } from '../lib/winningTechniques.js';
import { VENUE_1COURSE_WIN_RATE, VENUE_1COURSE_AVG } from '../lib/venueParameters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 風向の度数（16方位）をテキストに変換
function convertWindDirection(direction) {
    const directions16 = [
        null, '北', '北北東', '北東', '東北東', '東', '東南東', '南東',
        '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'
    ];
    if (direction == null || direction === 0 || direction < 0 || direction > 16) {
        return null;
    }
    return directions16[direction];
}

// 標準偏差を計算
function calculateStdDev(values) {
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squareDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, val) => sum + val, 0) / squareDiffs.length;
    return Math.sqrt(avgSquareDiff);
}

// 荒れ度スコア v2（展開予測・展示・気象を統合）
function calculateVolatilityScore(racers, placeCd, turnPrediction, race) {
    if (!racers || racers.length < 6) {
        return { score: 50, reasons: ['選手データが不足しています'] };
    }

    let volatility = 0;
    const reasons = [];

    // デフォルト予測かどうか判定（データ不足時）
    const isDefault = turnPrediction.probability === 0.55 &&
        turnPrediction.boatStrengths.every(v => v === turnPrediction.boatStrengths[0]);

    // ===== Factor A: 展開予測エントロピー（0-45点）=====
    if (!isDefault) {
        const probs = Object.values(turnPrediction.distribution).filter(p => p > 0);
        const entropy = -probs.reduce((sum, p) => sum + p * Math.log2(p), 0);
        const maxEntropy = Math.log2(probs.length);
        const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

        let entropyScore = normalizedEntropy * 35;
        const topProb = turnPrediction.patterns[0].probability;
        const uncertaintyBonus = Math.max(0, (0.55 - topProb) * 25);
        entropyScore = Math.min(45, entropyScore + uncertaintyBonus);
        volatility += entropyScore;

        const nigeProb = turnPrediction.distribution.nige || 0;
        const nigePct = (nigeProb * 100).toFixed(0);
        if (normalizedEntropy > 0.7) {
            reasons.push(`展開予測が拮抗（逃げ確率: ${nigePct}%、複数の決まり手が有力）`);
        } else if (normalizedEntropy > 0.5) {
            reasons.push(`複数の展開パターンが想定される（逃げ確率: ${nigePct}%）`);
        }
    } else {
        // データ不足時のベース不確実性
        volatility += 20;
        reasons.push('展開予測データが不足（ベース不確実性を加算）');
    }

    // ===== Factor B: boatStrengths分散（0-20点）=====
    if (!isDefault) {
        const strengthStdDev = calculateStdDev(turnPrediction.boatStrengths);
        const strengthScore = Math.max(0, (0.08 - strengthStdDev) / 0.08 * 20);
        volatility += strengthScore;

        if (strengthScore > 8) {
            reasons.push('各艇の総合力が接近している');
        }
    }

    // ===== Factor C: 展示アノマリー（0-15点）=====
    let exhibitionScore = 0;
    if (race.exhibitionData && race.exhibitionData.length > 0) {
        // 1号艇の展示STが他艇より遅い
        const exSTs = race.exhibitionData
            .filter(e => e.startTiming != null)
            .map(e => ({ boat: e.boatNumber, st: e.startTiming }));
        if (exSTs.length >= 4) {
            const lane1ST = exSTs.find(e => e.boat === 1);
            const otherSTs = exSTs.filter(e => e.boat !== 1);
            if (lane1ST && otherSTs.length > 0) {
                const avgOtherST = otherSTs.reduce((s, e) => s + e.st, 0) / otherSTs.length;
                const stDiff = lane1ST.st - avgOtherST;
                if (stDiff > 0.02) {
                    exhibitionScore += Math.min(8, stDiff * 120);
                    reasons.push(`1号艇の展示STが他艇より遅い（${lane1ST.st.toFixed(2)}秒 vs 平均${avgOtherST.toFixed(2)}秒）`);
                }
            }
        }

        // 外枠に展示タイム上位の艇
        const exTimes = race.exhibitionData
            .filter(e => e.exhibitionTime != null)
            .map(e => ({ boat: e.boatNumber, time: e.exhibitionTime }));
        if (exTimes.length >= 4) {
            const avgExTime = exTimes.reduce((s, e) => s + e.time, 0) / exTimes.length;
            const fastOutside = exTimes.filter(e => e.boat >= 4 && e.time < avgExTime - 0.03);
            if (fastOutside.length > 0) {
                exhibitionScore += fastOutside.length * 4;
                reasons.push(`外枠に展示タイム上位の艇あり（${fastOutside.map(e => `${e.boat}号艇`).join('、')}）`);
            }
        }
    }
    volatility += Math.min(15, exhibitionScore);

    // ===== Factor D: 会場・気象（0-20点）=====
    const venueCode = String(placeCd).padStart(2, '0');
    const venueWinRate = VENUE_1COURSE_WIN_RATE[venueCode] || VENUE_1COURSE_AVG;
    let venueScore = Math.max(0, (VENUE_1COURSE_AVG - venueWinRate) / 0.10 * 12);
    venueScore = Math.min(12, venueScore);

    if (venueScore > 4) {
        reasons.push(`${race.placeName || venueCode}は1コース勝率が低く荒れやすい（${(venueWinRate * 100).toFixed(0)}%）`);
    }

    let weatherScore = 0;
    if (race.windVelocity != null && race.windVelocity >= 5) {
        weatherScore += Math.min(5, (race.windVelocity - 4) * 2);
        reasons.push(`風速${race.windVelocity}mで荒れやすい`);
    }
    if (race.waveHeight != null && race.waveHeight >= 5) {
        weatherScore += Math.min(3, race.waveHeight - 4);
        reasons.push(`波高${race.waveHeight}cmで水面不安定`);
    }
    volatility += Math.min(20, venueScore + weatherScore);

    // 最終スコア
    const finalScore = Math.min(100, Math.max(0, Math.round(volatility)));

    if (reasons.length === 0) {
        reasons.push(finalScore < 35 ? '1号艇が安定して有利な展開' : '標準的なレース展開');
    }

    return { score: finalScore, reasons };
}

// 荒れ度レベルを判定
function getVolatilityLevel(score) {
    if (score < 35) return 'low';    // 堅い
    if (score < 65) return 'medium'; // 標準
    return 'high';                    // 荒れる
}

// 推奨モデルを判定
function getRecommendedModel(score) {
    if (score < 35) return 'safe-bet';      // 本命狙い
    if (score < 65) return 'standard';      // スタンダード
    return 'upset-focus';                   // 穴狙い
}

// スタンダード版AIスコア（従来のロジック）
function calculateStandardScore(racer, index) {
    return Math.floor(
        racer.globalWinRate * 100 +
        racer.local2Rate * 50 +
        racer.motor2Rate * 30 +
        racer.boat2Rate * 20 -
        index * 5
    );
}

// スタンダードv2版AIスコア（統計的に最適化）
// 統計分析（2,172レース）に基づく係数:
// - 枠番の影響: 22倍差（最重要）
// - 全国勝率の影響: 10倍差（非常に重要）
// - 級別の影響: 5倍差（重要）
// - モーター性能: 5.2%差（限定的）
// - 当地成績: 3.7%差（限定的）
function calculateStandardScoreV2(racer, index, turnResult, exEntry, avgExTime) {
    let score = 0;

    // 全国勝率（最重要: 10倍の差がある）
    score += racer.globalWinRate * 150;

    // 級別ボーナス（非常に重要: A1はB2の5倍勝ちやすい）
    if (racer.grade === 'A1') score += 400;
    else if (racer.grade === 'A2') score += 250;
    else if (racer.grade === 'B1') score += 100;
    else if (racer.grade === 'B2') score += 0;

    // 枠番補正（圧倒的に重要: 1号艇は6号艇の22倍勝ちやすい）
    if (index === 0) score += 500;      // 1号艇
    else if (index === 1) score += 100; // 2号艇
    else if (index === 2) score += 0;   // 3号艇
    else if (index === 3) score -= 50;  // 4号艇
    else if (index === 4) score -= 100; // 5号艇
    else if (index === 5) score -= 150; // 6号艇

    // モーター性能（限定的: 5.2%の差）
    score += racer.motor2Rate * 20;

    // ボート性能（限定的: データ不足）
    score += racer.boat2Rate * 10;

    // 当地アドバンテージ（限定的: 3.7%の差）
    const localAdvantage = racer.localWinRate - racer.globalWinRate;
    score += localAdvantage * 10;

    // 展開予測ボーナス
    score += calculateTurnBonus(turnResult, racer.lane, 'standard');

    // 展示データボーナス
    score += calculateExhibitionBonus(exEntry, avgExTime, 'standard');

    return Math.floor(score);
}

// 本命狙い版スコア（堅実型）
function calculateSafeBetScore(racer, index, turnResult, exEntry, avgExTime) {
    let score = 0;

    // 1号艇に大きなボーナス
    if (index === 0) score += 150;

    // A1級に大きなボーナス
    if (racer.grade === 'A1') score += 120;
    else if (racer.grade === 'A2') score += 60;

    // 全国勝率を重視
    score += racer.globalWinRate * 130;

    // 当地勝率
    score += racer.localWinRate * 80;

    // モーター性能（やや控えめ）
    score += racer.motor2Rate * 40;

    // レーン位置ペナルティ（強め）
    score -= index * 15;

    // 展開予測ボーナス
    score += calculateTurnBonus(turnResult, racer.lane, 'safeBet');

    // 展示データボーナス
    score += calculateExhibitionBonus(exEntry, avgExTime, 'safeBet');

    return Math.floor(score);
}

// 穴狙い版スコア（高配当型）
function calculateUpsetFocusScore(racer, index, turnResult, exEntry, avgExTime) {
    let score = 0;

    // 外枠の逆転要素を重視
    if (index >= 3) score += 100; // 4-6号艇にボーナス

    // モーター性能を最重視（機材で逆転）
    score += racer.motor2Rate * 180;

    // ボート性能
    score += racer.boat2Rate * 80;

    // 当地適性（地元の利）
    score += racer.localWinRate * 100;
    score += racer.local2Rate * 60;

    // 全国勝率（やや控えめ）
    score += racer.globalWinRate * 50;

    // 1号艇へのペナルティ（逆張り）
    if (index === 0) score -= 100;

    // 展開予測ボーナス
    score += calculateTurnBonus(turnResult, racer.lane, 'upsetFocus');

    // 展示データボーナス
    score += calculateExhibitionBonus(exEntry, avgExTime, 'upsetFocus');

    return Math.floor(score);
}

// 選手データを処理（特定のスコア計算関数を使用）
function processRacersWithScoreFn(racers, scoreFn, turnResult, exhibitionData) {
    if (!racers || racers.length === 0) {
        console.warn('⚠️  選手データが空です');
        return [];
    }

    // 展示タイム平均を計算
    let avgExTime = null;
    if (exhibitionData && exhibitionData.length > 0) {
        const exTimes = exhibitionData
            .filter(e => e.exhibitionTime != null)
            .map(e => e.exhibitionTime);
        if (exTimes.length > 0) {
            avgExTime = exTimes.reduce((s, v) => s + v, 0) / exTimes.length;
        }
    }

    const players = racers.map((racer, idx) => {
        const exEntry = exhibitionData?.find(e => e.boatNumber === racer.lane) || null;
        return {
            number: racer.lane,
            racerId: racer.racerId || null,
            name: racer.name,
            grade: racer.grade,
            age: racer.age,
            winRate: racer.globalWinRate.toFixed(3),
            localWinRate: racer.localWinRate.toFixed(3),
            global2Rate: racer.global2Rate?.toFixed(1) || null,
            local2Rate: racer.local2Rate?.toFixed(1) || null,
            global3Rate: racer.global3Rate?.toFixed(1) || null,
            local3Rate: racer.local3Rate?.toFixed(1) || null,
            motorNumber: racer.motorNumber,
            motor2Rate: racer.motor2Rate.toFixed(1),
            motor3Rate: racer.motor3Rate?.toFixed(1) || null,
            boatNumber: racer.boatNumber,
            boat2Rate: racer.boat2Rate.toFixed(1),
            boat3Rate: racer.boat3Rate?.toFixed(1) || null,
            aiScore: scoreFn(racer, idx, turnResult, exEntry, avgExTime),
        };
    });

    // AIスコア順にソート
    return players.sort((a, b) => b.aiScore - a.aiScore);
}

// 後方互換性のため（従来のprocessRacers）
function processRacers(racers) {
    return processRacersWithScoreFn(racers, calculateStandardScoreV2);
}

// 本命選手の選定理由を生成
function generateTopPickReasoning(topPickPlayer, players, modelType) {
    const reasons = [];
    const number = topPickPlayer.number;
    const winRate = parseFloat(topPickPlayer.winRate);
    const localWinRate = parseFloat(topPickPlayer.localWinRate);
    const motor2Rate = parseFloat(topPickPlayer.motor2Rate);

    if (modelType === 'standard') {
        // スタンダード：バランス重視
        reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

        const strengths = [];
        if (winRate >= 6.5) {
            strengths.push(`全国勝率${topPickPlayer.winRate}の実力者`);
        }
        if (localWinRate >= 5.5) {
            strengths.push(`当地成績${topPickPlayer.localWinRate}と好相性`);
        }
        if (motor2Rate >= 35) {
            strengths.push(`モーター2連率${topPickPlayer.motor2Rate}%の${motor2Rate >= 40 ? '好' : '安定'}機材`);
        }

        if (strengths.length > 0) {
            reasons.push(strengths.join('、') + 'で総合評価が最高');
        } else {
            reasons.push('総合的なデータ分析により最高評価を獲得');
        }

    } else if (modelType === 'safe-bet') {
        // 本命狙い：安全性重視
        reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

        const strengths = [];
        if (number === 1) {
            strengths.push('1号艇の有利なコース取り');
        }
        if (topPickPlayer.grade === 'A1') {
            strengths.push('A1級選手として安定した実力');
        } else if (topPickPlayer.grade === 'A2') {
            strengths.push('A2級選手として堅実な実績');
        }
        if (winRate >= 6.0) {
            strengths.push(`全国勝率${topPickPlayer.winRate}の高い実力`);
        }

        if (strengths.length > 0) {
            reasons.push(strengths.join('、') + 'により的中率が期待できる');
        } else {
            reasons.push('安全性を重視した評価で最高スコアを獲得');
        }

    } else if (modelType === 'upset-focus') {
        // 穴狙い：高配当重視
        reasons.push(`${number}号艇 ${topPickPlayer.name}選手を本命に選定`);

        const strengths = [];
        if (number >= 4 && motor2Rate >= 38) {
            strengths.push(`${number}号艇ながらモーター2連率${topPickPlayer.motor2Rate}%の好機材`);
        }
        if (localWinRate >= 5.5) {
            strengths.push(`当地成績${topPickPlayer.localWinRate}で展開に期待`);
        }
        if (motor2Rate >= 40) {
            strengths.push('好モーターを活かした高配当の可能性');
        }

        if (strengths.length > 0) {
            reasons.push(strengths.join('、'));
        } else {
            reasons.push('展開の妙と機材性能を重視した評価で最高スコア');
        }
    }

    return reasons;
}

// 統計的な注目ポイントを生成（参考情報）
function generateStatisticalInsights(players) {
    const insights = [];

    // モーター2率が40%以上の選手
    const goodMotors = players.filter(p => parseFloat(p.motor2Rate) > 40);
    if (goodMotors.length > 0) {
        const motorList = goodMotors.map(p =>
            `${p.number}号艇（${p.motor2Rate}%）`
        ).join('、');
        insights.push(
            `好モーター: ${motorList}`
        );
    }

    // 全国勝率が7.0以上の選手
    const topRacers = players.filter(p => parseFloat(p.winRate) >= 7.0);
    if (topRacers.length > 0) {
        const racerList = topRacers.map(p =>
            `${p.number}号艇（勝率${p.winRate}）`
        ).join('、');
        insights.push(
            `実力者: ${racerList}`
        );
    }

    return insights;
}

// レースIDを生成
function generateRaceId(date, placeCd, raceNo) {
    return `${date}-${String(placeCd).padStart(2, '0')}-${String(raceNo).padStart(2, '0')}`;
}

// 信頼度を計算（トップピックのAIスコアと2位のAIスコアの差から算出）
function calculateConfidence(players) {
    if (players.length < 2) return 70;

    const scoreDiff = players[0].aiScore - players[1].aiScore;
    // スコア差が大きいほど信頼度が高い（70-95%の範囲）
    const confidence = Math.min(95, Math.max(70, 70 + Math.floor(scoreDiff / 10)));
    return confidence;
}

// racer_aggregated_stats から選手統計を一括取得
async function fetchRacerStats(racerIds) {
    if (!isSupabaseEnabled() || racerIds.length === 0) return new Map();

    const map = new Map();
    const CHUNK_SIZE = 900; // Supabase .in() の1000件制限内

    for (let i = 0; i < racerIds.length; i += CHUNK_SIZE) {
        const chunk = racerIds.slice(i, i + CHUNK_SIZE);
        const { data, error } = await supabase
            .from('racer_aggregated_stats')
            .select('racer_id, avg_st, st_stddev, attack_distribution, defense_distribution, course_race_counts')
            .in('racer_id', chunk)
            .eq('venue_code', 0);

        if (error) {
            console.error('racer_aggregated_stats取得エラー:', error.message);
            continue;
        }
        data?.forEach(r => map.set(r.racer_id, r));
    }

    return map;
}

// 展開予測ボーナスを計算
function calculateTurnBonus(turnResult, boatLane, modelType) {
    if (!turnResult?.patterns) return 0;
    let bonus = 0;
    for (const pattern of turnResult.patterns) {
        const prob = pattern.probability;

        // 1着ボーナス
        if (pattern.winnerCourse === boatLane) {
            switch (modelType) {
                case 'standard':  bonus += prob * 300; break;
                case 'safeBet':
                    bonus += prob * (pattern.technique === 'nige' ? 500 : 150); break;
                case 'upsetFocus':
                    bonus += prob * (pattern.technique === 'nige' ? 100 : 400); break;
            }
        }

        // 2着ボーナス
        const secondProb = pattern.secondPlace?.[boatLane] || 0;
        if (secondProb > 0) {
            const w = { standard: 150, safeBet: 200, upsetFocus: 100 }[modelType];
            bonus += prob * secondProb * w;
        }

        // 3着ボーナス
        const thirdProb = pattern.thirdPlace?.[boatLane] || 0;
        if (thirdProb > 0) {
            const w = { standard: 80, safeBet: 100, upsetFocus: 60 }[modelType];
            bonus += prob * thirdProb * w;
        }
    }
    return Math.round(bonus);
}

// 展示データボーナスを計算
function calculateExhibitionBonus(exhibitionEntry, avgExTime, modelType) {
    if (!exhibitionEntry) return 0;
    let bonus = 0;

    // 展示タイム（速い = 良いモーター/セッティング）
    if (exhibitionEntry.exhibitionTime && avgExTime) {
        const diff = avgExTime - exhibitionEntry.exhibitionTime;
        const weight = { standard: 50, safeBet: 30, upsetFocus: 80 }[modelType];
        bonus += diff * weight;
    }

    // 展示ST（速い = スタート力）
    if (exhibitionEntry.startTiming != null) {
        const stBonus = Math.max(0, (0.18 - exhibitionEntry.startTiming)) * 100;
        const weight = { standard: 40, safeBet: 25, upsetFocus: 60 }[modelType];
        bonus += stBonus * weight;
    }

    return Math.round(bonus);
}

// 展開予測パターンの1着・2着・3着からtop3を取得
function getTop3FromPattern(pattern) {
    if (!pattern) return null;
    const first = pattern.winnerCourse;

    // 2着: secondPlaceの最大確率コース（1着除外）
    let second = null, maxSecond = 0;
    for (const [c, p] of Object.entries(pattern.secondPlace || {})) {
        if (Number(c) !== first && p > maxSecond) { maxSecond = p; second = Number(c); }
    }

    // 3着: thirdPlaceの最大確率コース（1着・2着除外）
    let third = null, maxThird = 0;
    for (const [c, p] of Object.entries(pattern.thirdPlace || {})) {
        if (Number(c) !== first && Number(c) !== second && p > maxThird) { maxThird = p; third = Number(c); }
    }

    if (!second || !third) return null;
    return [first, second, third];
}

// 1レース分の予想を生成（3モデル対応）
function generateRacePrediction(race, date, racerStatsMap) {
    if (!race.racers || race.racers.length === 0) {
        console.warn(`⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`);
        return null;
    }

    // 1マーク展開予測を算出（racer_aggregated_stats のデータを使用）
    // ※ 展開予測ボーナスをスコア計算に反映するため、モデル処理の前に実行する
    const turnPredictionPlayers = race.racers.map((racer) => {
        const exhibitionEntry = race.exhibitionData?.find(e => e.boatNumber === racer.lane);
        const stats = racerStatsMap?.get(racer.racerId) || null;
        return {
            boatNumber: racer.lane,
            course: racer.lane, // 枠番=進入コース（デフォルト）
            exhibitionST: exhibitionEntry?.startTiming ?? null,
            avgST: stats?.avg_st ?? null,
            stStddev: stats?.st_stddev ?? null,
            attackDistribution: stats?.attack_distribution || null,
            defenseDistribution: stats?.defense_distribution || null,
            courseRaceCounts: stats?.course_race_counts || null,
            exhibitionTime: exhibitionEntry?.exhibitionTime ?? null,
            motor2Rate: racer.motor2Rate || null,
            globalWinRate: racer.globalWinRate || null,
            global2Rate: racer.global2Rate || null,
            localWinRate: racer.localWinRate || null,
            local2Rate: racer.local2Rate || null,
            grade: racer.grade || null,
        };
    });
    const raceConditions = {
        venueCode: race.placeCd,
        windSpeed: race.windVelocity,
        waveHeight: race.waveHeight,
    };
    const turnPrediction = predictFirstMark(turnPredictionPlayers, raceConditions);

    // 荒れ度スコアを計算（展開予測の結果を活用）
    const volatilityData = calculateVolatilityScore(race.racers, race.placeCd, turnPrediction, race);
    const volatilityLevel = getVolatilityLevel(volatilityData.score);
    const recommendedModel = getRecommendedModel(volatilityData.score);

    // 3つのモデルで予想を生成（展開予測・展示データを反映）
    const standardPlayers = processRacersWithScoreFn(race.racers, calculateStandardScoreV2, turnPrediction, race.exhibitionData);
    const safeBetPlayers = processRacersWithScoreFn(race.racers, calculateSafeBetScore, turnPrediction, race.exhibitionData);
    const upsetFocusPlayers = processRacersWithScoreFn(race.racers, calculateUpsetFocusScore, turnPrediction, race.exhibitionData);

    if (standardPlayers.length === 0) {
        console.warn(`⚠️  レース ${race.placeCd}-${race.raceNo} の選手データが不足しています`);
        return null;
    }

    // 展開予測パターンをモデルにマッピング
    // patterns[0]（最高確率）→ safeBet（本命狙い）
    // patterns[1]（2番目）  → standard（スタンダード）
    // patterns[2]（3番目）  → upsetFocus（穴狙い）
    const patterns = turnPrediction?.patterns || [];
    const safeBetTurn = getTop3FromPattern(patterns[0] || null);
    const standardTurn = getTop3FromPattern(patterns[1] || null);
    const upsetFocusTurn = getTop3FromPattern(patterns[2] || null);

    // 本命狙い版の予想（展開予測パターン1）
    const safeBetTopPick = safeBetTurn ? safeBetTurn[0] : safeBetPlayers[0].number;
    const safeBetTop3 = safeBetTurn || safeBetPlayers.slice(0, 3).map(p => p.number);
    const safeBetConfidence = calculateConfidence(safeBetPlayers);
    const safeBetTopPlayer = safeBetPlayers.find(p => p.number === safeBetTopPick) || safeBetPlayers[0];
    const safeBetReasoning = generateTopPickReasoning(safeBetTopPlayer, safeBetPlayers, 'safe-bet');

    // スタンダード版の予想（展開予測パターン2）
    const standardTopPick = standardTurn ? standardTurn[0] : standardPlayers[0].number;
    const standardTop3 = standardTurn || standardPlayers.slice(0, 3).map(p => p.number);
    const standardConfidence = calculateConfidence(standardPlayers);
    const standardTopPlayer = standardPlayers.find(p => p.number === standardTopPick) || standardPlayers[0];
    const standardReasoning = generateTopPickReasoning(standardTopPlayer, standardPlayers, 'standard');

    // 穴狙い版の予想（展開予測パターン3）
    const upsetFocusTopPick = upsetFocusTurn ? upsetFocusTurn[0] : upsetFocusPlayers[0].number;
    const upsetFocusTop3 = upsetFocusTurn || upsetFocusPlayers.slice(0, 3).map(p => p.number);
    const upsetFocusConfidence = calculateConfidence(upsetFocusPlayers);
    const upsetFocusTopPlayer = upsetFocusPlayers.find(p => p.number === upsetFocusTopPick) || upsetFocusPlayers[0];
    const upsetFocusReasoning = generateTopPickReasoning(upsetFocusTopPlayer, upsetFocusPlayers, 'upset-focus');

    return {
        raceId: generateRaceId(date, race.placeCd, race.raceNo),
        venue: race.placeName,
        venueCode: race.placeCd,
        raceNumber: race.raceNo,
        startTime: race.startTime || '未定',

        // 天候情報（race_conditionsテーブル用）
        conditions: {
            weather: race.weather || null,
            airTemp: race.airTemp ?? null,
            windDirection: race.windDirection ?? null,
            windVelocity: race.windVelocity ?? null,
            waterTemp: race.waterTemp ?? null,
            waveHeight: race.waveHeight ?? null,
            raceGrade: race.raceGrade || null,
            raceTitle: race.raceTitle || null,
        },

        // 荒れ度情報
        volatility: {
            score: volatilityData.score,
            level: volatilityLevel,
            recommendedModel: recommendedModel,
            reasons: volatilityData.reasons,
        },

        // 3モデルの予想
        predictions: {
            standard: {
                topPick: standardTopPick,
                top3: standardTop3,
                confidence: standardConfidence,
                players: standardPlayers,
                reasoning: standardReasoning,
            },
            safeBet: {
                topPick: safeBetTopPick,
                top3: safeBetTop3,
                confidence: safeBetConfidence,
                players: safeBetPlayers,
                reasoning: safeBetReasoning,
            },
            upsetFocus: {
                topPick: upsetFocusTopPick,
                top3: upsetFocusTop3,
                confidence: upsetFocusConfidence,
                players: upsetFocusPlayers,
                reasoning: upsetFocusReasoning,
            },
        },

        // 1マーク展開予測
        turnPrediction: {
            technique: turnPrediction.technique,
            probability: turnPrediction.probability,
            winnerCourse: turnPrediction.winnerCourse,
            distribution: turnPrediction.distribution,
            patterns: turnPrediction.patterns || null,
            boatStrengths: turnPrediction.boatStrengths || null,
        },

        // 超展開データ（攻守の実績データ）
        racerStats: turnPredictionPlayers.map(p => ({
            boatNumber: p.boatNumber,
            course: p.course,
            avgST: p.avgST,
            attackDistribution: p.attackDistribution,
            defenseDistribution: p.defenseDistribution,
            courseRaceCounts: p.courseRaceCounts,
        })),

        // 後方互換性のため（既存のpredictionフィールドを維持）
        prediction: {
            topPick: standardTopPick,
            top3: standardTop3,
            confidence: standardConfidence,
            players: standardPlayers,
            reasoning: standardReasoning,
        },

        // 展示データ（exhibition_data upsert用）
        exhibitionData: race.exhibitionData || null,

        result: {
            finished: false,
            rank1: null,
            rank2: null,
            rank3: null,
            updatedAt: null,
        },
        accuracy: {
            topPickHit: null,
            top3Hit: null,
            top3Included: null,
        },
    };
}

// Supabaseにデータを書き込む関数
async function writeToSupabase(allPredictions, date) {
    if (!isSupabaseEnabled()) {
        console.log('⚠️  Supabase未設定のため、DB書き込みをスキップします');
        return;
    }

    console.log('\n📤 Supabaseにデータを書き込み中...');

    try {
        // 1. racesテーブルにupsert
        const racesData = allPredictions.map(race => {
            // 選手データから統計を計算
            const players = race.predictions.standard.players;
            const winRates = players.map(p => parseFloat(p.winRate));
            const motorRates = players.map(p => parseFloat(p.motor2Rate));
            const firstPlayer = players.find(p => p.number === 1);

            return {
                race_id: race.raceId,
                race_date: date,
                venue_code: race.venueCode,
                race_number: race.raceNumber,
                start_time: race.startTime !== '未定' ? race.startTime + ':00' : null,
                volatility_score: race.volatility.score,
                volatility_level: race.volatility.level,
                recommended_model: race.volatility.recommendedModel,
                volatility_reasons: race.volatility.reasons,
                first_boat_grade: firstPlayer?.grade || null,
                first_boat_win_rate: firstPlayer ? parseFloat(firstPlayer.winRate) : null,
                first_boat_motor_2rate: firstPlayer ? parseFloat(firstPlayer.motor2Rate) : null,
                win_rate_stddev: calculateStdDev(winRates),
                win_rate_avg: winRates.reduce((a, b) => a + b, 0) / winRates.length,
                motor_2rate_stddev: calculateStdDev(motorRates),
                updated_at: new Date().toISOString()
            };
        });

        const { error: racesError } = await supabase
            .from('races')
            .upsert(racesData, { onConflict: 'race_id' });

        if (racesError) {
            console.error('❌ races書き込みエラー:', racesError.message);
        } else {
            console.log(`  ✅ races: ${racesData.length}件`);
        }

        // 2. race_entriesテーブルにupsert
        const entriesData = [];
        for (const race of allPredictions) {
            const standardPlayers = race.predictions.standard.players;
            const safeBetPlayers = race.predictions.safeBet.players;
            const upsetPlayers = race.predictions.upsetFocus.players;

            for (const player of standardPlayers) {
                const safeBetPlayer = safeBetPlayers.find(p => p.number === player.number);
                const upsetPlayer = upsetPlayers.find(p => p.number === player.number);

                entriesData.push({
                    race_id: race.raceId,
                    boat_number: player.number,
                    racer_id: player.racerId,
                    player_name: player.name,
                    grade: player.grade,
                    age: player.age,
                    win_rate: parseFloat(player.winRate),
                    local_win_rate: parseFloat(player.localWinRate),
                    global_2rate: player.global2Rate ? parseFloat(player.global2Rate) : null,
                    local_2rate: player.local2Rate ? parseFloat(player.local2Rate) : null,
                    global_3rate: player.global3Rate ? parseFloat(player.global3Rate) : null,
                    local_3rate: player.local3Rate ? parseFloat(player.local3Rate) : null,
                    motor_number: player.motorNumber,
                    motor_2rate: parseFloat(player.motor2Rate),
                    motor_3rate: player.motor3Rate ? parseFloat(player.motor3Rate) : null,
                    boat_number_id: player.boatNumber,
                    boat_2rate: parseFloat(player.boat2Rate),
                    boat_3rate: player.boat3Rate ? parseFloat(player.boat3Rate) : null,
                    ai_score_standard: player.aiScore,
                    ai_score_safe_bet: safeBetPlayer?.aiScore || 0,
                    ai_score_upset_focus: upsetPlayer?.aiScore || 0
                });
            }
        }

        // バッチでupsert（1000件ずつ）
        for (let i = 0; i < entriesData.length; i += 1000) {
            const batch = entriesData.slice(i, i + 1000);
            const { error: entriesError } = await supabase
                .from('race_entries')
                .upsert(batch, { onConflict: 'race_id,boat_number' });

            if (entriesError) {
                console.error('❌ race_entries書き込みエラー:', entriesError.message);
            }
        }
        console.log(`  ✅ race_entries: ${entriesData.length}件`);

        // 2.5. exhibition_dataテーブルにupsert
        const exhibitionRows = [];
        for (const race of allPredictions) {
            const raceId = race.raceId;
            // races.jsonのexhibitionDataは各ボートの展示データ
            // raceIdに対応するrace objectを探す
            // allPredictionsの元データから展示データを取得
            if (race.exhibitionData) {
                for (const ex of race.exhibitionData) {
                    if (ex.exhibitionTime != null || ex.startTiming != null) {
                        exhibitionRows.push({
                            race_id: raceId,
                            boat_number: ex.boatNumber,
                            exhibition_time: ex.exhibitionTime,
                            start_timing: ex.startTiming,
                        });
                    }
                }
            }
        }

        if (exhibitionRows.length > 0) {
            for (let i = 0; i < exhibitionRows.length; i += 1000) {
                const batch = exhibitionRows.slice(i, i + 1000);
                const { error: exError } = await supabase
                    .from('exhibition_data')
                    .upsert(batch, { onConflict: 'race_id,boat_number' });

                if (exError) {
                    console.error('❌ exhibition_data書き込みエラー:', exError.message);
                }
            }
            console.log(`  ✅ exhibition_data: ${exhibitionRows.length}件`);
        }

        // 3. predictionsテーブルにupsert
        const predictionsData = [];
        for (const race of allPredictions) {
            // Standard model (turnPredictionはstandard行に格納)
            const std = race.predictions.standard;
            predictionsData.push({
                race_id: race.raceId,
                model_id: 'standard',
                top_pick: std.topPick,
                top_2nd: std.top3[1] || null,
                top_3rd: std.top3[2] || null,
                confidence: std.confidence,
                is_shadow: false,
                feature_contributions: (race.turnPrediction || race.racerStats) ? {
                    turnPrediction: race.turnPrediction || null,
                    racerStats: race.racerStats || null,
                } : null
            });

            // SafeBet model
            const safe = race.predictions.safeBet;
            predictionsData.push({
                race_id: race.raceId,
                model_id: 'safeBet',
                top_pick: safe.topPick,
                top_2nd: safe.top3[1] || null,
                top_3rd: safe.top3[2] || null,
                confidence: safe.confidence,
                is_shadow: false,
                feature_contributions: (race.turnPrediction || race.racerStats) ? {
                    turnPrediction: race.turnPrediction || null,
                    racerStats: race.racerStats || null,
                } : null
            });

            // UpsetFocus model
            const upset = race.predictions.upsetFocus;
            predictionsData.push({
                race_id: race.raceId,
                model_id: 'upsetFocus',
                top_pick: upset.topPick,
                top_2nd: upset.top3[1] || null,
                top_3rd: upset.top3[2] || null,
                confidence: upset.confidence,
                is_shadow: false,
                feature_contributions: (race.turnPrediction || race.racerStats) ? {
                    turnPrediction: race.turnPrediction || null,
                    racerStats: race.racerStats || null,
                } : null
            });
        }

        // 既存の予測を削除してから挿入（upsertだと複合キーが必要なため）
        const raceIds = allPredictions.map(r => r.raceId);
        await supabase
            .from('predictions')
            .delete()
            .in('race_id', raceIds)
            .eq('is_shadow', false);

        // バッチで挿入
        for (let i = 0; i < predictionsData.length; i += 1000) {
            const batch = predictionsData.slice(i, i + 1000);
            const { error: predsError } = await supabase
                .from('predictions')
                .insert(batch);

            if (predsError) {
                console.error('❌ predictions書き込みエラー:', predsError.message);
            }
        }
        console.log(`  ✅ predictions: ${predictionsData.length}件`);

        // 4. race_conditionsテーブルにupsert
        const conditionsData = allPredictions
            .filter(race => race.conditions?.weather || race.conditions?.airTemp != null || race.conditions?.raceGrade)
            .map(race => ({
                race_id: race.raceId,
                weather: race.conditions.weather,
                wind_direction: convertWindDirection(race.conditions.windDirection),
                wind_speed: race.conditions.windVelocity,
                wave_height: race.conditions.waveHeight != null ? Math.round(race.conditions.waveHeight) : null,
                temperature: race.conditions.airTemp,
                water_temperature: race.conditions.waterTemp,
                race_grade: race.conditions.raceGrade,
                race_title: race.conditions.raceTitle,
                series_day: null,
                is_final_day: null
            }));

        if (conditionsData.length > 0) {
            const { error: conditionsError } = await supabase
                .from('race_conditions')
                .upsert(conditionsData, { onConflict: 'race_id' });
            if (conditionsError) {
                console.error('❌ race_conditions書き込みエラー:', conditionsError.message);
            } else {
                console.log(`  ✅ race_conditions: ${conditionsData.length}件`);
            }
        }

        console.log('✅ Supabase書き込み完了');

    } catch (error) {
        console.error('❌ Supabase書き込みエラー:', error.message);
    }
}

// ---------------------------------------------------------------------------
// リフレッシュモード（--refresh）
// Supabase から直接データを読んで対象レースの predictions を更新する
// ---------------------------------------------------------------------------

/**
 * Supabase から対象レースのデータを取得し、generateRacePrediction が期待する
 * race オブジェクト形式に変換する
 */
async function fetchRaceDataFromSupabase(raceIds) {
    const [entriesRes, conditionsRes, exhibitionRes] = await Promise.all([
        supabase.from('race_entries').select('*').in('race_id', raceIds),
        supabase.from('race_conditions').select('*').in('race_id', raceIds),
        supabase.from('exhibition_data').select('*').in('race_id', raceIds),
    ]);

    if (entriesRes.error) throw new Error(`race_entries取得エラー: ${entriesRes.error.message}`);

    // race_id ごとにグループ化
    const entriesByRace = new Map();
    for (const e of entriesRes.data || []) {
        if (!entriesByRace.has(e.race_id)) entriesByRace.set(e.race_id, []);
        entriesByRace.get(e.race_id).push(e);
    }
    const conditionsByRace = new Map(
        (conditionsRes.data || []).map(c => [c.race_id, c])
    );
    const exhibitionByRace = new Map();
    for (const ex of exhibitionRes.data || []) {
        if (!exhibitionByRace.has(ex.race_id)) exhibitionByRace.set(ex.race_id, []);
        exhibitionByRace.get(ex.race_id).push(ex);
    }

    const races = [];
    for (const raceId of raceIds) {
        const entries = entriesByRace.get(raceId);
        if (!entries || entries.length === 0) continue;

        // race_id から venue_code と race_number を復元（YYYY-MM-DD-VV-RR）
        const parts = raceId.split('-');
        const venueCode = parseInt(parts[3], 10);
        const raceNo = parseInt(parts[4], 10);
        const cond = conditionsByRace.get(raceId) || {};

        // race_entries → racers 配列（generateRacePrediction が期待する形式）
        const racers = entries
            .sort((a, b) => a.boat_number - b.boat_number)
            .map(e => ({
                lane: e.boat_number,
                racerId: e.racer_id,
                name: e.player_name,
                grade: e.grade,
                age: e.age,
                globalWinRate: e.win_rate,
                global2Rate: e.global_2rate,
                global3Rate: e.global_3rate,
                localWinRate: e.local_win_rate,
                local2Rate: e.local_2rate,
                local3Rate: e.local_3rate,
                motorNumber: e.motor_number,
                motor2Rate: e.motor_2rate,
                motor3Rate: e.motor_3rate,
                boatNumber: e.boat_number_id,
                boat2Rate: e.boat_2rate,
                boat3Rate: e.boat_3rate,
            }));

        // exhibition_data → exhibitionData 配列
        const exhibitionData = (exhibitionByRace.get(raceId) || []).map(ex => ({
            boatNumber: ex.boat_number,
            exhibitionTime: ex.exhibition_time,
            startTiming: ex.start_timing,
        }));

        races.push({
            raceId,
            placeCd: venueCode,
            placeName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
            raceNo,
            racers,
            exhibitionData: exhibitionData.length > 0 ? exhibitionData : null,
            // 天候情報（race_conditions から）
            weather: cond.weather || null,
            airTemp: cond.temperature ?? null,
            windDirection: null, // race_conditions は文字列保存のため省略（予測スコアに影響しない）
            windVelocity: cond.wind_speed ?? null,
            waterTemp: cond.water_temperature ?? null,
            waveHeight: cond.wave_height ?? null,
            raceGrade: cond.race_grade || null,
            raceTitle: cond.race_title || null,
        });
    }
    return races;
}

/**
 * リフレッシュモードのメイン処理
 * オーケストレーターから直接インポートして呼び出し可能
 */
export async function mainRefresh({ isDryRun, specificRaceIds }) {
    console.log(`🔄 予測リフレッシュモード${isDryRun ? ' [DRY-RUN]' : ''}`);
    console.log(`⏰ ${new Date().toISOString()}`);

    if (!isSupabaseEnabled()) {
        console.error('❌ Supabase環境変数が未設定です。');
        process.exit(1);
    }

    const date = parseDateArg() || getTodayDateJST();
    console.log(`📅 対象日: ${date}`);

    // 対象 race_ids を決定
    let targetRaceIds = specificRaceIds || [];
    if (targetRaceIds.length === 0) {
        // 自動検出: 発走60/30/15/10/5分前ウィンドウのレース
        const schedule = await getRaceSchedule(date);
        const WINDOWS = [60, 30, 15, 10, 5];
        const seen = new Set();
        for (const min of WINDOWS) {
            for (const r of getRacesInWindow(schedule, min, 8)) {
                if (!seen.has(r.race_id)) {
                    seen.add(r.race_id);
                    targetRaceIds.push(r.race_id);
                }
            }
        }
    }

    if (targetRaceIds.length === 0) {
        console.log('📭 更新対象レースなし（全ウィンドウ外）');
        return;
    }
    console.log(`🎯 更新対象: ${targetRaceIds.length}レース`);

    // Supabase からレースデータを取得
    const races = await fetchRaceDataFromSupabase(targetRaceIds);
    if (races.length === 0) {
        console.log('📭 対象レースのデータが未登録（race_entries なし）');
        return;
    }

    // 選手 ID を収集して racer_aggregated_stats を一括取得
    const allRacerIds = new Set();
    for (const race of races) {
        for (const racer of race.racers) {
            if (racer.racerId) allRacerIds.add(racer.racerId);
        }
    }
    const racerStatsMap = await fetchRacerStats([...allRacerIds]);

    // 各レースの予測を生成
    const allPredictions = [];
    for (const race of races) {
        const prediction = generateRacePrediction(race, date, racerStatsMap);
        if (prediction) {
            allPredictions.push(prediction);
            const exInfo = race.exhibitionData ? `（展示あり）` : `（展示なし）`;
            console.log(`  ✅ ${race.placeName} ${race.raceNo}R — 本命: ${prediction.predictions.standard.topPick}号艇 ${exInfo}`);
        } else {
            console.log(`  ❌ ${race.placeName} ${race.raceNo}R — 予測生成失敗`);
        }
    }

    if (allPredictions.length === 0) {
        console.log('📭 更新データなし');
        return;
    }

    if (isDryRun) {
        console.log(`\n[DRY-RUN] ${allPredictions.length}レースの予測を生成（Supabase書き込みはスキップ）`);
        return;
    }

    // predictions テーブルを更新（対象 race_id のみ delete → insert）
    console.log(`\n💾 predictions を更新中...`);
    const updatedRaceIds = allPredictions.map(r => r.raceId);

    const { error: deleteError } = await supabase.from('predictions').delete()
        .in('race_id', updatedRaceIds)
        .eq('is_shadow', false);
    if (deleteError) {
        console.error('❌ predictions削除エラー:', deleteError.message);
        return;
    }

    const predictionsData = [];
    for (const race of allPredictions) {
        const { standard: std, safeBet: safe, upsetFocus: upset } = race.predictions;
        const featureContrib = (race.turnPrediction || race.racerStats) ? {
            turnPrediction: race.turnPrediction || null,
            racerStats: race.racerStats || null,
        } : null;

        predictionsData.push(
            { race_id: race.raceId, model_id: 'standard',    top_pick: std.topPick,   top_2nd: std.top3[1]||null,   top_3rd: std.top3[2]||null,   confidence: std.confidence,   is_shadow: false, feature_contributions: featureContrib },
            { race_id: race.raceId, model_id: 'safeBet',     top_pick: safe.topPick,  top_2nd: safe.top3[1]||null,  top_3rd: safe.top3[2]||null,  confidence: safe.confidence,  is_shadow: false, feature_contributions: featureContrib },
            { race_id: race.raceId, model_id: 'upsetFocus',  top_pick: upset.topPick, top_2nd: upset.top3[1]||null, top_3rd: upset.top3[2]||null, confidence: upset.confidence, is_shadow: false, feature_contributions: featureContrib },
        );
    }

    for (let i = 0; i < predictionsData.length; i += 1000) {
        const batch = predictionsData.slice(i, i + 1000);
        const { error } = await supabase.from('predictions').insert(batch);
        if (error) console.error('❌ predictions書き込みエラー:', error.message);
    }
    console.log(`  ✅ predictions: ${predictionsData.length}件（${allPredictions.length}レース）`);

    // Vercel Deploy Hook をトリガー
    const deployHook = process.env.VERCEL_DEPLOY_HOOK;
    if (deployHook) {
        try {
            await fetch(deployHook, { method: 'POST' });
            console.log('🚀 Vercel Deploy Hook トリガー済み');
        } catch (e) {
            console.warn('⚠️ Vercel Deploy Hook 失敗:', e.message);
        }
    }

    console.log('🏁 リフレッシュ完了');
}

// メイン処理
async function main() {
    try {
        console.log('🚀 AI予想生成を開始します...');

        // data/races.json を読み込み
        const racesPath = path.join(__dirname, '..', '..', 'data', 'races.json');
        console.log(`📖 レースデータを読み込み中: ${racesPath}`);

        const racesData = JSON.parse(await fs.readFile(racesPath, 'utf-8'));

        if (!racesData.success || !racesData.data) {
            throw new Error('races.json に有効なデータがありません');
        }

        console.log(`✅ ${racesData.data.length}会場のデータを取得しました`);

        // 今日の日付を取得
        const today = getTodayDateJST();
        console.log(`📅 予想生成日: ${today}`);

        // 全レースの予想を生成
        const allPredictions = [];
        let totalRaces = 0;

        // 全選手IDを収集して racer_aggregated_stats を一括取得
        const allRacerIds = new Set();
        for (const venue of racesData.data) {
            if (!venue.races) continue;
            for (const race of venue.races) {
                if (!race.racers) continue;
                for (const racer of race.racers) {
                    if (racer.racerId) allRacerIds.add(racer.racerId);
                }
            }
        }
        const racerStatsMap = await fetchRacerStats([...allRacerIds]);
        if (racerStatsMap.size > 0) {
            console.log(`📊 ${racerStatsMap.size}人の選手統計を取得しました`);
        }

        for (const venue of racesData.data) {
            console.log(`\n📍 ${venue.placeName} (${venue.placeCd})`);

            if (!venue.races || venue.races.length === 0) {
                console.log('  ⚠️  レースデータなし');
                continue;
            }

            for (const race of venue.races) {
                // レースデータに場所情報を追加
                race.placeName = venue.placeName;
                race.placeCd = venue.placeCd;

                const prediction = generateRacePrediction(race, today, racerStatsMap);

                if (prediction) {
                    allPredictions.push(prediction);
                    totalRaces++;
                    console.log(`  ✅ ${race.raceNo}R - 本命: ${prediction.prediction.topPick}号艇 (信頼度: ${prediction.prediction.confidence}%)`);
                } else {
                    console.log(`  ❌ ${race.raceNo}R - 予想生成失敗`);
                }
            }
        }

        console.log(`\n📊 合計 ${totalRaces}レースの予想を生成しました`);

        // Supabaseに書き込み
        await writeToSupabase(allPredictions, today);

        console.log('✨ 予想生成が完了しました！');

    } catch (error) {
        console.error('❌ エラーが発生しました:', error);
        process.exit(1);
    }
}

// スクリプト実行
const args = process.argv.slice(2);
const isRefresh = args.includes('--refresh');
const isDryRun = args.includes('--dry-run');
const raceIdsArg = args.find((a) => a.startsWith('--race-ids='));
const specificRaceIds = raceIdsArg ? raceIdsArg.split('=')[1].split(',') : null;

if (isRefresh) {
    mainRefresh({ isDryRun, specificRaceIds }).catch((error) => {
        console.error('❌ エラー:', error);
        process.exit(1);
    });
} else {
    main();
}
