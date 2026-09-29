// 內建線條圖示(currentColor)。只放靜態字串,可安全用於 h(..., { html })。
const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  compass: svg('<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>'),
  home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>'),
  plan: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h8M12 4v16M16 12v8"/>'),
  coin: svg('<circle cx="12" cy="12" r="9"/><rect x="9.2" y="9.2" width="5.6" height="5.6" rx=".6"/>'),
  doc: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
  // 8 齒的齒輪(舊版的放射線看起來像太陽/亮度,長輩不會想到是設定)
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M9.3 4.9L10.0 2.2L14.0 2.2L14.7 4.9L15.1 5.1L17.5 3.7L20.3 6.5L18.9 8.9L19.1 9.3L21.8 10.0L21.8 14.0L19.1 14.7L18.9 15.1L20.3 17.5L17.5 20.3L15.1 18.9L14.7 19.1L14.0 21.8L10.0 21.8L9.3 19.1L8.9 18.9L6.5 20.3L3.7 17.5L5.1 15.1L4.9 14.7L2.2 14.0L2.2 10.0L4.9 9.3L5.1 8.9L3.7 6.5L6.5 3.7L8.9 5.1Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-1.9"/>'),
  crosshair: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'),
  phone: svg('<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>'),
  trash: svg('<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>'),
  edit: svg('<path d="M4 20l1-4 11-11 3 3L8 19z"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>'),
  share: svg('<path d="M12 15V3M8 7l4-4 4 4"/><path d="M5 12v7h14v-7"/>'),
  door: svg('<path d="M6 21V4h9l3 2v15"/><path d="M4 21h16M13 12v.01"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
};
