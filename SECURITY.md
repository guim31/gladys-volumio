# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Stored**: in `/data`, only `media-ids.json`, the library items whose
  identifier is too long for Gladys (service and URI of a track or an album,
  kept for the scenes that play them). The configuration (player addresses, real
  time, notification volume and length, language) lives in Gladys; the
  address of each player is also kept in its device parameters.
- **Secrets**: none. The Volumio API has no account and no password. An
  address typed with credentials (`http://user:pass@…`) is refused, and
  masked wherever it is shown back or logged.
- **Network**: plain HTTP and WebSocket to the players on the local network
  (port 3000 by default), the mDNS scan relayed by the Gladys core, and the
  album covers Volumio points to (on the player, or on the Internet for web
  radios and streaming services), downloaded at most 10 MB each for the
  dashboard widget and the Music box (made smaller in the container). The integration sends no command a user, a scene or a
  widget did not ask for, besides putting the music back after a
  notification. An address played by a scene action must be `http(s)`; it is
  fetched by the player, not by the integration.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Volumio and the services it plays from.
