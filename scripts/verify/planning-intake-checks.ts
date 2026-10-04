import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { IntakePage } from "../../packages/shared/src/planning-intake";
type Call = (
  path: string,
  method?: string,
  body?: any,
  user?: string,
) => Promise<any>;

/** Only called by the disposable planning verifier, never by the working app. */
export async function verifyIntakePagination(
  db: pg.Client,
  call: Call,
  space: string,
  owner: string,
  author: string,
  viewer: string,
  outsider: string,
) {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/axiom_planning_test_/,
  );
  const base = `spaces/${space}/intake`,
    prefix = `Paged lab ${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO planning_intake(space_id,created_by,kind,title,body,status,decision_note,reviewed_by,created_at,updated_at)
    SELECT $1,CASE WHEN n%2=0 THEN $2 ELSE $3 END,CASE WHEN n%2=0 THEN 'research' ELSE 'experiment' END,
    $4::text||' '||lpad(n::text,4,'0'),repeat('Private source evidence ',100),
    (ARRAY['pending','needs-changes','accepted','rejected','withdrawn'])[1+n%5],
    CASE WHEN n%5>=2 THEN 'Decision archive evidence' ELSE '' END,$2,
    now()-interval '1 hour'+(n/20)*interval '1 second'+((n%20)/10)*interval '1 microsecond',now()
    FROM generate_series(1,1250) n`,
    [space, owner, author, prefix],
  );
  const q = `q=${encodeURIComponent(prefix)}&limit=37`;
  const first: IntakePage = await call(`${base}?${q}`);
  assert.equal(first.total, 1250);
  assert.equal(first.items.length, 37);
  assert(Object.values(first.statusCounts).every((count) => count === 250));
  assert(!("body" in first.items[0]));
  const summaryBytes = Buffer.byteLength(JSON.stringify(first)),
    fullBytes = Buffer.byteLength(
      JSON.stringify({
        ...first,
        items: first.items.map((item) => ({
          ...item,
          body: "Private source evidence ".repeat(100),
        })),
      }),
    );
  assert(summaryBytes < fullBytes / 2);
  assert(first.canReview);
  assert(first.nextCursor);
  const detail = await call(`${base}/${first.items[0].id}`);
  assert.equal(detail.item.body, "Private source evidence ".repeat(100));
  assert.equal(detail.item.id, first.items[0].id);
  // No stale offset shift from an incoming request; edited rows keep their original position.
  await call(base, "POST", {
    kind: "research",
    title: prefix + " NEW SUBMISSION",
  });
  await db.query(
    "UPDATE planning_intake SET updated_at=now(),version=version+1 WHERE id=$1",
    [first.items[0].id],
  );
  const expected = (
    await db.query(
      "SELECT id FROM planning_intake WHERE space_id=$1 AND title LIKE $2 AND created_at<=$3 ORDER BY created_at DESC,id DESC",
      [space, prefix + "%", first.asOf],
    )
  ).rows.map((r) => r.id);
  const seen = first.items.map((r) => r.id);
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page: IntakePage = await call(
      `${base}?${q}&cursor=${encodeURIComponent(cursor)}`,
    );
    assert.equal(page.asOf, first.asOf);
    assert.equal(page.total, 1250);
    assert(page.items.length <= 37);
    seen.push(...page.items.map((r) => r.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, 1250);
  assert.equal((await call(`${base}?${q}`)).total, 1251);
  const open = await call(`${base}?${q}&filter=open`),
    closed = await call(`${base}?${q}&filter=history`);
  assert.equal(open.total, 501);
  assert(
    open.items.every((r: any) =>
      ["pending", "needs-changes"].includes(r.status),
    ),
  );
  assert.equal(closed.total, 750);
  assert(
    closed.items.every((r: any) =>
      ["accepted", "rejected", "withdrawn"].includes(r.status),
    ),
  );
  assert.equal((await call(`${base}?${q}&mine=1`)).total, 626);
  assert.equal(
    (await call(`${base}?${q}&mine=1`, "GET", undefined, author)).total,
    625,
  );
  assert.equal((await call(`${base}?${q}&kind=experiment`)).total, 625);
  const oldest = await call(`${base}?${q}&sort=oldest`);
  const oldestNext = await call(
    `${base}?${q}&sort=oldest&cursor=${encodeURIComponent(oldest.nextCursor)}`,
  );
  assert.deepEqual(
    [...oldest.items, ...oldestNext.items].map((r: any) => r.id),
    (
      await db.query(
        "SELECT id FROM planning_intake WHERE space_id=$1 AND title LIKE $2 ORDER BY created_at,id LIMIT 74",
        [space, prefix + "%"],
      )
    ).rows.map((r) => r.id),
  );
  for (const extra of [
    "filter=open",
    "mine=1",
    "limit=30",
    "sort=oldest",
    "kind=experiment",
    "q=wrong",
  ])
    await assert.rejects(
      call(
        `${base}?${q}&${extra}&cursor=${encodeURIComponent(first.nextCursor!)}`,
      ),
    );
  await assert.rejects(
    call(
      `${base}?${q}&cursor=${encodeURIComponent(first.nextCursor!)}`,
      "GET",
      undefined,
      author,
    ),
  );
  await assert.rejects(call(`${base}?limit=101`));
  await assert.rejects(call(`${base}?cursor=bad`));
  await assert.rejects(call(`${base}/${randomUUID()}`));
  await assert.rejects(
    call(`${base}/${first.items[0].id}`, "GET", undefined, outsider),
  );
  const view = await call(`${base}?${q}`, "GET", undefined, viewer);
  assert.equal(view.canReview, false);
  assert.equal(
    (await call(`${base}/${first.items[0].id}`, "GET", undefined, viewer))
      .canReview,
    false,
  );
  const literal = await call(base, "POST", {
    title: "Literal 100%_\\ marker",
    kind: "research",
  });
  const match = await call(`${base}?q=${encodeURIComponent("100%_\\")}`);
  assert.deepEqual(
    match.items.map((r: any) => r.id),
    [literal.id],
  );
  const accepted = await call(`${base}?${q}&filter=accepted`);
  assert.equal(accepted.total, 250);
  // Removing membership invalidates both subsequent positions and full-body reads.
  const authorPage = await call(`${base}?${q}`, "GET", undefined, author);
  await db.query(
    "DELETE FROM members WHERE user_id=$1 AND group_id=(SELECT group_id FROM spaces WHERE id=$2)",
    [author, space],
  );
  await assert.rejects(
    call(
      `${base}?${q}&cursor=${encodeURIComponent(authorPage.nextCursor)}`,
      "GET",
      undefined,
      author,
    ),
  );
  await assert.rejects(
    call(`${base}/${first.items[0].id}`, "GET", undefined, author),
  );
  console.log(
    "Intake: 1,250 tied/microsecond positions, concurrent creation/edit, literal filters, exact counts, scoped detail and revocation passed.",
  );
  console.log(
    `Intake payload: ${summaryBytes} bytes for 37 summaries vs ${fullBytes} bytes including the same saved bodies.`,
  );
}
