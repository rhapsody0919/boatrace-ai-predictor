# Ryujin Radar Passes 10,000 Races — What the Data Says About AI Prediction's Strengths and Limits

## Introduction

Ryujin Radar's cumulative analyzed race count has **passed 10,000 races**.

Many AI prediction services exist, but very few **publish their entire track record beyond 10,000 races**. This article honestly shares what 10,000 races of data reveal about AI prediction's "strengths" and "limits."

---

## Cumulative results summary

| Model | Races | Win hit rate | Win return rate | Trio hit rate | Trio return rate |
|--------|---------|-----------|-----------|-----------|-----------|
| Standard | **12,324** | **47.4%** | **85.9%** | **18.0%** | **73.5%** |
| Favorite-focused | 10,020 | 36.1% | 84.8% | 14.3% | 71.5% |
| Longshot | 10,020 | 25.2% | 81.4% | 9.5% | 69.2% |

These numbers are based on **a total of 32,364 predictions**.

---

## AI prediction's "strengths" — the good news

### 1. What a 47.4% Win hit rate means

Boat racing has 6 boats per race. A random pick has roughly a 16.7% (1/6) chance of hitting.

Ryujin Radar's standard model hits **47.4%**. That means:

- About **2.8x** the accuracy of a random pick
- The favorite wins roughly **1 out of every 2 races**
- Since this is measured across 12,324 races, it's not a fluke

### 2. Place hit rate is around 70%

The standard model's Place (top-2 finish) hit rate is about 70%. That works out to **the favorite finishing top 2 in 7 out of every 10 races**.

This is evidence that the AI's predictions aren't off base. Even when it misses 1st place, the pick often still lands in 2nd.

### 3. Trio hit rate of 18.0%, and Trifecta accuracy

A Trio bet requires picking the top 3 boats regardless of order. Its probability is 1/20 (5%).

Ryujin Radar's standard model hits **18.0%** (about once every 5.5 races) — roughly **3.6x** better than random.

| Model | Trio hit rate | vs. random |
|--------|-----------|----------|
| Standard | 18.0% | **~3.6x** |
| Favorite-focused | 14.3% | ~2.9x |
| Longshot | 9.5% | ~1.9x |

Even for **Trifecta**, which requires the exact finishing order (probability 1/120), the standard model achieves **5.9%** — about **7.1x** better than random.

![Hit rate vs. random chance across 10,000+ races. Win 47.4% (~3x), Trio 18.0% (~3.6x), Trifecta 5.9% (~7.1x), compared by bet type](/images/blog/10000-races-hitrate-en.jpg)

### 4. Broken down by venue, a return rate above 100% shows up often

While the overall monthly and average return rates fall below 100%, breaking things down **by venue × model × bet type** reveals many conditions that exceed a 100% return rate.

From December 2025's results:
- Ashiya × Standard × Trifecta = **1,258.9%**
- Hamanako × Longshot × Trifecta = **515.0%**
- Marugame × Longshot × Trifecta = **382.4%**

**Rather than betting evenly across all 24 venues, focusing on venues where the AI performs well** matters.

---

## AI prediction's "limits" — the honest part

### 1. Overall return rate is below 100%

| Model | Win return rate | Trio return rate |
|--------|----------|-----------|
| Standard | 85.9% | 73.5% |
| Favorite-focused | 84.8% | 71.5% |
| Longshot | 81.4% | 69.2% |

**Every model's return rate, betting flatly across all races, falls between 69% and 86%.**

What does that mean? **Betting ¥100 flatly on every race would, over the long run, mean losing about 15% of your total wager.**

### 2. Why the return rate falls below 100%

Boat racing's deduction rate is around 25% — meaning a ¥100 bet returns an average of only ¥75.

Ryujin Radar's 85.9% Win return rate clears "part of" that deduction wall, but doesn't fully break through it.

```
Random (expected value): ~75%
Ryujin Radar Standard:         85.9%  ← +10.9% improvement
Ryujin Radar Favorite-focused: 84.8%  ← +9.8% improvement
Break-even point:        100%
```

### 3. No such thing as an "AI that always wins"

This is a firm statement: **no AI, applied across every single race, can reliably maintain a return rate above 100%**.

Why:
- Boat racing has many **real-time variables** — start timing, wind direction, water conditions
- AI can only analyze the data available before the race starts
- Odds already reflect the collective knowledge of every market participant

---

## So how should you actually use it?

### Strategy 1: Focus on specific venues

Instead of betting across all 24 venues, **concentrate on the venues where the AI performs best**.

Ryujin Radar has custom analysis rules built for 7 venues, and accuracy tends to be higher at these venues.

### Strategy 2: Filter by condition

Ryujin Radar's predictions include a "confidence" score. **Narrowing down to high-confidence predictions** improves both hit rate and return rate.

### Strategy 3: Use different bet types strategically

- **For stability**: The standard model's Place bet (~70% hit rate)
- **For return rate**: The favorite-focused model's Win bet (91.1% return rate as of January 2026)
- **For a big swing**: The standard model's Trio (18.0% hit rate) or Trifecta (100%+ common at specific venues)

### Strategy 4: Manage your bankroll strictly

AI prediction is ultimately **a reference tool**. Always follow these rules:

- Decide your daily budget in advance
- Don't chase your losses with additional bets
- Never dip into your living expenses
- Also check the [Responsible Gambling](/responsible-gambling) page

---

## Looking ahead

### Continuous model improvement

Ryujin Radar analyzes new data every month to keep improving its models.

- **Expanding venue-specific rules**: Currently 7 venues → targeting all 24
- **Factoring in seasonal effects**: Analyzing the relationship between temperature, wind speed, and motor performance
- **Leveraging real-time data**: Exploring how to incorporate start-exhibition data

### Toward 20,000 races

The next milestone is 20,000 races. As data accumulates, the AI's analysis accuracy improves. We'll keep publishing the full track record as we continue improving.

---

## Data transparency

### About the numbers in this report

- Every number matches the data published on Ryujin Radar's [accuracy page](/accuracy)
- Good and bad numbers alike are published without exception
- Calculated using a flat ¥100 bet per race (no bias in bet sizing)

### "Can I really trust this?"

Ryujin Radar publishes its predictions **in advance**, and checks the results only after the fact. There's no after-the-fact editing whatsoever. Every prediction can be verified retroactively in the [race history](/races).

---

## Summary

1. **Across over 10,000 races, Win hit rate is 47.4%** (~2.8x random)
2. **Trio hit rate is 18.0%** (~3.6x random), **and Trifecta hits 5.9%** (~7.1x random)
3. **Return rate falls below 100%** at 85.9% for Win and 73.5% for Trio — betting flatly on every race doesn't win
4. **Narrowing to specific venues or conditions can easily push return rate above 100%** (e.g., 1,258.9% for Ashiya Trifecta in December)
5. AI prediction isn't infallible. **Best used as a reference, combined with your own judgment.**

**Ryujin Radar builds trust by publishing everything.**

---

**Tags:** #RyujinRadar #10000Races #AIPrediction #TrackRecordAnalysis #HitRate #ReturnRate #DataDisclosure #BoatRacing
