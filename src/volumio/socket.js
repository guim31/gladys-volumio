// -----------------------------------------------------------------------------
// Real-time updates: the socket.io channel of Volumio (the one its web
// interface uses), spoken over the WebSocket built into Node, without the
// socket.io client library.
//
// Volumio 3 runs socket.io 2 (Engine.IO protocol 3): the server opens with
// `0{"pingInterval":...}` and `40` (namespace joined), the client sends a ping
// `2` every pingInterval and gets a pong `3`, events travel as
// `42["name",payload]`. Engine.IO 4 (socket.io 3+) differs in two points the
// code also handles: the client joins the namespace itself (`40`) and the
// server sends the pings, which the client answers. Volumio pushes
// `pushState` on every change; `getState` asks for one now.
//
// Anything unexpected closes the channel: the hub then reads the player over
// REST, as when the push is not available at all.
// -----------------------------------------------------------------------------

export const SOCKET_TIMINGS = {
  // The server must say hello within this delay.
  openTimeoutMs: 10_000,
  // Added to the ping interval and timeout the server announces before the
  // channel is deemed dead.
  watchdogSlackMs: 5_000,
};

const defaultCreateSocket = (url) => new WebSocket(url);

export class VolumioSocket {
  /**
   * @param {object} options
   * @param {string} options.host `host:port`
   * @param {3|4} [options.eio] Engine.IO protocol version to speak
   * @param {(url: string) => object} [options.createSocket] WebSocket seam (tests)
   * @param {(state: object) => void} options.onState a pushState payload
   * @param {() => void} [options.onLive] the channel works (namespace joined)
   * @param {(info: { opened: boolean, live: boolean, serverPinged: boolean, reason: string }) => void} [options.onClose]
   * @param {object} [options.timings] SOCKET_TIMINGS overrides
   */
  constructor({ host, eio = 3, createSocket, onState, onLive, onClose, timings }) {
    this.host = host;
    this.eio = eio;
    this.createSocket = createSocket ?? defaultCreateSocket;
    this.onState = onState;
    this.onLive = onLive ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.timings = { ...SOCKET_TIMINGS, ...timings };
    this.ws = null;
    this.opened = false;
    this.live = false;
    this.serverPinged = false;
    this.closed = false;
    this.pingTimer = null;
    this.watchdog = null;
    this.watchdogMs = this.timings.openTimeoutMs;
  }

  get url() {
    return `ws://${this.host}/socket.io/?EIO=${this.eio}&transport=websocket`;
  }

  start() {
    try {
      this.ws = this.createSocket(this.url);
    } catch (err) {
      queueMicrotask(() => this.finish(`cannot open: ${err.message}`));
      return this;
    }
    this.ws.addEventListener('message', (event) => {
      try {
        this.handle(event.data);
      } catch (err) {
        this.finish(`bad message: ${err.message}`);
      }
    });
    this.ws.addEventListener('close', () => this.finish('closed by the player'));
    this.ws.addEventListener('error', (event) =>
      this.finish(`error: ${event?.message ?? event?.error?.message ?? 'socket error'}`),
    );
    this.arm(this.timings.openTimeoutMs);
    return this;
  }

  /** (Re)arm the watchdog: nothing heard for that long closes the channel. */
  arm(ms = this.watchdogMs) {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.finish('no answer'), ms);
    this.watchdog.unref?.();
  }

  send(packet) {
    try {
      this.ws?.send(packet);
    } catch (err) {
      this.finish(`send failed: ${err.message}`);
    }
  }

  /** Ask the player for its state now (answered by a pushState). */
  requestState() {
    if (this.live) {
      this.send(`42${JSON.stringify(['getState'])}`);
    }
  }

  handle(data) {
    if (this.closed) {
      return;
    }
    const packet = typeof data === 'string' ? data : Buffer.from(data ?? '').toString('utf8');
    const type = packet[0];
    if (type === '0') {
      const handshake = JSON.parse(packet.slice(1));
      const interval = Number(handshake.pingInterval) || 25_000;
      const timeout = Number(handshake.pingTimeout) || 20_000;
      this.opened = true;
      this.watchdogMs = interval + timeout + this.timings.watchdogSlackMs;
      if (this.eio === 3) {
        // Engine.IO 3: the client pings.
        this.pingTimer = setInterval(() => this.send('2'), interval);
        this.pingTimer.unref?.();
      } else {
        // Engine.IO 4: the client joins the default namespace itself.
        this.send('40');
      }
      this.arm();
    } else if (type === '2') {
      // Engine.IO 4: the server pings.
      this.serverPinged = true;
      this.send(`3${packet.slice(1)}`);
      this.arm();
    } else if (type === '3') {
      this.arm();
    } else if (type === '1') {
      this.finish('closed by the player');
    } else if (type === '4') {
      this.arm();
      this.handleSocketIo(packet.slice(1));
    }
  }

  handleSocketIo(packet) {
    const type = packet[0];
    if (type === '0') {
      if (!this.live) {
        this.live = true;
        this.onLive();
        this.requestState();
      }
    } else if (type === '2') {
      // `2` [namespace,] [ack id] `[name, ...args]`
      const start = packet.indexOf('[');
      if (start === -1) {
        return;
      }
      const [name, payload] = JSON.parse(packet.slice(start));
      if (name === 'pushState' && payload && typeof payload === 'object') {
        this.onState(payload);
      }
    } else if (type === '1' || type === '4') {
      this.finish(type === '1' ? 'disconnected by the player' : 'refused by the player');
    }
  }

  /** Stop for good: no onClose (the caller asked). */
  close() {
    this.closed = true;
    this.cleanup();
  }

  cleanup() {
    clearInterval(this.pingTimer);
    clearTimeout(this.watchdog);
    this.pingTimer = null;
    this.watchdog = null;
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }

  finish(reason) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cleanup();
    this.onClose({
      opened: this.opened,
      live: this.live,
      serverPinged: this.serverPinged,
      reason,
    });
  }
}
