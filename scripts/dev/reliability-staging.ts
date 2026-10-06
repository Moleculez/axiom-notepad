import { runStaging } from "./staging-runner";
import { reliabilityStagingProfile } from "../../packages/shared/src/test-staging";
process.env.AXIOM_PLUGINS_ENABLED = "false";
process.env.AXIOM_PLUGIN_IMPORTS_ENABLED = "false";
await runStaging(
  reliabilityStagingProfile,
  process.argv[2],
  process.argv.slice(3),
);
