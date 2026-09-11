/** Deterministic, ephemeral ownership. Readers never publish derived geometry. */
export function canvasSizingOwner(
  states: Iterable<
    [
      number,
      { canvasSizing?: { writable?: boolean; activeCard?: string | null } },
    ]
  >,
  cardId: string,
): number | null {
  const writers = [...states].filter(
    ([, state]) => state.canvasSizing?.writable,
  );
  const active = writers.filter(
    ([, state]) => state.canvasSizing?.activeCard === cardId,
  );
  const eligible = active.length ? active : writers;
  return eligible.length ? Math.min(...eligible.map(([id]) => id)) : null;
}
