"use client";
import type { AssistantSelection } from "@axiom/shared/assistant";
export type AssistantIntent = {
  spaceId?: string;
  spaceIds?: string[];
  selection?: AssistantSelection;
  selectionLabel?: string;
  prompt?: string;
};
export const assistantEvent = "axiom:assistant-open";
export function openAssistant(intent: AssistantIntent = {}) {
  window.dispatchEvent(new CustomEvent(assistantEvent, { detail: intent }));
}
