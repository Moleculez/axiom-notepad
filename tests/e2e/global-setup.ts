import { verifyMutationTestServer } from "../../packages/shared/src/test-target";

export default async function globalSetup() {
  await verifyMutationTestServer(process.env);
}
