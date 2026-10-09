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

const providerCapabilityLabels: Readonly<Record<string, MessageId>> = {
  math: "Mathematical assistance",
  ocr: "Optical character recognition",
  paper: "Paper reading assistance",
  assistant: "Workspace assistant",
};

const evidenceKindLabels: Readonly<Record<string, MessageId>> = {
  document: "Document",
  office: "Office document",
  planning: "Planning",
  task: "Task",
  canvas: "Canvas",
  pdf: "PDF",
  ocr: "Optical character recognition",
};

const publicationKindLabels: Readonly<Record<string, MessageId>> = {
  post: "Post",
  paper: "Paper",
  page: "Page",
  resource: "Resource",
};

const annotationColorLabels: Readonly<Record<string, MessageId>> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

function enumLabel(labels: Readonly<Record<string, MessageId>>, value: string) {
  return Object.hasOwn(labels, value) ? label(labels[value]) : value;
}

export const providerCapabilityLabel = (value: string) =>
  enumLabel(providerCapabilityLabels, value);
export const evidenceKindLabel = (value: string) =>
  enumLabel(evidenceKindLabels, value);
export const publicationKindLabel = (value: string) =>
  enumLabel(publicationKindLabels, value);
export const annotationColorLabel = (value: string) =>
  enumLabel(annotationColorLabels, value);
