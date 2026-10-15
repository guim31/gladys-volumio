#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only check of a real Volumio player, with the very client of the
// integration: identity, state, playlists, favourite radios, zones, and
// whether its socket.io push answers (Engine.IO 3, else 4).
//
//   node scripts/probe.mjs 192.0.2.40          # port 3000 by default
//   node scripts/probe.mjs 192.0.2.40:3000 --no-push
//
// Sends no command: nothing plays, nothing changes on the player. Prints
// counts and the fields the integration reads, never a whole library.
// -----------------------------------------------------------------------------

import { pathToFileURL } from 'node:url';
import { parseHost } from '../src/config.js';
import { zoneCandidates } from '../src/discovery.js';
import { VolumioClient } from '../src/volumio/client.js';
import { browseItems, isStream, parseState, parseSystemInfo } from '../src/volumio/model.js';
import { VolumioSocket } from '../src/volumio/socket.js';

/** Try the push channel with one protocol version. @returns {Promise<string>} */
function tryPush(host, eio, createSocket, timeoutMs) {
  return new Promise((resolve) => {
    let socket;
    const timer = setTimeout(() => {
      socket?.close();
      resolve('no answer');
    }, timeoutMs);
    socket = new VolumioSocket({
      host,
      eio,
      createSocket,
      onState: (state) => {
        clearTimeout(timer);
        socket.close();
        resolve(`ok, pushState received (status ${parseState(state).status})`);
      },
      onClose: ({ opened, reason }) => {
        clearTimeout(timer);
        resolve(opened ? `opened, then ${reason}` : `refused (${reason})`);
      },
    }).start();
  });
}

/**
 * @param {string} raw address typed on the command line
 * @param {{ fetch?: typeof fetch, createSocket?: Function, push?: boolean, log?: Function }} [options]
 * @returns {Promise<boolean>} whether the player answered as a Volumio
 */
export async function probe(raw, { fetch, createSocket, push = true, log = console.log } = {}) {
  const host = parseHost(raw);
  if (!host) {
    log(`Unusable address: ${raw}`);
    return false;
  }
  const client = new VolumioClient({ host, fetch });
  const step = async (label, run) => {
    try {
      const result = await run();
      log(`${label}: ${result}`);
      return true;
    } catch (err) {
      log(`${label}: FAILED (${err.kind ?? 'error'}: ${err.message})`);
      return false;
    }
  };

  log(`Volumio at ${host}`);
  const identified = await step('getSystemInfo', async () => {
    const info = parseSystemInfo(await client.getSystemInfo());
    if (!info) {
      throw new Error('no UUID in the answer');
    }
    return `"${info.name}", Volumio ${info.version || '?'} on ${info.hardware || '?'}, id ${info.id}`;
  });
  await step('getState', async () => {
    const state = parseState(await client.getState());
    return [
      `status ${state.status}`,
      `service ${state.service || '-'}`,
      `trackType ${state.trackType || '-'}`,
      isStream(state) ? 'stream' : 'not a stream',
      `volume ${state.volume ?? '-'}${state.mute ? ' (muted)' : ''}`,
      `volume control ${state.volumeControl ? 'yes' : 'no'}`,
      `title ${state.title ? 'present' : 'empty'}`,
      `albumart ${state.albumart ? (/^https?:/.test(state.albumart) ? 'absolute' : 'relative') : 'none'}`,
    ].join(', ');
  });
  await step('getQueue', async () => `${(await client.getQueue()).length} item(s)`);
  await step('listplaylists', async () => `${(await client.listPlaylists()).length} playlist(s)`);
  for (const uri of ['radio/favourites', 'radio/myWebRadio']) {
    await step(
      `browse ${uri}`,
      async () => `${browseItems(await client.browse(uri)).length} radio(s)`,
    );
  }
  await step(
    'getzones',
    async () => `${zoneCandidates(await client.getZones()).length} other player(s)`,
  );
  if (push) {
    for (const eio of [3, 4]) {
      const result = await tryPush(host, eio, createSocket, 8000);
      log(`socket.io (Engine.IO ${eio}): ${result}`);
      if (result.startsWith('ok')) {
        break;
      }
    }
  }
  return identified;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [address, ...flags] = process.argv.slice(2);
  if (!address) {
    console.log('Usage: node scripts/probe.mjs <ip[:port]> [--no-push]');
    process.exit(2);
  }
  const ok = await probe(address, { push: !flags.includes('--no-push') });
  process.exit(ok ? 0 : 1);
}
