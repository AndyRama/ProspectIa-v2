import type { Prospect } from "../../types";

/** Pure recipient syntax/policy guard shared by manual input and prompt eligibility. */
export function validProspectEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return email.length <= 254 && email.split("@")[0].length <= 64 && domain.split(".").every(label => label.length <= 63) &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?\.)+[A-Z]{2,63}$/i.test(email) &&
    !email.startsWith(".") && !email.includes("..") && !email.includes(".@") &&
    !/(^|\.)(example\.(com|net|org)|example|invalid|test|localhost|local)$/i.test(domain);
}

/** Shared presentation guard; API always rechecks the current stored prospect. */
export function emailPromptEligible(p: Prospect): boolean {
  return !p.demo && !p.archived && !p.doNotContact && validProspectEmail(p.email || "");
}
