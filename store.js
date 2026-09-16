export const KEY = 'prayers';

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === 1 && Array.isArray(d.prayers)) return d;
    }
  } catch {}
  return { version: 1, prayers: [] };
}

export function save(storage, store) {
  storage.setItem(KEY, JSON.stringify(store));
}

export function add(store, text, source, now = new Date(), id = crypto.randomUUID()) {
  const prayer = {
    id,
    createdAt: now.toISOString(),
    original: text.trim(),
    refined: null,
    refinedAt: null,
    showing: 'original',
    source,
  };
  return { ...store, prayers: [prayer, ...store.prayers] };
}

export function remove(store, id) {
  return { ...store, prayers: store.prayers.filter(p => p.id !== id) };
}

export function shownText(p) {
  return p.showing === 'refined' && p.refined != null ? p.refined : p.original;
}

export function toggleShowing(store, id) {
  return {
    ...store,
    prayers: store.prayers.map(p => {
      if (p.id !== id || p.refined == null) return p;
      return { ...p, showing: p.showing === 'refined' ? 'original' : 'refined' };
    }),
  };
}

export function exportJSON(store) {
  return JSON.stringify(store, null, 2);
}

export function formatDate(iso, now = new Date()) {
  const d = new Date(iso);
  const h = d.getHours();
  const part = h < 5 ? '밤' : h < 11 ? '아침' : h < 17 ? '낮' : h < 21 ? '저녁' : '밤';
  const year = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}년 `;
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 ${part}`;
}
