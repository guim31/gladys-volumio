// -----------------------------------------------------------------------------
// Where to look for Volumio players: the addresses typed in the configuration,
// the mDNS announcements relayed by the Gladys core (mediated discovery, the
// container never sees mDNS itself), the "zones" each player knows (Volumio
// players discover each other), and the addresses already known.
//
// Each address is then asked for its identity (getSystemInfo): the UUID
// Volumio reports identifies the player whatever address it answers on.
//
// mDNS: Volumio announces `_Volumio._tcp`, with a capital V. The core only
// accepts a lowercase service type in the manifest, and compares the names of
// the answers with the case it queried: Gladys 5.2.1 may therefore find no
// player at all this way. The zones of a player found by its address, and
// the address typed by hand, do not depend on it.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { DEFAULT_PORT, parseHost } from './config.js';

export const MDNS_SERVICE = '_volumio._tcp';
export const MDNS_TIMEOUT_SECONDS = 5;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Candidates from the raw results of `scanNetwork('mdns')`.
 * @param {Array} results `[{ name, host, addresses, port, txt }]`
 * @returns {Array<{ host: string, id: string|null, name: string|null }>}
 */
export function mdnsCandidates(results) {
  const candidates = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || typeof result !== 'object') {
      continue;
    }
    const addresses = Array.isArray(result.addresses) ? result.addresses : [];
    // A link-local IPv6 address cannot be reached from the container.
    const ipv4 = addresses.find((address) => typeof address === 'string' && IPV4.test(address));
    if (!ipv4) {
      continue;
    }
    const port = Number.isInteger(result.port) && result.port > 0 ? result.port : DEFAULT_PORT;
    const txt = parseMdnsTxt(Array.isArray(result.txt) ? result.txt : []);
    const host = `${ipv4}:${port}`;
    if (!candidates.some((candidate) => candidate.host === host)) {
      candidates.push({
        host,
        id: typeof txt.uuid === 'string' ? txt.uuid.toLowerCase() : null,
        name: typeof txt.volumioname === 'string' ? txt.volumioname : null,
      });
    }
  }
  return candidates;
}

/**
 * Candidates from the zones a player knows (`getzones`): `host` is
 * `http://<ip>`, reached on the API port.
 */
export function zoneCandidates(zones) {
  const candidates = [];
  for (const zone of Array.isArray(zones) ? zones : []) {
    if (!zone || typeof zone.host !== 'string') {
      continue;
    }
    let hostname;
    try {
      hostname = new URL(zone.host).hostname;
    } catch {
      continue;
    }
    // 127.0.0.1 is how a player without network names itself.
    if (!IPV4.test(hostname) || hostname.startsWith('127.')) {
      continue;
    }
    const host = parseHost(hostname);
    if (host && !candidates.some((candidate) => candidate.host === host)) {
      candidates.push({
        host,
        id: typeof zone.id === 'string' ? zone.id.toLowerCase() : null,
        name: typeof zone.name === 'string' ? zone.name : null,
      });
    }
  }
  return candidates;
}

/**
 * Run `task` on every item, `limit` at a time; resolves with the results in
 * order (`{ value }` or `{ error }`).
 */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { value: await task(items[index]) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
