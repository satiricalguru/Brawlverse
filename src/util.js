// Helpers shared by the scroll-driven scenes: easing, section progress and
// scrolling to a point inside a pinned section.

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

// smoothstep: 0 at a, 1 at b, eased in between
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// progress of a tall section with a sticky child: 0 when its top hits the viewport top, 1 when its bottom hits the bottom
export const sectionProgress = (el) => {
  const r = el.getBoundingClientRect();
  return clamp01(-r.top / Math.max(1, r.height - innerHeight));
};

// scroll to a point inside a pinned section
export const scrollToProgress = (el, p, reduced = false) => {
  const top = el.getBoundingClientRect().top + scrollY;
  window.scrollTo({ top: top + p * (el.offsetHeight - innerHeight), behavior: reduced ? 'auto' : 'smooth' });
};

// true while any part of the element is on screen
export const onScreen = (el) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
};

// build an element from plain text (never parsed as HTML)
export const textEl = (tag, cls = '', text = '', attrs = {}) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
