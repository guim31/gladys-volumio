// -----------------------------------------------------------------------------
// Every text the integration shows, in the four languages of the Gladys
// interface: English, French, German (with "du") and Spanish (with "usted").
// Brands (Volumio, Spotify, AirPlay...) are never translated.
//
// Gladys tells a widget the user's language, not a device integration nor a
// scene action: those use the `language` of the configuration.
// -----------------------------------------------------------------------------

export const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of `table` in `language`, English when missing. */
export const pick = (table, language) => table?.[language] ?? table?.en ?? '';

/** `{ en, fr, de, es }` built by a function of the language. */
export const each = (build) => Object.fromEntries(LANGS.map((lang) => [lang, build(lang)]));

/** "Name: text", with the French space before the colon. */
export const labelled = (name, value, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${value}`;

const list = (items, language) => items.join(language === 'fr' ? ' ; ' : '; ');

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Shown under the integration name in the Configuration screen.
export const CONNECTION_TEXT = {
  noPlayer: {
    en: 'No Volumio player found: enter its IP address in the configuration.',
    fr: 'Aucun lecteur Volumio trouvé : saisissez son adresse IP dans la configuration.',
    de: 'Kein Volumio-Player gefunden: Gib seine IP-Adresse in der Konfiguration ein.',
    es: 'No se ha encontrado ningún reproductor Volumio: introduzca su dirección IP en la configuración.',
  },
  invalidHosts: {
    en: 'Some addresses could not be read: check the player addresses.',
    fr: 'Certaines adresses sont illisibles : vérifiez les adresses des lecteurs.',
    de: 'Einige Adressen sind ungültig: Prüfe die Adressen der Player.',
    es: 'Algunas direcciones no son válidas: revise las direcciones de los reproductores.',
  },
};

// Why a player cannot be read, by error kind (src/volumio/client.js).
export const ERROR_TEXT = {
  unreachable: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  http: {
    en: 'answered with an HTTP error',
    fr: 'a répondu par une erreur HTTP',
    de: 'hat mit einem HTTP-Fehler geantwortet',
    es: 'ha respondido con un error HTTP',
  },
  refused: {
    en: 'refused the command',
    fr: 'a refusé la commande',
    de: 'hat den Befehl abgelehnt',
    es: 'ha rechazado el comando',
  },
  invalid: {
    en: 'does not look like a Volumio player',
    fr: 'ne ressemble pas à un lecteur Volumio',
    de: 'scheint kein Volumio-Player zu sein',
    es: 'no parece un reproductor Volumio',
  },
};

// Errors of the commands, scene actions and widget actions.
export const ACTION_TEXT = {
  noPlayer: {
    en: 'No Volumio player is known yet: open the Discovery tab.',
    fr: "Aucun lecteur Volumio n'est encore connu : ouvrez l'onglet Découverte.",
    de: 'Noch kein Volumio-Player bekannt: Öffne den Tab „Entdecken“.',
    es: 'Aún no se conoce ningún reproductor Volumio: abra la pestaña Descubrir.',
  },
  unknownPlayer: {
    en: 'This device is not a known Volumio player.',
    fr: "Cet appareil n'est pas un lecteur Volumio connu.",
    de: 'Dieses Gerät ist kein bekannter Volumio-Player.',
    es: 'Este dispositivo no es un reproductor Volumio conocido.',
  },
  emptyName: {
    en: 'Enter a name.',
    fr: 'Saisissez un nom.',
    de: 'Gib einen Namen ein.',
    es: 'Introduzca un nombre.',
  },
  invalidUrl: {
    en: 'The address must start with http:// or https://.',
    fr: "L'adresse doit commencer par http:// ou https://.",
    de: 'Die Adresse muss mit http:// oder https:// beginnen.',
    es: 'La dirección debe empezar por http:// o https://.',
  },
  playlistNotFound: {
    en: (name, player) => `Playlist "${name}" not found on ${player}.`,
    fr: (name, player) => `Playlist « ${name} » introuvable sur ${player}.`,
    de: (name, player) => `Playlist „${name}“ auf ${player} nicht gefunden.`,
    es: (name, player) => `Lista «${name}» no encontrada en ${player}.`,
  },
  unknownMedia: {
    en: 'This item is not one of this player: browse or search again.',
    fr: "Cet élément n'est pas un élément de ce lecteur : parcourez ou recherchez à nouveau.",
    de: 'Dieses Element gehört nicht zu diesem Player: Durchsuche oder suche erneut.',
    es: 'Este elemento no pertenece a este reproductor: explore o busque de nuevo.',
  },
  nothingToPlay: {
    en: 'Volumio found nothing to play for this item (removed from the library?).',
    fr: "Volumio n'a rien trouvé à lire pour cet élément (retiré de la bibliothèque ?).",
    de: 'Volumio hat für dieses Element nichts zum Abspielen gefunden (aus der Bibliothek entfernt?).',
    es: 'Volumio no ha encontrado nada que reproducir para este elemento (¿eliminado de la biblioteca?).',
  },
  notInQueue: {
    en: 'This track is no longer in the queue.',
    fr: "Ce morceau n'est plus dans la file d'attente.",
    de: 'Dieser Titel ist nicht mehr in der Warteschlange.',
    es: 'Esta pista ya no está en la cola.',
  },
  addedAtEnd: {
    en: 'Added at the end of the queue: the player did not move it after the current track.',
    fr: "Ajouté en fin de file : le lecteur ne l'a pas déplacé après le morceau en cours.",
    de: 'Am Ende der Warteschlange hinzugefügt: Der Player hat es nicht hinter den aktuellen Titel verschoben.',
    es: 'Añadido al final de la cola: el reproductor no lo ha movido después de la pista actual.',
  },
  notSeekable: {
    en: 'A web radio cannot be moved forward or back.',
    fr: 'Une webradio ne peut pas être avancée ni reculée.',
    de: 'Ein Webradio kann nicht vor- oder zurückgespult werden.',
    es: 'Una radio web no se puede avanzar ni retroceder.',
  },
  noRealtime: {
    en: 'the real-time channel (socket.io), needed for this command, does not answer',
    fr: 'le canal temps réel (socket.io), nécessaire pour cette commande, ne répond pas',
    de: 'der für diesen Befehl nötige Echtzeitkanal (socket.io) antwortet nicht',
    es: 'el canal en tiempo real (socket.io), necesario para este comando, no responde',
  },
  radioNotFound: {
    en: (name, player) => `Web radio "${name}" not found in the favourites of ${player}.`,
    fr: (name, player) => `Webradio « ${name} » introuvable dans les favoris de ${player}.`,
    de: (name, player) => `Webradio „${name}“ nicht in den Favoriten von ${player} gefunden.`,
    es: (name, player) => `Radio web «${name}» no encontrada en los favoritos de ${player}.`,
  },
};

// The report of the "Search for players" button.
export const SEARCH_TEXT = {
  en: {
    none: 'No Volumio player found.',
    count: (total, reachable) => `${total} player(s), ${reachable} answering:`,
    live: 'real time',
    polled: 'polled',
    unreachable: 'unreachable',
    noMdns: 'Automatic discovery (mDNS) found nothing: enter the IP address of a player.',
    ignored: (items) => `Ignored addresses: ${items}.`,
  },
  fr: {
    none: 'Aucun lecteur Volumio trouvé.',
    count: (total, reachable) => `${total} lecteur(s), ${reachable} répondent :`,
    live: 'temps réel',
    polled: 'interrogé',
    unreachable: 'injoignable',
    noMdns:
      "La découverte automatique (mDNS) n'a rien trouvé : saisissez l'adresse IP d'un lecteur.",
    ignored: (items) => `Adresses ignorées : ${items}.`,
  },
  de: {
    none: 'Kein Volumio-Player gefunden.',
    count: (total, reachable) => `${total} Player, davon ${reachable} erreichbar:`,
    live: 'Echtzeit',
    polled: 'abgefragt',
    unreachable: 'nicht erreichbar',
    noMdns:
      'Die automatische Erkennung (mDNS) hat nichts gefunden: Gib die IP-Adresse eines Players ein.',
    ignored: (items) => `Ignorierte Adressen: ${items}.`,
  },
  es: {
    none: 'No se ha encontrado ningún reproductor Volumio.',
    count: (total, reachable) => `${total} reproductor(es), ${reachable} responden:`,
    live: 'tiempo real',
    polled: 'consultado',
    unreachable: 'inaccesible',
    noMdns:
      'El descubrimiento automático (mDNS) no ha encontrado nada: introduzca la dirección IP de un reproductor.',
    ignored: (items) => `Direcciones ignoradas: ${items}.`,
  },
};

// The report of the "List playlists and favourite radios" button.
export const MEDIA_TEXT = {
  en: {
    playlists: 'Playlists',
    radios: 'Favourite web radios',
    none: 'none',
  },
  fr: {
    playlists: 'Playlists',
    radios: 'Webradios favorites',
    none: 'aucune',
  },
  de: {
    playlists: 'Playlists',
    radios: 'Lieblings-Webradios',
    none: 'keine',
  },
  es: {
    playlists: 'Listas de reproducción',
    radios: 'Radios web favoritas',
    none: 'ninguna',
  },
};

/** One player of the media report: "Living room: Playlists: a, b; Favourite web radios: none". */
export function mediaLine({ name, playlists, radios, error }, language) {
  const text = MEDIA_TEXT[language] ?? MEDIA_TEXT.en;
  if (error) {
    return labelled(name, pick(ERROR_TEXT[error], language), language);
  }
  const names = (items) => (items.length ? items.join(', ') : text.none);
  return labelled(
    name,
    list(
      [
        labelled(text.playlists, names(playlists), language),
        labelled(text.radios, names(radios), language),
      ],
      language,
    ),
    language,
  );
}

// The sources Volumio reports in `service`: the generic ones are
// translated, the brands are not.
export const SOURCE_TEXT = {
  mpd: {
    en: 'Music library',
    fr: 'Bibliothèque musicale',
    de: 'Musikbibliothek',
    es: 'Biblioteca musical',
  },
  webradio: { en: 'Web radio', fr: 'Webradio', de: 'Webradio', es: 'Radio web' },
  upnp: {
    en: 'Media server',
    fr: 'Serveur multimédia',
    de: 'Medienserver',
    es: 'Servidor multimedia',
  },
  linein: { en: 'Line input', fr: 'Entrée ligne', de: 'Line-Eingang', es: 'Entrada de línea' },
};

const BRANDS = [
  [/spop|spotify|volspotconnect/i, 'Spotify'],
  [/airplay|shairport/i, 'AirPlay'],
  [/bluetooth|btsink/i, 'Bluetooth'],
  [/tidal/i, 'TIDAL'],
  [/qobuz/i, 'Qobuz'],
  [/youtube/i, 'YouTube'],
  [/tunein/i, 'TuneIn'],
  [/upnp_browser|upnp/i, null],
  [/linein|line_in|analog/i, null],
];

/** The source a state comes from, as the user knows it. */
export function sourceLabel(state, language) {
  const service = String(state?.service ?? '');
  if (state?.stream && (service === 'webradio' || service === 'mpd' || service === '')) {
    return pick(SOURCE_TEXT.webradio, language);
  }
  if (SOURCE_TEXT[service]) {
    return pick(SOURCE_TEXT[service], language);
  }
  for (const [pattern, brand] of BRANDS) {
    if (pattern.test(service)) {
      if (brand) {
        return brand;
      }
      return pick(/upnp/i.test(service) ? SOURCE_TEXT.upnp : SOURCE_TEXT.linein, language);
    }
  }
  return service.slice(0, 40);
}
