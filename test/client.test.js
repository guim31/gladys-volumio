// -----------------------------------------------------------------------------
// The REST client over real HTTP (a fake player served on 127.0.0.1), with
// the real fetch of Node.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ERROR_KINDS, VolumioClient } from '../src/volumio/client.js';
import { FakeVolumio, PNG_1PX, serve } from './helpers/fakeVolumio.js';

async function served(t, options) {
  const player = new FakeVolumio(options);
  const server = await serve(player);
  t.after(() => server.close());
  return { player, client: new VolumioClient({ host: server.host }) };
}

test('reads the identity, the state, the queue and the playlists', async (t) => {
  const { client } = await served(t);
  assert.equal((await client.getSystemInfo()).name, 'Salon');
  assert.equal((await client.getState()).title, 'Feeling Good');
  assert.equal((await client.getQueue()).length, 3);
  assert.deepEqual(await client.listPlaylists(), ['Dîner', 'Réveil', 'Rock']);
  assert.equal((await client.getZones()).length, 2);
});

test('sends the commands as Volumio expects them', async (t) => {
  const { client, player } = await served(t);
  await client.command('volume', { volume: 42 });
  await client.command('random', { value: true });
  await client.replaceAndPlay({
    service: 'webradio',
    type: 'webradio',
    title: 'x',
    uri: 'http://192.0.2.9/a.mp3',
  });
  assert.equal(player.state.volume, 42);
  assert.equal(player.state.random, true);
  assert.equal(player.state.uri, 'http://192.0.2.9/a.mp3');
  const command = player.requests.find((request) => request.query.cmd === 'volume');
  assert.equal(command.path, '/api/v1/commands/');
  const post = player.requests.find((request) => request.path === '/api/v1/replaceAndPlay');
  assert.equal(post.method, 'POST');
});

test('an error in a 200 answer is a refusal', async (t) => {
  const { client } = await served(t);
  await assert.rejects(client.command('dance'), { kind: ERROR_KINDS.REFUSED });
  await assert.rejects(client.replaceAndPlay({}), { kind: ERROR_KINDS.REFUSED });
});

test('an HTTP error and a non-JSON answer have their own kind', async (t) => {
  const { client } = await served(t);
  await assert.rejects(client.request('nothing-here'), { kind: ERROR_KINDS.HTTP });
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>router login</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const other = new VolumioClient({ host: `127.0.0.1:${server.address().port}` });
  await assert.rejects(other.getState(), { kind: ERROR_KINDS.INVALID });
});

test('a closed port does not answer', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const client = new VolumioClient({ host: `127.0.0.1:${port}` });
  await assert.rejects(client.getState(), { kind: ERROR_KINDS.UNREACHABLE });
});

test('album art: relative paths join the player, downloads are bounded', async (t) => {
  const { client, player } = await served(t);
  assert.equal(client.artUrl('/albumart?x=1'), `http://${client.host}/albumart?x=1`);
  assert.equal(client.artUrl('https://cdn.example.org/a.jpg'), 'https://cdn.example.org/a.jpg');
  assert.equal(client.artUrl(''), null);
  const bytes = await client.download(client.artUrl('/albumart'), { maxBytes: 1000 });
  assert.deepEqual(bytes, PNG_1PX);
  player.art = Buffer.alloc(5000);
  await assert.rejects(client.download(client.artUrl('/albumart'), { maxBytes: 1000 }), {
    kind: ERROR_KINDS.INVALID,
  });
});
