# What Is Winning-Technique Analysis? A New Way to See Win Patterns by Venue and Lane

We've added a new "Winning-Technique Analysis" feature to BoatAI. Rather than just taking the AI's predictions at face value, this is a data tool for **anyone who wants to check the data themselves and make their own call**. Here's what this feature shows and how to use it during an actual race.

---

## Why we built this feature

BoatAI has focused mainly on providing AI-generated predictions so far, but we've shifted direction toward building out data tools that let **users form their own judgment backed by evidence**, rather than relying purely on prediction accuracy. Winning-Technique Analysis is the first feature in that direction.

---

## What you can learn from Winning-Technique Analysis

You can check it on the "🎯 Technique" tab of the [`/winning-technique`](/winning-technique?tab=technique) page.

Using race results from the past 90 days, it aggregates and displays **which winning technique (Nige/wire-to-wire, Sashi/inside pass, Makuri/outside overtake, Makuri-zashi/overtake-and-pass, Nuki/slip-through, Megumare/lucky win) led to a 1st-place finish, broken down by venue and starting lane**.

For example, you can instantly see patterns like "at this venue, lane 1 wins mostly by wire-to-wire" or "lane 4 often wins by overtaking" — venue-specific water and course tendencies made visible at a glance.

![Winning-technique analysis screen showing a stacked bar chart of technique composition by lane at a given venue](/images/blog/winning-technique-chart.jpg)

The image above is an example from Edogawa. Lane 1 wins almost 100% by "Nige" (wire-to-wire), while lanes 5 and 6 show a much higher share of "Makuri-zashi" and "Sashi." This pattern varies significantly by venue.

---

## How to use it

1. Open the [`/winning-technique`](/winning-technique?tab=technique) page and select the "Technique" tab
2. Choose a boat racing venue
3. The winning-technique composition by lane appears as a stacked bar chart and table
4. The table below the chart also shows the technique, count, and share for each lane in detail

---

## How to use it strategically

### Spot venues where wire-to-wire from the inside is strong

At venues where lane 1's "Nige" (wire-to-wire) share is unusually high, building your bets around the inside lane as your core pick is often an effective strategy.

### Spot venues prone to upsets

Conversely, at venues with a high share of "Makuri" or "Makuri-zashi" from the outside lanes (4–6), wire-to-wire wins from the inside are less reliable and upsets are more common. At these venues, it's worth considering bets that target an inside pass or an outside overtake.

### Use it to identify lanes that rarely win

Since the technique tally only covers boats that finished 1st, it also works in reverse — as a basis for excluding a lane that rarely wins by any of the tracked techniques.

---

## FAQ

### Why does it use 90 days of data?

Water conditions change with the seasons, so including data that's too old risks not matching current tendencies. On the other hand, too short a window doesn't leave enough sample size. 90 days was chosen to balance these two concerns.

### What does "Megumare" (lucky win) mean?

It refers to a case where a boat that wasn't directly involved in a head-to-head battle between other boats ends up finishing 1st as those other boats compete against each other. Because it results from factors other than raw ability or race development, a lane with a high share of this technique isn't necessarily reproducible — treat it with caution.

### Why do tendencies differ so much by venue?

Boat racing venues differ in water surface area, water type (fresh or salt water), and the distance from the start line to the first turn, among other structural factors. These differences in course structure are what drive the differences in how easily an inside wire-to-wire wins, or how well an outside overtake works.

---

## Summary

- **Winning-Technique Analysis** is a new feature that shows winning-technique tendencies by venue and lane based on the past 90 days of data
- It helps you identify venues where an inside wire-to-wire is strong, and venues where outside lanes have a real shot
- Use it as supporting evidence for the AI's predictions, or as a basis for excluding certain lanes

This data is for reference only — please don't base your bet selection on it alone. It reflects statistical tendencies and does not guarantee future outcomes. Always make your own analysis and judgment before placing a bet.

BoatAI will keep expanding its data tools so you can "think and decide for yourself," not just rely on predictions.
