/** 今節の部品交換。日付順に部品を並べ、プロペラは含めない。 */
export function countMeetPartsChanges(events, { from, to }) {
  if (!Array.isArray(events)) return { count: 0, parts: [] };
  const parts = events
    .filter((event) => event.date >= from && event.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((event) => event.parts ?? []);
  return { count: parts.length, parts };
}
