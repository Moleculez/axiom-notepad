import { describe, expect, it } from "vitest";
import {
  uploadInputSchema,
  uploadHeadMatches,
} from "../packages/shared/src/upload-contract";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
describe("replacement upload fences", () => {
  const base = { id: a, spaceId: b, name: "paper.pdf", bytes: 100 };
  it("does not require a fence for a new file", () =>
    expect(uploadInputSchema.parse(base).resourceId).toBeNull());
  it("rejects unfenced replacements", () =>
    expect(
      uploadInputSchema.safeParse({ ...base, resourceId: a }).success,
    ).toBe(false));
  it("requires both content and resource revision to match", () => {
    expect(
      uploadHeadMatches(
        { expected_version_id: a, expected_resource_version: 3 },
        { current_version_id: a, version: 3 },
      ),
    ).toBe(true);
    expect(
      uploadHeadMatches(
        { expected_version_id: a, expected_resource_version: 2 },
        { current_version_id: a, version: 3 },
      ),
    ).toBe(false);
    expect(
      uploadHeadMatches(
        { expected_version_id: b, expected_resource_version: 3 },
        { current_version_id: a, version: 3 },
      ),
    ).toBe(false);
    expect(
      uploadHeadMatches(
        { expected_version_id: null, expected_resource_version: null },
        { current_version_id: null, version: 3 },
      ),
    ).toBe(false);
  });
});
