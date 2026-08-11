# How to Use "Today's Picks" — High-Return Races Selected by Data Mining

## Introduction

"Which race should I bet on today?"

Boat racing runs up to 144 races a day (24 venues × 12 races). Finding the races with a genuinely good expected return among all of those is extremely difficult.

BoatAI's "**Today's Picks**" automatically surfaces only the races that match **patterns proven to exceed a 100% return rate**, discovered by mining a massive amount of past race data.

---

## What is "Today's Picks"?

### In a nutshell

It's a feature that **checks whether today's races match a "winning pattern" that has historically exceeded a 100% return rate**.

### How it differs from standard AI predictions

| | Standard AI predictions | Today's Picks |
|---|---|---|
| Coverage | Every race | Only races matching a pattern |
| Goal | Predict finishing order | Find races meeting proven over-100%-return conditions |
| Display | Score and ranking | Comes with a specific bet type (Win/Place/Trio/Trifecta) |
| Race count | 100+ daily | A curated handful |

In other words, rather than "the AI predicting every race," the approach is to **curate only the races where the statistical expected value is positive**.

---

## How to read the screen

### 1. Track record

The top of the page shows this feature's **cumulative track record**.

- **Amount wagered**: The total if you'd bet ¥100 on every recommended race
- **Amount returned**: The total payout from the races that hit
- **Return rate**: Returned ÷ Wagered × 100 (100%+ means a profit)

This updates in real time, so you can always check the feature's reliability for yourself.

### 2. Featured races

Races matching patterns with **an especially strong track record and high return rate** appear at the top as "Featured Races."

Display criteria:
- At least 10 past races applying this pattern
- A return rate above 100%

If you're not sure where to start, checking the Featured Races first is a good idea.

### 3. List by venue

All recommended races are shown grouped by venue in an accordion layout.

What each card shows:
- **Venue, race number, and post time**
- **Bet type**: Win / Place / Trio / Trifecta
- **Prediction**: The AI's recommended boat number(s) (e.g., lane 1, or 1-3-5)
- **Result**: Shown as hit/miss once the race finishes

Tapping a card takes you to that race's detailed prediction page.

---

## Bet types

Recommended races come with the optimal bet type for that particular pattern.

| Bet type | What it means | Character |
|--------|------|------|
| **Win** | Pick the 1st-place finisher | High hit rate, beginner-friendly |
| **Place** | Pick a boat finishing 1st or 2nd | The most conservative option |
| **Trio** | Pick the top 3 finishers, any order | Mid-range payouts |
| **Trifecta** | Pick the top 3 finishers in exact order | High payout, low hit rate |

"A pattern with a high return rate for Win bets" and "a pattern with a high return rate for Trifecta bets" are completely different things. BoatAI mines the optimal pattern separately for each bet type.

---

## How are these patterns found?

### The data mining process

1. **Data collection**: Accumulate historical race data from all 24 venues
2. **Condition search**: Statistically search for combinations of conditions where the return rate exceeds 100%
3. **Validation**: Check the reliability of each discovered pattern (is the sample size large enough?)
4. **Selection**: Only adopt patterns with a sample size of 10+ and a return rate above 100%

### Example patterns (illustrative)

- "At Venue X, betting Place when the AI's confidence is above a certain threshold yields a 120% return rate"
- "At Venue Y, betting Win on a lane-1 prediction under a specific condition yields a 110% return rate"

Patterns differ by venue. They capture each venue's own "quirks" — water conditions, lane advantages, and racer tendencies.

### Current scale

- Covers **15 venues**
- **34 active patterns** (12 Win + 10 Place + 3 Trio + 9 Trifecta)

---

## How to use it effectively

### For beginners: start with Win/Place in Featured Races

1. Check the "Featured Races" section
2. Pick a Win or Place card
3. Bet on the specified boat number

Win and Place bets have a high hit rate, making them the best way to first get a feel for "winning."

### For intermediate bettors: focus on Trio at specific venues

1. Expand the list by venue
2. Check the recommendations for venues you already follow closely
3. Bet on the recommended Trio combination

When your own venue expertise overlaps with the AI's recommendation, you get a sharper read.

### For advanced bettors: target Trifecta for a high return

1. Check the Trifecta cards
2. Compare against the odds to calculate expected value
3. Allocate your bankroll thoughtfully before betting

Trifecta has a lower hit rate, but a much bigger potential payout when it lands.

---

## Things to keep in mind

- **Not every pick hits**. A return rate above 100% means "profitable over the long run," not "guaranteed to win"
- Patterns reflect statistical tendencies — individual races can still miss
- Track record is always visible at the top of the page, so make your call with the actual results in view
- Betting is entirely at your own risk

---

## Summary

"Today's Picks" is one of the features BoatAI invests the most in.

- Automatically discovers **statistically favorable conditions** from historical data
- Scans daily races across **15 venues and 34 patterns**
- Highlights **Featured Races** with especially strong reliability
- Publishes its **track record** in real time for full transparency

Instead of betting blindly on every race, **narrow your focus to the conditions the data shows are winnable** — this is the most rational way to raise your return rate.

👉 [Check Today's Picks](/picks)
