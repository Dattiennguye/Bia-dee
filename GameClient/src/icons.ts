/** Bộ icon nét mảnh (SVG, kế thừa màu chữ) */
const P: Record<string, string> = {
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16.2h5"/><circle cx="12" cy="3.6" r="1"/>',
  ball: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.4"/><path d="M12 9.2v5.6M10.6 10.4 12 9.2"/>',
  key: '<circle cx="8" cy="14" r="3.6"/><path d="M10.6 11.5 19 3.2M15.5 6.7l2.4 2.4M13.2 9l1.8 1.8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4.6c0 3 1.4 4.4 3.8 4.6M16 6h3.4c0 3-1.4 4.4-3.8 4.6M12 13v3.5M8.5 20h7M9.5 16.5h5V20h-5z"/>',
  book: '<path d="M4.5 5.5c2.8-.9 5.2-.6 7.5 1v12.5c-2.3-1.6-4.7-1.9-7.5-1V5.5ZM19.5 5.5c-2.8-.9-5.2-.6-7.5 1v12.5c2.3-1.6 4.7-1.9 7.5-1V5.5Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  menu: '<path d="M5 7.5h14M5 12h14M5 16.5h14"/>',
  vol: '<path d="M5 9.5h3l4.2-3.5v12L8 14.5H5z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10"/>',
  mute: '<path d="M5 9.5h3l4.2-3.5v12L8 14.5H5z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
  camTop: '<rect x="4" y="6" width="16" height="12" rx="2.5"/><circle cx="12" cy="12" r="1.8"/><path d="M12 3v1.6M12 19.4V21"/>',
  cam3d: '<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M4 8l8 4.5L20 8M12 12.5v8"/>',
  camCue: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
  camFree: '<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20.5 4v4.5H16"/><circle cx="12" cy="12" r="2"/>',
  camFilm: '<rect x="3.5" y="8.5" width="17" height="11" rx="2"/><path d="m3.5 8.5 2-4.2 4 .9-2 4.2M10 5.2l4-.9-2 4.2M14.5 4.3l4 .9-2 3.3"/>',
  back: '<path d="m14.5 5-7 7 7 7"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  exit: '<path d="M10 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H10M14.5 8l4 4-4 4M18.5 12H9"/>',
  hand: '<path d="M8 12V6.5a1.3 1.3 0 0 1 2.6 0V11M10.6 10.5V5a1.3 1.3 0 0 1 2.6 0v5.5M13.2 10.5V6a1.3 1.3 0 0 1 2.6 0v6M15.8 9.5a1.3 1.3 0 0 1 2.6 0V14c0 4-2.2 6-5.4 6-2.4 0-3.6-1-5-3L5 13.5a1.4 1.4 0 0 1 2.2-1.6L8 13"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.9 2-1.8 0-1.4-1.3-1.5-1.3-2.7 0-.9.7-1.5 1.6-1.5H16a4.5 4.5 0 0 0 4.5-4.5C20.5 6.7 16.7 3.5 12 3.5Z"/><circle cx="7.8" cy="11" r=".8"/><circle cx="10.3" cy="7.6" r=".8"/><circle cx="14.4" cy="7.4" r=".8"/>',
  replay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4.5H9"/>',
};

export type IconName = keyof typeof P;

export function ic(name: IconName, size = 22): string {
  return `<svg class="svgi" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}
