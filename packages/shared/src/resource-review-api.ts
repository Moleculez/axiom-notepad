import { z } from "zod";
import { query } from "./db";
import { resourceAccess, HttpError } from "./access";
import { readResourceRevision } from "./revision-api";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertRevision,
  deliverEvent,
} from "./workspace-service";
import { lockRevisionResource, revisionAudit } from "./revision-audit";
import { notifyWorkspace } from "./documents";
export async function resourceReviewApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (endpoint === "reviews" && id === "inbox" && request.method === "GET") {
    const requests = await query(
      'SELECT q.*,r.name AS title,r.id AS resource_id,u.name AS reviewer,a.name AS requester,coalesce((SELECT name FROM projects WHERE id=s.project_id),(SELECT name FROM groups WHERE id=s.group_id),$$Personal space$$) AS space FROM review_requests q JOIN resources r ON r.id=coalesce(q.resource_id,q.note_id) JOIN spaces s ON s.id=r.space_id JOIN "user" u ON u.id=q.reviewer_id JOIN "user" a ON a.id=q.requested_by WHERE (q.reviewer_id=$1 OR q.requested_by=$1) AND r.deleted_at IS NULL AND axiom_space_state(r.space_id)=\'active\' AND axiom_space_role($1,r.space_id) IS NOT NULL ORDER BY q.created_at DESC LIMIT 200',
      [userId],
    );
    const proposals = await query(
      "SELECT p.id,p.note_id AS resource_id,p.status,p.message,p.created_at,r.name AS title,coalesce((SELECT name FROM projects WHERE id=s.project_id),(SELECT name FROM groups WHERE id=s.group_id),$$Personal space$$) AS space,u.name AS author,axiom_space_role($1,r.space_id) AS role,n.generation FROM revision_suggestions p JOIN resources r ON r.note_id=p.note_id JOIN notes n ON n.id=p.note_id JOIN spaces s ON s.id=r.space_id JOIN \"user\" u ON u.id=p.author_id WHERE p.status='pending' AND r.deleted_at IS NULL AND axiom_space_state(r.space_id)='active' AND (p.author_id=$1 OR axiom_space_role($1,r.space_id)='editor') AND axiom_space_role($1,r.space_id) IS NOT NULL ORDER BY p.updated_at DESC LIMIT 200",
      [userId],
    );
    return json({ requests, proposals });
  }
  if (endpoint === "reviews" && id && request.method === "PATCH") {
    const [review] = await query("SELECT * FROM review_requests WHERE id=$1", [
      z.uuid().parse(id),
    ]);
    if (!review) throw new HttpError(404, "Review unavailable.");
    const resourceId = review.resource_id ?? review.note_id;
    const { resource, space } = await resourceAccess(
      userId,
      resourceId,
      "comment",
    );
    const input = z
      .object({
        mutationId: z.uuid(),
        version: z.number().int().positive(),
        status: z.enum(["approved", "changes_requested", "cancelled"]),
        response: z.string().max(5000).default(""),
      })
      .parse(await request.json());
    if (
      input.status === "cancelled"
        ? review.requested_by !== userId && !space.can_manage
        : review.reviewer_id !== userId
    )
      throw new HttpError(
        403,
        "Only the assigned reviewer may submit this review; the requester may cancel it.",
      );
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "resource-review-response",
      { id, ...input },
      async (client) => {
        await requireScope(
          client,
          userId,
          resource.space_id,
          input.status === "cancelled" && review.requested_by !== userId
            ? "manage"
            : "comment",
        );
        await lockRevisionResource(client, resourceId, resource.space_id);
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM review_requests WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(current.version, input.version);
        const {
          rows: [saved],
        } = await client.query(
          "UPDATE review_requests SET status=$2,response=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, input.status, input.response],
        );
        await revisionAudit(
          client,
          userId,
          resourceId,
          "review-" + input.status,
          { reviewId: id },
          input.mutationId,
        );
        await deliverEvent(client, {
          userId: review.requested_by,
          spaceId: resource.space_id,
          kind: "reviews",
          title: "Review response: " + resource.name,
          resourceId,
          dedupe: "resource-review:" + id + ":" + saved.version,
        });
        return saved;
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (endpoint !== "resources" || action !== "review-requests") return null;
  const { resource, space } = await resourceAccess(userId, z.uuid().parse(id));
  if (request.method === "GET") {
    const items = await query(
      'SELECT q.*,u.name AS reviewer FROM review_requests q JOIN "user" u ON u.id=q.reviewer_id WHERE coalesce(resource_id,note_id)=$1 ORDER BY created_at DESC LIMIT 100',
      [id],
    );
    const reviewers = await query(
      "SELECT u.id,u.name FROM \"user\" u WHERE (u.id=$2 OR EXISTS(SELECT 1 FROM members m WHERE m.user_id=u.id AND m.group_id=$3)) AND axiom_space_role(u.id,$1) IN ('editor','commenter') ORDER BY u.name LIMIT 500",
      [space.id, space.owner_id, space.group_id],
    );
    return json({ items, reviewers });
  }
  if (request.method === "POST") {
    const input = z
      .object({
        mutationId: z.uuid(),
        reference: z.string().max(100),
        reviewerId: z.string().min(1).max(200),
        message: z.string().max(5000).default(""),
      })
      .parse(await request.json());
    const revision = await readResourceRevision(userId, id, input.reference);
    if (!["snapshot", "file"].includes(revision.kind))
      throw new HttpError(400, "Name a milestone before requesting review.");
    const versionId = input.reference.split(":")[1];
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "resource-review-request",
      { id, ...input },
      async (client) => {
        await requireScope(client, userId, space.id, "edit");
        await lockRevisionResource(client, id, space.id);
        const reviewer = await client.query(
          "SELECT axiom_space_role($1,$2) AS role",
          [input.reviewerId, space.id],
        );
        if (!["editor", "commenter"].includes(reviewer.rows[0].role))
          throw new HttpError(
            400,
            "The reviewer needs commenter or editor access to this file.",
          );
        const {
          rows: [saved],
        } = await client.query(
          "INSERT INTO review_requests(project_id,resource_id,note_id,snapshot_id,file_version_id,requested_by,reviewer_id,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
          [
            space.project_id,
            id,
            revision.kind === "snapshot" ? resource.note_id : null,
            revision.kind === "snapshot" ? versionId : null,
            revision.kind === "file" ? versionId : null,
            userId,
            input.reviewerId,
            input.message,
          ],
        );
        await revisionAudit(
          client,
          userId,
          id,
          "review-requested",
          {
            reviewId: saved.id,
            reviewerId: input.reviewerId,
            reference: input.reference,
          },
          input.mutationId,
        );
        await deliverEvent(client, {
          userId: input.reviewerId,
          spaceId: space.id,
          kind: "reviews",
          title: "Review requested: " + resource.name,
          resourceId: id,
          dedupe: "resource-review:" + saved.id,
        });
        return saved;
      },
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  throw new HttpError(405, "Unsupported review action.");
}
