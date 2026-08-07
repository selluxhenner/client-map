// Duenne Schicht ueber fetch plus ein paar DOM-Helfer, die in allen
// Ansichten gebraucht werden.

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });

/** el('div', {class: 'x', onclick: fn}, ['Text', childEl]) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

let toastHost;
export function toast(message, kind = '') {
  toastHost ||= document.body.appendChild(el('div', { class: 'toast-host' }));
  const node = el('div', { class: `toast ${kind}` }, message);
  toastHost.append(node);
  setTimeout(() => node.remove(), kind === 'err' ? 6000 : 2800);
}

export const fail = (err) => toast(err.message || String(err), 'err');

export function debounce(fn, ms = 350) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Textfarbe, die auf der jeweiligen Pin-Farbe noch lesbar ist. */
export function isLight(hex) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.replace(/./g, '$&$&') : c, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.68;
}

export function formatDate(value) {
  if (!value) return '–';
  const d = new Date(value.replace(' ', 'T'));
  return Number.isNaN(+d) ? value : d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
