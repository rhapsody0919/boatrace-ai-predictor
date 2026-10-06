SELECT source, count(*), min(race_date), max(race_date) FROM pool GROUP BY source;
