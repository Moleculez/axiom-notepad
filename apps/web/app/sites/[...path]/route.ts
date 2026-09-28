import { publicSiteRequest } from "@axiom/shared/site-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = publicSiteRequest;
export const HEAD = publicSiteRequest;
export const POST = publicSiteRequest;
