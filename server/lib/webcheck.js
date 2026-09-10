// Web-Check: was sich ueber einen Betrieb ohne Agenten herausfinden laesst.
//
// Ein Agentenlauf je Betrieb ist genau, aber teuer. Fuer die vier Fragen, die
// bei einem ganzen Ausschnitt zaehlen - laeuft die Seite, Telefon, Instagram,
// Facebook - ist er Verschwendung: das beantworten zwei HTTP-Abfragen in rund
// zwei Sekunden und ohne einen einzigen Token.
//
// Grundhaltung wie in analysis.js: lieber nichts sagen als etwas Falsches.
// Ein Zeitlimit ist KEIN Beweis fuer eine kaputte Seite - dann bleibt der
// Befund offen und der Betrieb ungeprueft. Nur was das Netz eindeutig
// beantwortet (Domain existiert nicht, Verbindung abgelehnt), gilt als Fakt.

const UA = 'ServiWeb-ClientMap/1.0 (lokales Akquise-Werkzeug; Kontakt ueber serviweb.ch)';

/** Zeitlimit je Abruf. Zwei Versuche, also hoechstens das Doppelte. */
const TIMEOUT_MS = Math.max(2000, Number(process.env.WEBCHECK_TIMEOUT_MS) || 9000);

/** Mehr liest niemand aus - schuetzt vor Seiten mit 40 MB Inline-Bild. */
const MAX_BYTES = 400_000;

/**
 * Netzwerkfehler, die eine Aussage ueber DIESEN Host erlauben: die Domain
 * gibt es nicht, oder es hoert dort niemand zu.
 *
 * Absichtlich kurz. Nicht dabei sind:
 *   EAI_AGAIN  - heisst woertlich "versuch es nochmal": der Namensdienst hat
 *                nicht geantwortet. Unter acht gleichzeitigen Abrufen kommt
 *                das vor, und einmal hat es hier eine putzmuntere Seite als
 *                "Domain existiert nicht" in die Datenbank geschrieben.
 *   ENETUNREACH / EHOSTUNREACH - meldet fast immer die eigene Leitung. Waere
 *                das ein Befund, wuerde ein WLAN-Aussetzer mitten im Lauf
 *                zweihundert Betriebe auf "kaputt" setzen.
 * Beides bleibt damit ein offener Befund und aendert am Betrieb nichts.
 */
const TOT = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ERR_INVALID_URL']);

/** Fehler, bei denen ein zweiter Versuch ohne HTTPS sinnvoll ist. */
const SSL_FEHLER = /CERT|SSL|TLS|EPROTO|ERR_SSL/i;

const SOZIALE_HOSTS = /(?:^|\.)(facebook|fb|instagram)\.com$/i;

// --- Abruf -----------------------------------------------------------------

/**
 * Holt eine Seite. Gibt niemals einen Fehler weiter, sondern immer einen
 * Befund - der Aufrufer soll nicht zwischen "kaputt" und "abgestuerzt"
 * unterscheiden muessen.
 */
export async function holen(rawUrl) {
  const url = normalisiereUrl(rawUrl);
  if (!url) return { ok: false, tot: true, grund: 'Keine gueltige Adresse' };

  const befund = await zweiVersuche(url);
  if (befund.ok) return befund;

  // HTTPS kaputt, HTTP vielleicht nicht: genau der Fall, den WEBSITE_STATUS
  // mit "kein SSL" meint - und der ohne zweiten Weg als "Seite tot"
  // durchginge.
  if (url.startsWith('https://') && (befund.sslProblem || befund.tot)) {
    const ohneSsl = await zweiVersuche(`http://${url.slice('https://'.length)}`);
    if (ohneSsl.ok) return { ...ohneSsl, ssl: false };
    // Beide Wege tot heisst tot. War nur HTTPS kaputt, ist das kein Beweis
    // fuer Unerreichbarkeit - dann bleibt der Befund offen.
    return befund.tot && ohneSsl.tot ? befund : { ...befund, tot: false };
  }
  return befund;
}

/**
 * Immer zwei Versuche, bevor ein Fehlschlag als Befund gilt.
 *
 * Ein einzelner Fehlschlag beweist nichts: bei acht gleichzeitigen Abrufen
 * verschluckt sich der Namensdienst regelmaessig, und der zweite Versuch
 * bringt dieselbe Seite anstandslos. Das kostet nur dort Zeit, wo es ohnehin
 * schon schiefgegangen ist.
 */
