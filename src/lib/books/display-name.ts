/**
 * A Comment's writer is shown by name, not address: the local part before the `@`,
 * capitalised (`annie@gmail.com` becomes `Annie`). An email with no `@` — never
 * expected from `public.users`, but not a reason to crash a Thread's render — is
 * capitalised and shown as-is.
 */
export function displayNameFromEmail(email: string): string {
  const at = email.indexOf("@");
  const localPart = at === -1 ? email : email.slice(0, at);
  return localPart.length === 0
    ? localPart
    : localPart.charAt(0).toUpperCase() + localPart.slice(1);
}
