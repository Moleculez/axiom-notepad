import { expect, it } from "vitest";
import pg from "pg";
import "../packages/shared/src/db";

it("keeps PostgreSQL calendar dates unchanged through JSON round trips", () => {
  const parse = pg.types.getTypeParser(pg.types.builtins.DATE);
  for (const day of ["2026-12-12", "2028-02-29", "2026-01-01"])
    expect(JSON.parse(JSON.stringify({ dueOn: parse(day) })).dueOn).toBe(day);
});
