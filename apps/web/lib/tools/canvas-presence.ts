type State = {
  canvasSizing?: { writable?: boolean; activeCard?: string | null };
};
export function canvasSizingSnapshot(states: Iterable<[number, State]>) {
  const writers = [...states]
    .filter(([, state]) => state.canvasSizing?.writable)
    .sort(([a], [b]) => a - b);
  const owners = new Map<string, number>();
  for (const [id, state] of writers) {
    const card = state.canvasSizing?.activeCard;
    if (card && !owners.has(card)) owners.set(card, id);
  }
  return {
    key: JSON.stringify(
      writers.map(([id, state]) => [
        id,
        state.canvasSizing?.activeCard ?? null,
      ]),
    ),
    fallback: writers[0]?.[0] ?? null,
    owners,
  };
}