async function zweiVersuche(url) {
  const erster = await einAbruf(url);
  if (erster.ok) return erster;

  // Eine klare Absage des Servers (404, 403) faellt beim zweiten Mal genauso
  // aus. Nur Verbindungsfehler, Drosseln und Serverfehler koennen sich
  // anders entscheiden - und genau die sind es, die sonst Falschmeldungen
  // in die Datenbank schreiben.
  if (erster.antwortet && erster.status < 500 && erster.status !== 429) return erster;

  await new Promise((r) => setTimeout(r, 400));
  return einAbruf(url);
}

async function einAbruf(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-CH,de;q=0.9',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const html = (res.headers.get('content-type') || '').includes('text/')
      ? await textMitDeckel(res)
      : '';
    const ziel = new URL(res.url || url);

    return {
      ok: res.status < 400,
      status: res.status,
      finalUrl: res.url || url,
      host: ziel.hostname.replace(/^www\./, ''),
      ssl: ziel.protocol === 'https:',
      html,
      // Der Server hat geantwortet - was seine Nummer bedeutet, entscheidet
      // beurteilen(). `tot` heisst hier ausschliesslich "keine Verbindung
      // zustande gekommen", sonst wuerde ein 403 vom Bot-Schutz als
      // geschlossener Betrieb in der Datenbank landen.
      antwortet: true,
      tot: false,
      // Wurde die Startseite gefragt oder eine Unterseite? Ein 404 auf einer
      // Unterseite sagt nur, dass die hinterlegte Adresse veraltet ist.
      wurzel: new URL(url).pathname.replace(/\/+$/, '') === '',
      grund: res.status >= 400 ? `HTTP ${res.status}` : null,
    };
  } catch (err) {
    const code = err?.cause?.code || err?.code || '';
    const zeitlimit = err?.name === 'TimeoutError' || code === 'UND_ERR_HEADERS_TIMEOUT';
    return {
      ok: false,
      zeitlimit,
      sslProblem: SSL_FEHLER.test(code) || SSL_FEHLER.test(err?.message || ''),
      tot: TOT.has(code),
      grund: zeitlimit ? 'Keine Antwort innert Zeitlimit' : beschreibe(code, err),
    };
  }
}

function beschreibe(code, err) {
  if (code === 'ENOTFOUND') return 'Domain existiert nicht';
  if (code === 'EAI_AGAIN') return 'Namensauflösung fehlgeschlagen — unklar';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return 'Nicht erreichbar — unklar';
  if (code === 'ECONNREFUSED') return 'Server nimmt keine Verbindung an';
  if (SSL_FEHLER.test(code)) return 'Zertifikat fehlerhaft';
  // Undici meldet vieles nur als "fetch failed". Das im Panel stehen zu
  // lassen waere keine Auskunft - der Code dahinter schon, wenn es einen gibt.
  const roh = (err?.message || '').slice(0, 100);
  if (!roh || roh === 'fetch failed') return `Abruf fehlgeschlagen${code ? ` (${code})` : ''} — unklar`;
  return roh;
}

