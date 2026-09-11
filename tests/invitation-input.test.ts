import { expect, it } from "vitest";
import { invitationToken } from "../packages/shared/src/invitation-input";
const token = "a".repeat(64),
  origin = "http://localhost:8080";
it("accepts only tokens and same-origin invitation links", () => {
  expect(invitationToken(` ${token} `, origin)).toBe(token);
  expect(invitationToken(`${origin}/?invite=${token}`, origin)).toBe(token);
  expect(invitationToken(`/workbench/groups?invite=${token}`, origin)).toBe(
    token,
  );
  for (const value of [
    "",
    "bad",
    "javascript:alert(1)",
    `${origin}/?invite=bad`,
    `https://other.test/?invite=${token}`,
  ])
    expect(invitationToken(value, origin)).toBeNull();
});
