// Gemeinsamer Zustand von Karte und Liste.
//
// Der Filter ist bewusst nichts anderes als ein URLSearchParams-Objekt: so
// ist ein gespeicherter Filter einfach eine Query-Zeichenkette, die Adresse
// im Browser ist teilbar, und Zurueck im Browser funktioniert von selbst.

import { get } from './api.js';

export const state = {
  config: null,
  filter: new URLSearchParams(location.search),
  venues: [],
  total: 0,
  selectedId: null,
  // Die Abfrage, mit der die aktuell gezeigten Betriebe geladen wurden -
  // inklusive des Kartenausschnitts, der nicht im Filter steht. Alles, was
  // Zahlen zu diesen Betrieben anzeigt, muss dieselbe Abfrage benutzen, sonst
  // stehen links andere Werte als auf der Karte.
  lastQuery: '',
};

const listeners = { filter: [], venues: [], selection: [] };

export function on(event, fn) {
  listeners[event].push(fn);
  return fn;
}

function emit(event, payload) {
  listeners[event].forEach((fn) => fn(payload));
}

export async function loadConfig() {
  state.config = await get('/config');
  return state.config;
}

export function filterValue(key) {
  return state.filter.get(key) || '';
}

export function filterList(key) {
  const raw = state.filter.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

export function setFilter(key, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) {
    state.filter.delete(key);
  } else {
    state.filter.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  syncUrl();
  emit('filter');
}

export function toggleInFilter(key, value) {
  const current = filterList(key);
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  setFilter(key, next);
}

export function replaceFilter(query) {
  // bbox gehoert der Karte, nicht dem gespeicherten Filter - sonst wuerde
  // ein Filterklick den Kartenausschnitt einfrieren.
  const bbox = state.filter.get('bbox');
  state.filter = new URLSearchParams(query);
  if (bbox) state.filter.set('bbox', bbox);
  syncUrl();
  emit('filter');
}

export function clearFilter() {
  replaceFilter('');
}

/** Filter ohne die kartenspezifischen Teile - das, was man speichern will. */
export function savableQuery() {
  const copy = new URLSearchParams(state.filter);
  copy.delete('bbox');
  copy.delete('sort');
  return copy.toString();
}

function syncUrl() {
  const query = state.filter.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}

export async function loadVenues(extra = {}) {
  const query = new URLSearchParams(state.filter);
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === '') query.delete(key);
    else query.set(key, value);
  }
  state.lastQuery = query.toString();
  const data = await get(`/venues?${query}`);
  state.venues = data.venues;
  state.total = data.total;
  emit('venues', data);
  return data;
}

export function select(id) {
  state.selectedId = id;
  emit('selection', id);
}

export function venueById(id) {
  return state.venues.find((v) => v.id === id);
}

export function upsertLocal(venue) {
  const index = state.venues.findIndex((v) => v.id === venue.id);
  if (index >= 0) state.venues[index] = venue;
  return venue;
}

export function scoreBandFor(score) {
  return state.config.scoreBands.find((b) => score >= b.min) ?? state.config.scoreBands.at(-1);
}
