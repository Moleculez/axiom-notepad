import type { MessageId } from "@axiom/i18n";
import { label } from "@axiom/i18n/client";

// Only closed protocol enums belong here. Authored names/values never do.
const accessRoleLabels: Readonly<Record<string, MessageId>> = {
  owner: "Owner",
  admin: "Administrator",
  administrator: "Administrator",
  member: "Member",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

export function accessRoleMessage(role: string): MessageId | undefined {
  return Object.hasOwn(accessRoleLabels, role)
    ? accessRoleLabels[role]
    : undefined;
}

export function accessRoleLabel(role: string) {
  const id = accessRoleMessage(role);
  return id ? label(id) : role;
}

const invitationStatusLabels: Readonly<Record<string, MessageId>> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  revoked: "Revoked",
  expired: "Expired",
};

export function invitationStatusLabel(status: string) {
  return Object.hasOwn(invitationStatusLabels, status)
    ? label(invitationStatusLabels[status])
    : status;
}
