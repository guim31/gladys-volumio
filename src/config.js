// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The port Volumio serves its REST API and its socket.io push on. Port 80
// forwards to it on the Volumio images, but not on every install.
export const DEFAULT_PORT = 3000;

export const NOTIFICATION_VOLUME = { min: 0, max: 100 };
export const NOTIFICATION_MAX_SECONDS = { min: 10, max: 600 };

export const DEFAULT_CONFIG = {
  hosts: '',
  realtime: true,
  notification_volume: 0,
  notification_max_seconds: 60,
  language: 'fr',
};

const MAX_HOSTS = 20;

/**
 * Parse one address typed by the user: an IP or a host name, with an optional
 * port, or the URL copied from the browser (`http://192.0.2.10/playback`).
 * @param {unknown} raw
 * @returns {string|null} `host:port`, null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.protocol !== 'http:' || !url.hostname || url.username || url.password) {
    return null;
  }
  // A URL copied from the browser carries port 80 (implicit): Volumio
  // answers on 3000 everywhere, on 80 only when its redirection is set up.
  const port = url.port ? Number(url.port) : DEFAULT_PORT;
  return `${url.hostname}:${port}`;
}

/**
 * The list of addresses of the `hosts` field (commas, semicolons or spaces).
 * @returns {{ hosts: string[], invalid: string[] }}
 */
export function parseHosts(raw) {
  const hosts = [];
  const invalid = [];
  const parts = typeof raw === 'string' ? raw.split(/[\s,;]+/).filter(Boolean) : [];
  for (const part of parts.slice(0, MAX_HOSTS)) {
    const host = parseHost(part);
    if (host === null) {
      // Shown back to the user and logged: never the credentials it may hold.
      invalid.push(part.replace(/^([a-z][a-z0-9+.-]*:\/\/)?[^@/]*@/i, '$1***@').slice(0, 60));
    } else if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }
  return { hosts, invalid };
}

/** A whole number in [min, max] from a number or a typed string, else `fallback`. */
function integer(raw, { min, max }, fallback) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const { hosts, invalid } = parseHosts(source.hosts);
  return {
    hosts,
    invalidHosts: invalid,
    realtime: source.realtime !== false && source.realtime !== 'false',
    notificationVolume: integer(
      source.notification_volume,
      NOTIFICATION_VOLUME,
      DEFAULT_CONFIG.notification_volume,
    ),
    notificationMaxMs:
      integer(
        source.notification_max_seconds,
        NOTIFICATION_MAX_SECONDS,
        DEFAULT_CONFIG.notification_max_seconds,
      ) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
