import type { Prospect } from "../../types";

/** Shared presentation guard; API always rechecks the current stored prospect. */
export function emailPromptEligible(p: Prospect): boolean {
  const email = p.email || "";
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return !p.demo && !p.archived && !p.doNotContact && email.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(email) &&
    !email.startsWith(".") && !email.includes("..") && !email.includes(".@") &&
    !/(^|\.)(example\.(com|net|org)|example|invalid|test|localhost|local)$/i.test(domain);
}
