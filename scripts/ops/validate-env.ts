import { config } from "dotenv";
import { environmentErrors } from "./environment";
const file = process.argv[2];
if (file !== "--runtime") config({ path: file ?? ".env", quiet: true });
const errors = environmentErrors(process.env);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Configuration validated. Secret values were not printed.");
