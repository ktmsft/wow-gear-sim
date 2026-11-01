// Keeps other websites from using the local API.
//
// The server only listens on this PC (or the LAN with HOST=0.0.0.0), but any page
// open in the browser can still send requests to it. Two checks stop that:
// - Host must be an IP address or a name this PC answers to. A DNS rebinding
//   attack reaches us under the attacker's domain name, so it fails here.
// - Requests that change something (POST, DELETE) must come from this page.
//   Browsers send Origin on those, and a cross-site one won't match Host.

import os from 'node:os';
import net from 'node:net';

function hostname(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

export function allowedNames(extra = process.env.ALLOWED_HOSTS) {
  const names = new Set(['localhost']);
  const machine = os.hostname().toLowerCase();
  if (machine) {
    names.add(machine);
    names.add(`${machine}.local`);
  }
  for (const name of (extra ?? '').split(',')) {
    if (name.trim()) names.add(name.trim().toLowerCase());
  }
  return names;
}

// Returns null when the request is fine, or a reason to reject it.
export function checkRequest({ method, host, origin }, names = allowedNames()) {
  const name = host ? hostname(host) : null;
  if (!name) return 'Missing or invalid Host header.';
  if (!net.isIP(name) && !names.has(name) && !name.endsWith('.localhost')) {
    return `Requests for "${name}" aren't allowed. Open SIMulacrum by its IP address or localhost, or add the name to ALLOWED_HOSTS.`;
  }
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (origin === undefined) return null; // Not a browser, e.g. curl.
  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return 'Cross-site requests aren\'t allowed.';
  }
  if (originHost !== host.toLowerCase()) return 'Cross-site requests aren\'t allowed.';
  return null;
}
