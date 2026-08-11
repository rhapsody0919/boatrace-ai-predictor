# Is BoatAI's Track Record Real? A Full Breakdown of How We Measure It and Why It's Transparent

"49.5% hit rate." "134.3% return rate."

These are the numbers displayed on BoatAI's homepage. Many of you are probably wondering, **can I actually trust these?**

Let's be honest: **being skeptical is the right call.**

The internet is full of sketchy prediction sites claiming "90% hit rate!" or "guaranteed ¥1,000,000 a month!" Plenty of them charge steep membership fees while showing you numbers with no real basis behind them.

That's exactly why BoatAI **publishes its entire track record, in full**.

This article breaks down exactly how BoatAI measures its track record, and why it publishes every bit of the data.

---

## Why we publish our entire track record

### BoatAI was born out of frustration with expensive prediction sites

I'm the developer of BoatAI, and I used to be a paying member of a prediction site that cost ¥30,000 a month.

It claimed to offer "predictions from a pro," but never disclosed its hit rate or return rate. It loudly advertised its wins and stayed silent about its losses. I paid tens of thousands of yen to a site like that.

The result? **A crushing loss.**

That experience is what drove me to build BoatAI around one belief: if you're going to offer predictions, you should publish your entire track record.

### We don't cherry-pick favorable numbers

Many prediction sites only publish "the races that hit" as their track record.

- "Hit a ¥100,000 Trifecta!" → doesn't mention the 20 misses before it
- "200% monthly return rate!" → the measurement period and race scope are unclear

BoatAI is different. **We publish every race, hits and misses alike.**

---

## How we measure our track record

### 1. Which races count

**Every race** BoatAI has published a prediction for counts.

- We never selectively measure only certain races
- We never arbitrarily filter down to "only high-confidence races"
- The moment a prediction is published, that race is automatically included in the tally

### 2. How a "hit" is defined

#### Place hit rate
Counted as a hit if the AI's top pick finishes **2nd or better**.

```
Place hit rate = (races where the favorite finished top 2) ÷ (total races) × 100
```

#### Trio hit rate
Counted as a hit if the AI's recommended combination(s) include **the actual top-3 boats, in any order**.

```
Trio hit rate = (races where the Trio bet hit) ÷ (total races) × 100
```

#### Trifecta hit rate
Counted as a hit if the AI's recommended combination(s) include **the actual 1st-2nd-3rd finish, in exact order**.

```
Trifecta hit rate = (races where the Trifecta bet hit) ÷ (total races) × 100
```

### 3. How return rate is calculated

Return rate measures "how much came back relative to what was wagered."

```
Return rate = (total payout) ÷ (total amount wagered) × 100
```

#### A concrete example

| Race | Wagered | Result | Payout |
|--------|--------|------|--------|
| Race 1 | ¥1,000 | Hit | ¥3,500 |
| Race 2 | ¥1,000 | Miss | ¥0 |
| Race 3 | ¥1,000 | Miss | ¥0 |
| Race 4 | ¥1,000 | Hit | ¥2,200 |
| Race 5 | ¥1,000 | Miss | ¥0 |
| **Total** | **¥5,000** | - | **¥5,700** |

Return rate in this case:
```
¥5,700 ÷ ¥5,000 × 100 = 114%
```

**A return rate above 100%** means more came back than was wagered — i.e., a net-positive result.

### 4. The assumption behind the wager amount

BoatAI's return rate calculation assumes **¥100 per combination**.

For example, if the recommended Trifecta bet has 10 combinations:
- Amount wagered: ¥100 × 10 combinations = ¥1,000
- Payout: the odds at the time of the hit × ¥100

Keeping this assumption consistent makes it possible to compare across races.

---

## What each metric means, and what to expect

### Which matters more — hit rate or return rate?

**Conclusion: return rate matters more.**

A high hit rate is meaningless if the return rate is low.

| Pattern | Hit rate | Return rate | Result |
|----------|--------|--------|------|
| A | 50% | 80% | Net loss |
| B | 30% | 120% | **Net gain** |
| C | 10% | 150% | **Net gain** |

Pattern A hits half the time, but the odds are so low the return rate is only 80% — meaning ¥10,000 wagered only comes back as ¥8,000.

Pattern C, meanwhile, hits only 10% of the time, but the return rate is 150% — ¥10,000 wagered becomes ¥15,000.

### The numbers BoatAI targets

| Metric | Target | Current track record |
|------|------|-----------|
| Place hit rate | 45%+ | 49.5% |
| Place return rate | 80%+ | 85.3% |
| Trio hit rate | 10%+ | 12.8% |
| Trifecta return rate | 100%+ | 134.3% |

**Maintaining a Trifecta return rate above 100%** is our single most important goal.

---

## Why you can trust BoatAI's numbers

### 1. Every race's data is published

BoatAI's "Accuracy" page shows day-by-day hit rate and return rate, in full.

- Good days and bad days alike, published without exception
- Results are also broken down by model (Standard, Favorite-focused, Longshot)
- Past predictions and their results can be checked on the "Race History" page

### 2. Predictions are published in advance

BoatAI's predictions are published **before the race starts**.

- There's no way to claim "actually, it hit" after the fact
- The publish time is recorded
- Anyone can check the prediction in real time

### 3. Results are tallied automatically

Once a race result comes in, the system automatically judges hits and tallies the numbers.

- No room for a human to manually manipulate the numbers
- Odds data comes from the official source
- This prevents calculation errors or intentional tampering

### 4. Open-source code (planned)

We plan to eventually publish the tallying logic's code on GitHub.

If you're wondering "is it really calculated this way?", you'll be able to check the code yourself for the answer.

---

## How BoatAI differs from other prediction sites

| Item | BoatAI | Typical prediction sites |
|------|--------|-------------------|
| Price | **Completely free** | ¥thousands–¥tens of thousands/month |
| Publishes track record for every race | **Yes** | No |
| Publishes hits and misses alike | **Yes** | Only advertises hits |
| Basis for predictions | **Publishes the AI score** | A black box |
| Explains its measurement method | **Published in this article** | Not disclosed |

---

## FAQ

### Q. Is the 134% return rate real?

**A. Yes, it's real.** That said, this figure is as of December 2025.

Boat racing has an element of luck, so numbers fluctuate in the short term. Our goal is to maintain a return rate above 100% over the long run.

### Q. Are you hiding past bad results?

**A. No, we don't hide anything.** The "Accuracy" page shows every day's past data, in full.

Days where the return rate dropped below 50% are published without exception too.

### Q. Can I verify this myself?

**A. Yes, you can.**

1. Check BoatAI's predictions every day
2. Compare them against the actual race results
3. Calculate the hit rate and return rate yourself

Some users have actually done this verification themselves. If you're skeptical, we genuinely encourage you to check it for yourself.

---

## Summary

BoatAI measures and publishes its track record according to these principles:

1. **Every race counts**: we never cherry-pick favorable races
2. **Hits and misses alike are published**: we don't only advertise our wins
3. **The measurement method is disclosed**: we explain exactly how the numbers are calculated
4. **Automated tallying**: a system no human can manually manipulate
5. **Verifiable by anyone**: both predictions and results are fully public

Rather than "it's free, so who cares," we're committed to proving "free, but genuinely real."

If you have doubts about BoatAI's track record, we genuinely encourage you to verify it yourself. And once you're convinced, we hope you'll put our predictions to use.

---

**Tags:** #BoatAI #TrackRecord #Transparency #HitRate #ReturnRate #DataDisclosure #Verification
