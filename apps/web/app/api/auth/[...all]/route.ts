import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@axiom/shared/auth";
export const { GET, POST } = toNextJsHandler(auth);
