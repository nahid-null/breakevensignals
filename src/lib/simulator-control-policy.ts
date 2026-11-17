/** Fail closed on published sites until their Invite-only access has been verified. */
export function simulatorControlsAllowed(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}