async function textMitDeckel(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return '';

  const teile = [];
  let groesse = 0;
  try {
    while (groesse < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      teile.push(value);
      groesse += value.length;
    }
  } catch {
    /* Abgerissene Verbindung: was da ist, reicht meistens. */
  }
  await reader.cancel().catch(() => {});

  const buffer = Buffer.concat(teile).subarray(0, MAX_BYTES);
  const zeichensatz = /charset=["']?([\w-]+)/i.exec(res.headers.get('content-type') || '')?.[1];
  try {
    return new TextDecoder(zeichensatz || 'utf-8', { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

export function normalisiereUrl(value) {
  const roh = String(value || '').trim();
  if (!roh) return null;
  const mitProtokoll = /^https?:\/\//i.test(roh) ? roh : `https://${roh}`;
  try {
    const url = new URL(mitProtokoll);
    return url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

// --- Beurteilen ------------------------------------------------------------

/** Zeichen einer Seite, die seit dem Kauf der Domain niemand angefasst hat. */
const BAUSTELLE =
  /(im aufbau|under construction|coming soon|demn(a|ä)chst|platzhalter|diese domain|domain (wurde )?(geparkt|registriert)|parked (domain|free)|default web page|willkommen bei ihrer neuen)/i;

/** Handwerk aus den Neunzigern. */
const ALTZEICHEN = [
  [/<frameset/i, 'Frames'],
  [/<font\b/i, '<font>-Tags'],
  [/<center\b/i, '<center>-Tags'],
  [/\bbgcolor\s*=/i, 'bgcolor-Attribute'],
  [/<marquee/i, 'Lauftext'],
  [/\.swf\b/i, 'Flash'],
  [/jquery[.-]1\.\d/i, 'jQuery 1.x'],
];

/**
 * Macht aus einem Befund einen Website-Zustand.
 *
 * `status: null` heisst: nichts Belastbares herausgekommen - dann wird am
 * Betrieb kein Zustand geaendert. `hart: true` heisst: das ist eine Tatsache
 * aus dem Netz und darf auch ein bestehendes Urteil korrigieren.
 */
export function beurteilen(befund) {
  if (!befund.ok) {
    if (befund.antwortet) return statusUrteil(befund);
    if (befund.tot) {
      return { status: 'kaputt', hart: true, notiz: befund.grund || 'Nicht erreichbar' };
    }
    return { status: null, hart: false, notiz: befund.grund || 'Unklar geblieben' };
  }

  // Eine "Website", die auf eine Facebook-Seite zeigt, ist keine Website.
  if (SOZIALE_HOSTS.test(befund.host)) {
    return {
      status: 'keine',
      hart: true,
      sozial: true,
      notiz: `Leitet auf ${befund.host} weiter — eine eigene Website gibt es nicht`,
    };
  }

  const text = nurText(befund.html);
  if (text.length < 500 && BAUSTELLE.test(text)) {
    return { status: 'kaputt', hart: true, notiz: 'Platzhalter- oder Baustellenseite' };
  }
  if (!befund.html.trim()) {
    return { status: null, hart: false, notiz: 'Erreichbar, aber ohne lesbaren Inhalt' };
  }

  if (!befund.ssl) {
    return { status: 'kaputt', hart: false, notiz: 'Kein HTTPS — Browser warnen davor' };
  }
  if (!/<meta[^>]+name=["']?viewport/i.test(befund.html)) {
    return { status: 'kaputt', hart: false, notiz: 'Nicht für Mobilgeräte gebaut (kein viewport)' };
  }

  const alt = ALTZEICHEN.filter(([muster]) => muster.test(befund.html)).map(([, label]) => label);
  if (alt.length) {
    return { status: 'veraltet', hart: false, notiz: `Alte Bautechnik: ${alt.join(', ')}` };
  }

  // Weiter reicht eine Messung nicht: ob eine erreichbare, mobile Seite
  // "brauchbar" oder "modern und gut" ist, entscheidet ein Blick und kein
  // HTTP-Abruf. Deshalb hoechstens 'ok' - 'gut' bleibt der Analyse.
  return { status: 'ok', hart: false, notiz: 'Erreichbar, HTTPS, mobiltauglich' };
}

/**
 * Was eine Fehlernummer wirklich beweist.
 *
 * Nur die Startseite, die es nicht mehr gibt, ist ein Befund. Alles andere
 * wurde beim ersten Testlauf zur Falschmeldung: 403 war der Bot-Schutz von
 * Cloudflare, 429 eine Drossel, 500 ein Schluckauf (derselbe Server lieferte
 * Sekunden spaeter 200), und ein 404 auf einer Unterseite heisst nur, dass
 * die hinterlegte Adresse veraltet ist - der Betrieb kann eine tadellose
 * Website haben.
 */
function statusUrteil(befund) {
  const code = befund.status;

  if (code === 404 || code === 410) {
    return befund.wurzel
      ? { status: 'kaputt', hart: true, notiz: `Startseite antwortet mit ${code} — dort steht keine Website mehr` }
      : { status: null, hart: false, notiz: `Hinterlegte Unterseite gibt es nicht mehr (${code}) — Adresse prüfen` };
  }
  if (code === 401 || code === 403 || code === 429) {
    return { status: null, hart: false, notiz: `Zugriff blockiert (${code}) — vermutlich Bot-Schutz, unklar` };
  }
  if (code >= 500) {
    return { status: null, hart: false, notiz: `Server meldet Fehler ${code} — unklar` };
  }
  return { status: null, hart: false, notiz: `HTTP ${code} — unklar` };
}

function nurText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Kontakte aus dem HTML -------------------------------------------------

const INSTAGRAM_AUS = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct']);
const FACEBOOK_AUS = new Set(['sharer', 'sharer.php', 'dialog', 'plugins', 'tr', 'share.php', 'profile.php']);

/** Alles, was ohne Deutung aus einer Seite herausfaellt. */
export function kontakteAusHtml(html = '') {
  return {
    phone: telefon(html),
    email: mail(html),
    instagram: instagram(html),
    facebook: facebook(html),
  };
}

function telefon(html) {
  // Ein tel:-Link ist eine Absicht des Betreibers und keine Fundsache -
  // deshalb wird er grosszuegig genommen, auch wenn die Nummer nicht
  // schweizerisch aussieht.
  const ausLink = [...html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)]
    .map((m) => telefonnummer(entschaerft(m[1])))
    .find(Boolean);
  if (ausLink) return ausLink;

  // Im Fliesstext dagegen streng: eine beliebige Zahlenkette waere keine
  // Telefonnummer, sondern Raten. Nur was wie eine Schweizer Nummer aussieht.
  for (const treffer of nurText(html).matchAll(/(?:\+41|0041|0)[\s./-]?\(?0?\)?[1-9][\d\s./-]{7,14}\d/g)) {
    const nummer = schweizerNummer(treffer[0]);
    if (nummer) return nummer;
  }
  return null;
}

/** "+41 (0)71 911 22 33" -> "071 911 22 33". Alles andere faellt raus. */
export function schweizerNummer(roh) {
  let ziffern = String(roh || '').replace(/[^\d+]/g, '');
  if (ziffern.startsWith('0041')) ziffern = `+41${ziffern.slice(4)}`;
  if (ziffern.startsWith('+41')) ziffern = `0${ziffern.slice(3).replace(/^0/, '')}`;
  if (!/^0[1-9]\d{8}$/.test(ziffern)) return null;
  return `${ziffern.slice(0, 3)} ${ziffern.slice(3, 6)} ${ziffern.slice(6, 8)} ${ziffern.slice(8)}`;
}

/**
 * Wie schweizerNummer(), aber auch fuer alles andere brauchbar: der Bestand
 * enthaelt nicht nur Schweizer Betriebe, und eine deutsche Nummer aus einem
 * tel:-Link wegzuwerfen waere Datenverlust ohne Gegenwert.
 */
export function telefonnummer(roh) {
  const schweiz = schweizerNummer(roh);
  if (schweiz) return schweiz;

  const geputzt = String(roh || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  const ziffern = geputzt.replace(/\D/g, '');
  if (ziffern.length < 7 || ziffern.length > 15) return null;
  return geputzt.slice(0, 20);
}

const MAIL_AUS = /(example|domain|ihre-?domain|sentry|wixpress|godaddy)\.|\.(png|jpg|jpeg|gif|webp|svg)$/i;

function mail(html) {
  const kandidaten = [
    ...[...html.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)].map((m) => m[1]),
    ...[...nurText(html).matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0]),
  ];
  for (const roh of kandidaten) {
    const adresse = entschaerft(roh).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(adresse)) continue;
    if (MAIL_AUS.test(adresse)) continue;
    return adresse.slice(0, 200);
  }
  return null;
}

function instagram(html) {
  for (const treffer of html.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/gi)) {
    const handle = treffer[1].replace(/\.+$/, '');
    if (INSTAGRAM_AUS.has(handle.toLowerCase())) continue;
    return handle;
  }
  return null;
}

function facebook(html) {
  for (const treffer of html.matchAll(/(?:facebook|fb)\.com\/([A-Za-z0-9._%-]{2,60})/gi)) {
    const seite = treffer[1].replace(/[.)]+$/, '');
    if (FACEBOOK_AUS.has(seite.toLowerCase())) continue;
    return `https://www.facebook.com/${seite}`;
  }
  return null;
}

/** decodeURIComponent, das an kaputten Prozentzeichen nicht stirbt. */
function entschaerft(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Adresse der Kontakt- oder Impressumsseite, falls die Startseite eine
 * verlinkt. In der Schweiz stehen Telefon und Mail meistens genau dort und
 * nicht auf der Startseite - ein zweiter Abruf verdoppelt die Trefferquote.
 */
export function kontaktseite(html, basis) {
  const muster = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  for (const [, href, beschriftung] of String(html).matchAll(muster)) {
    if (!/(kontakt|impressum|contact|ueber-uns|about)/i.test(`${href} ${nurText(beschriftung)}`)) continue;
    try {
      const ziel = new URL(href, basis);
      if (ziel.hostname !== new URL(basis).hostname) continue;
      if (/\.(pdf|jpg|png|zip)$/i.test(ziel.pathname)) continue;
      return ziel.toString();
    } catch {
      /* kaputter Link, weiter */
    }
  }
  return null;
}
