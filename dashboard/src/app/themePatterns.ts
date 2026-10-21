/**
 * Cultural patterns a member theme can carry (Theme Studio). Same keys as app/accounts/member_themes.py THEME_PATTERNS.
 * Each pattern is an original vector tile, drawn here so it stays sharp and weighs a few hundred bytes. It is placed in
 * a few calm spots only (member.css, "Theme patterns"): a band under the top bar, the sidebar header, a ribbon above
 * the chat welcome and the edge of cards. Never behind chat messages, product grids or forms.
 */
export type ThemePattern = "none" | "ankara" | "ghana-must-go";
export type PatternStrength = "subtle" | "bold";

export const THEME_PATTERNS: { key: ThemePattern; label: string; note: string }[] = [
  { key: "none", label: "No pattern", note: "Colours only" },
  { key: "ankara", label: "Ankara", note: "Kente-style steps and stripes" },
  { key: "ghana-must-go", label: "Ghana Must Go", note: "Red, black and white plaid" },
];

/** Stepped triangle (Kente style). Right angle at the bottom-left, or at the top-right when flipped; the long side
 * is a staircase of n steps. */
function steps(x: number, y: number, size: number, n: number, fill: string, flip = false) {
  const s = size / n;
  let d = flip ? `M${x} ${y} H${x + size} V${y + size}` : `M${x} ${y} V${y + size} H${x + size}`;
  for (let i = 0; i < n; i += 1) d += flip ? ` h-${s} v-${s}` : ` v-${s} h-${s}`;
  return `<path d="${d} Z" fill="${fill}"/>`;
}

// Repeating fills are SVG <pattern>s, so the tile stays small.
let fills = "";
const used = new Set<string>();
function fillId(id: string, def: string) {
  if (!used.has(id)) {
    used.add(id);
    fills += def;
  }
  return `url(#${id})`;
}

function stripes(x: number, y: number, w: number, h: number, gap: number, color: string, horizontal = true, offset = 1) {
  const id = `s${horizontal ? "h" : "v"}${gap}-${offset}${color.slice(1)}`;
  const def = horizontal
    ? `<pattern id="${id}" width="8" height="${gap}" patternUnits="userSpaceOnUse"><rect y="${offset}" width="8" height="1.2" fill="${color}"/></pattern>`
    : `<pattern id="${id}" width="${gap}" height="8" patternUnits="userSpaceOnUse"><rect x="${offset}" width="1.6" height="8" fill="${color}"/></pattern>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillId(id, def)}"/>`;
}

function dots(x: number, y: number, w: number, h: number, color: string) {
  const id = `d${color.slice(1)}`;
  const def = `<pattern id="${id}" width="6" height="12" patternUnits="userSpaceOnUse"><rect x="3" y="3" width="2.4" height="2.4" fill="${color}"/><rect x="0" y="9" width="2.4" height="2.4" fill="${color}"/></pattern>`;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fillId(id, def)}"/>`;
}

/** Ankara / Kente: orange woven ground, green and blue stepped triangles, striped and dotted strips, white seams. */
function ankaraSvg() {
  const orange = "#E8731A";
  const red = "#B83A14";
  const blue = "#2B3FD6";
  const green = "#17694A";
  const black = "#2A1A12";
  let body = `<rect width="160" height="160" fill="${orange}"/>`;
  body += stripes(0, 0, 160, 160, 4, red);
  // Row 1: triangles block, then a striped column block.
  body += steps(8, 8, 32, 4, green) + steps(40, 8, 32, 4, blue, true);
  body += steps(8, 40, 32, 4, blue, true) + steps(40, 40, 32, 4, green);
  body += `<rect x="80" y="0" width="80" height="80" fill="${orange}"/>` + stripes(80, 0, 80, 80, 7, blue, false, 1) + stripes(80, 0, 80, 80, 7, red, false, 4);
  body += `<rect x="80" y="34" width="80" height="12" fill="${orange}"/>` + dots(80, 34, 80, 12, black);
  // Row 2: dotted block, then mirrored triangles.
  body += `<rect x="0" y="80" width="80" height="80" fill="${red}"/>` + dots(0, 80, 80, 80, black) + `<rect x="0" y="112" width="80" height="16" fill="${blue}"/>` + stripes(0, 112, 80, 16, 4, orange);
  body += steps(88, 88, 32, 4, blue) + steps(120, 88, 32, 4, green, true) + steps(88, 120, 32, 4, green, true) + steps(120, 120, 32, 4, blue);
  // White seams between the woven strips.
  body += `<rect x="79" y="0" width="2" height="160" fill="#FFF8EE"/><rect x="0" y="79" width="160" height="2" fill="#FFF8EE"/><rect x="0" y="159" width="160" height="1" fill="#FFF8EE"/><rect x="159" y="0" width="1" height="160" fill="#FFF8EE"/>`;
  const defs = `<defs>${fills}</defs>`;
  fills = "";
  used.clear();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" shape-rendering="crispEdges">${defs}${body}</svg>`;
}

/** Ghana Must Go: a mostly white woven ground with checkered black bands and thin red lines crossing both ways. */
function ghanaSvg() {
  const black = "#161616";
  const red = "#C8102E";
  const W = 64;
  const defs =
    `<defs><pattern id="v" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="1.6" height="2.4" fill="${black}" fill-opacity="0.85"/><rect x="2" y="2" width="1.6" height="2.4" fill="${black}" fill-opacity="0.85"/></pattern>` +
    `<pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="2.4" height="1.6" fill="${black}" fill-opacity="0.85"/><rect x="2" y="2" width="2.4" height="1.6" fill="${black}" fill-opacity="0.85"/></pattern></defs>`;
  const band = (at: number, size: number) =>
    `<rect x="${at}" y="0" width="${size}" height="${W}" fill="url(#v)"/><rect x="0" y="${at}" width="${W}" height="${size}" fill="url(#h)"/>`;
  const line = (at: number, size: number, color: string, opacity = 0.9) =>
    `<rect x="${at}" y="0" width="${size}" height="${W}" fill="${color}" fill-opacity="${opacity}"/><rect x="0" y="${at}" width="${W}" height="${size}" fill="${color}" fill-opacity="${opacity}"/>`;
  const body = `<rect width="${W}" height="${W}" fill="#FBFBF8"/>` + band(4, 10) + band(36, 10) +
    line(18, 1.6, black) + line(22, 1.6, red) + line(27, 1.2, red, 0.75) + line(50, 1.6, red) + line(56, 1.6, black);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}" shape-rendering="crispEdges">${defs}${body}</svg>`;
}

const cache: Partial<Record<ThemePattern, string>> = {};

/** CSS url() of the pattern tile, or "" for none. */
export function patternImage(key: string | null | undefined): string {
  const pattern = (THEME_PATTERNS.find((p) => p.key === key)?.key || "none") as ThemePattern;
  if (pattern === "none") return "";
  if (!cache[pattern]) {
    const svg = pattern === "ankara" ? ankaraSvg() : ghanaSvg();
    cache[pattern] = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
  }
  return cache[pattern] as string;
}

/** Tile size on screen, so the motifs read at a glance without getting busy. */
export function patternSize(key: string | null | undefined): string {
  return key === "ghana-must-go" ? "48px 48px" : "96px 96px";
}

export function themePattern(key: string | null | undefined) {
  return THEME_PATTERNS.find((p) => p.key === key) || THEME_PATTERNS[0];
}
