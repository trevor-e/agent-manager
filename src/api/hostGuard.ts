// Binding to 127.0.0.1 does not stop DNS rebinding: a malicious page can
// point its own domain at 127.0.0.1 and drive this API from the victim's
// browser (spawn agents, approve tool calls). Only honor requests whose Host
// header names the loopback interface. The port is irrelevant to the attack,
// and the Vite dev proxy may forward its own port, so only the hostname is
// checked.

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isAllowedHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase();
  // IPv6 hosts look like "[::1]:7777" — split on the closing bracket.
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  return ALLOWED_HOSTNAMES.has(hostname);
}
