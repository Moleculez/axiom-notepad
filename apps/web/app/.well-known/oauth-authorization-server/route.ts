import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@axiom/shared/auth";
export const GET = oauthProviderAuthServerMetadata(auth);
