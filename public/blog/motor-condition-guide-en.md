# What Is Motor Condition? A New Way to See Today's 2nd-Place Rate by Lane

We've added a new "Motor Condition" feature to BoatAI. Rather than a generic list of "motors that are running well," we designed this to be **directly usable for the race you're actually about to bet on today**. Here's what this feature shows and how to use it.

---

## Knowing the motor number alone isn't useful

When we first set out to build a way to check motor condition, our initial design was a simple ranking of every motor at a venue by its 2nd-place-or-better finish rate. But that design fell short: knowing that "motor #31 is performing well" tells you nothing useful **if that motor isn't even racing today**.

Thinking about how people actually bet on boat races, what they need to know isn't "how is this motor performing in general" — it's "in the race I'm looking at right now, which boat's motor is performing well." We redesigned the feature around that.

---

## What you can learn from Motor Condition

You can check it on the "🔧 Motor Condition" tab of the [`/winning-technique`](/winning-technique?tab=motor) page.

**Select a race happening today, and you'll see the 2nd-place-or-better rate and 3rd-place-or-better rate for the motors on all 6 boats actually racing.** The boat with the highest 2nd-place rate is highlighted, so you can tell at a glance which boat's motor is running best in that specific race.

![Motor condition screen. Selecting today's race shows lane, racer name, motor number, 2nd-place rate, and 3rd-place rate for all 6 boats, with the top boat highlighted](/images/blog/motor-condition-table.jpg)

In the example image above, lane 5's motor (#19) stands out clearly above the rest with a 48.00% 2nd-place rate and 64.00% 3rd-place rate, highlighted in yellow.

---

## How to use it

1. Open the [`/winning-technique`](/winning-technique?tab=motor) page and select the "Motor Condition" tab
2. Choose a venue holding races today (venues with no races today won't appear as options)
3. Choose a race number
4. Lane, racer name, motor number, 2nd-place rate, and 3rd-place rate appear for all 6 boats, with the top boat highlighted
5. Click a row for a motor you're curious about to switch to a trend chart showing that motor's performance across race meets

---

## How to use it strategically

### Spot a boat that clearly stands out

A boat whose 2nd- and 3rd-place rates are clearly higher than the rest may have a real motor advantage. Checking the second-highest boat in addition to the highlighted one gives you more to work with.

### Read the momentum from the trend chart

Clicking a row opens a trend chart showing how that motor has changed across race meets. A motor on an upward trend may be a sign that maintenance or a parts swap has improved its performance. A motor on a downward trend is a reason to discount it somewhat, even if the racer's skill is strong.

### Combine it with winning-technique data

Combining this with the "Winning-Technique Analysis" feature gives you even more to go on. For example, if lane 4 tends to win by overtaking at a given venue, and lane 4's motor today has the best 2nd-place rate in the race, that's two independent signals pointing toward the same pick.

---

## FAQ

### Should I focus on the 2nd-place rate or the 3rd-place rate?

The 2nd-place rate is "the share of races finishing 2nd or better," and the 3rd-place rate is "the share finishing 3rd or better." For bets targeting the top 1–2 finishers, like Win or Quinella, lean on the 2nd-place rate. For bets involving 3rd place, like Trifecta or Trio, the 3rd-place rate is more useful.

### When do the motor numbers get updated?

Motor 2nd- and 3rd-place rates update per **race meet**, not per individual race. The same numbers hold throughout a meet and only change when the next meet begins — which is why the trend chart looks stair-stepped.

### Does this work for every venue?

The `races` table only contains data for races held that day, so the venue options on the Motor Condition tab are limited to **venues actually holding races today**. Venues with no races scheduled won't appear as options.

---

## Summary

- **Motor Condition** is a new feature that shows motor 2nd- and 3rd-place rates by lane for today's races, with just a race selection
- Instead of an abstract ranking, it's designed to be directly usable for your actual betting decisions
- Click through for a trend chart showing performance across race meets

This data is for reference only — please don't base your bet selection on it alone. It reflects statistical tendencies and does not guarantee future outcomes. Always make your own analysis and judgment before placing a bet.

BoatAI will keep expanding its data tools so you can "think and decide for yourself," not just rely on predictions.
