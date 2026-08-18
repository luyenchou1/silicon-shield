// Hex-grid math. Pointy-top hexes, "odd-r" offset coordinates (odd rows are
// shifted +half hex in x). All game logic addresses hexes as {c, r} (col, row).

export const SQRT3 = Math.sqrt(3);
export const HEX = 1.0; // hex size (center to corner) in world units

export function key(c, r) { return c + ',' + r; }

export function offsetToAxial(c, r) {
  return { q: c - ((r - (r & 1)) >> 1), r };
}

export function axialToOffset(q, r) {
  return { c: q + ((r - (r & 1)) >> 1), r };
}

export function worldPos(c, r) {
  return {
    x: HEX * SQRT3 * (c + 0.5 * (r & 1)),
    z: HEX * 1.5 * r,
  };
}

// world x/z -> nearest hex offset coords
export function worldToHex(x, z) {
  const q = (SQRT3 / 3 * x - z / 3) / HEX;
  const r = (2 / 3 * z) / HEX;
  return axialToOffset(...Object.values(axialRound(q, r)));
}

function axialRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexDist(a, b) {
  const A = offsetToAxial(a.c, a.r), B = offsetToAxial(b.c, b.r);
  const dq = A.q - B.q, dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const EVEN_N = [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]];
const ODD_N = [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]];

export function neighbors(c, r) {
  const dirs = (r & 1) ? ODD_N : EVEN_N;
  return dirs.map(([dc, dr]) => ({ c: c + dc, r: r + dr }));
}

// All hexes within `n` of origin (excluding origin), unfiltered by map bounds.
export function hexesInRange(c, r, n) {
  const out = [];
  const { q: q0, r: r0 } = offsetToAxial(c, r);
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      if (dq === 0 && dr === 0) continue;
      const off = axialToOffset(q0 + dq, r0 + dr);
      out.push(off);
    }
  }
  return out;
}
