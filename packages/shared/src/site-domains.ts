import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import {
  resolve4,
  resolve6,
  resolveCname,
  resolveTxt,
} from "node:dns/promises";
import { HttpError } from "./access";
export function publicationHostname(input: string) {
  const host = domainToASCII(input.trim().toLowerCase());
  if (
    !host ||
    host.length > 253 ||
    isIP(host) ||
    !host.includes(".") ||
    /[/:@?#*\s]/.test(host) ||
    host
      .split(".")
      .some(
        (p) =>
          !p || p.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(p),
      ) ||
    /\.(local|internal|localhost|test|invalid|example|home|arpa)$/.test(host)
  )
    throw new HttpError(
      400,
      "Enter a public domain name without a protocol or path.",
    );
  if (host === new URL(process.env.APP_URL || "http://localhost:8080").hostname)
    throw new HttpError(
      400,
      "The application login domain cannot be used as a custom site domain.",
    );
  return host;
}
export async function verifyPublicationDomain(host: string, token: string) {
  const target = process.env.PUBLISH_DOMAIN_TARGET;
  if (!target)
    throw new HttpError(
      409,
      "The administrator must configure PUBLISH_DOMAIN_TARGET first.",
    );
  const timeout = <T>(p: Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new HttpError(504, "DNS lookup timed out. Retry later.")),
        8000,
      );
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  const txt = await timeout(resolveTxt(`_axiom.${host}`)).catch(() => []);
  if (!txt.some((row) => row.join("") === `axiom-site=${token}`))
    throw new HttpError(
      409,
      "Ownership TXT record is not visible yet. Check _axiom and retry after DNS propagation.",
    );
  const aliases = await timeout(resolveCname(host)).catch(() => []);
  if (
    aliases.some(
      (v) => v.toLowerCase().replace(/\.$/, "") === target.toLowerCase(),
    )
  )
    return;
  const addresses = async (name: string) => [
    ...(await timeout(resolve4(name)).catch(() => [])),
    ...(await timeout(resolve6(name)).catch(() => [])),
  ];
  const [actual, wanted] = await Promise.all([
    addresses(host),
    addresses(target),
  ]);
  if (
    !actual.length ||
    !wanted.length ||
    actual.some((ip) => !wanted.includes(ip))
  )
    throw new HttpError(
      409,
      "Point every A/AAAA record to the publishing server, or use the recommended CNAME.",
    );
}
