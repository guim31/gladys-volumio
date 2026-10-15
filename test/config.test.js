import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHost, parseHosts } from '../src/config.js';

test('an address typed by hand gets the API port 3000 unless it gives one', () => {
  assert.equal(parseHost('192.0.2.40'), '192.0.2.40:3000');
  assert.equal(parseHost(' 192.0.2.40:8080 '), '192.0.2.40:8080');
  assert.equal(parseHost('volumio.lan'), 'volumio.lan:3000');
  // The URL copied from the browser: path dropped, port 80 implicit → 3000.
  assert.equal(parseHost('http://192.0.2.40/playback'), '192.0.2.40:3000');
  assert.equal(parseHost('http://192.0.2.40:3000/browse'), '192.0.2.40:3000');
});

test('unusable addresses are refused, credentials included', () => {
  for (const raw of [
    '',
    '  ',
    'https://192.0.2.40',
    'ftp://x',
    'http://user:pw@192.0.2.40',
    null,
    12,
  ]) {
    assert.equal(parseHost(raw), null, String(raw));
  }
});

test('the address list accepts commas, semicolons and spaces, and never echoes a password', () => {
  const { hosts, invalid } = parseHosts(
    '192.0.2.40, 192.0.2.41;192.0.2.40 http://admin:hunter2@192.0.2.43 ftp://x',
  );
  assert.deepEqual(hosts, ['192.0.2.40:3000', '192.0.2.41:3000']);
  assert.equal(invalid.length, 2);
  assert.ok(!invalid.join(' ').includes('hunter2'));
  assert.ok(invalid[0].includes('***@192.0.2.43'));
});

test('defaults: French names, real time on, notification volume unchanged, 60 s limit', () => {
  const config = normalizeConfig({});
  assert.deepEqual(config, {
    hosts: [],
    invalidHosts: [],
    realtime: true,
    notificationVolume: 0,
    notificationMaxMs: 60_000,
    language: 'fr',
  });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('numbers are bounded and accept a typed string', () => {
  const config = normalizeConfig({
    notification_volume: '45,4',
    notification_max_seconds: 5000,
    realtime: 'false',
    language: 'de',
  });
  assert.equal(config.notificationVolume, 45);
  assert.equal(config.notificationMaxMs, 600_000);
  assert.equal(config.realtime, false);
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ notification_volume: 'loud' }).notificationVolume, 0);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
});
