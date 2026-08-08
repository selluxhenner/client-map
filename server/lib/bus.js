// Ein einziger Ereignisstrom fuer alles, was laenger dauert als eine
// Anfrage: Agenten-Aufträge und Bereichssuchen.
//
// Bewusst eine eigene Datei und nicht in der Queue: die Bereichssuche hat
// mit Aufträgen nichts zu tun, soll aber im selben SSE-Kanal landen. Sonst
// braeuchte die Oberflaeche eine zweite Verbindung fuer dasselbe Bedürfnis.

import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Kurzform, damit Aufrufer nicht ueberall 'event' tippen muessen. */
export function publish(payload) {
  bus.emit('event', payload);
}
