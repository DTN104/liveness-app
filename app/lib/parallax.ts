import type { Landmark } from "./challenges";

// Depth-from-motion (3D parallax) helper.
// A real 3D face under camera motion does NOT map onto itself via a single
// similarity transform (near points like the nose shift differently from far
// points like the face silhouette). A flat photo/screen behaves planar, so the
// similarity-fit residual stays near zero. We measure that residual.
const IDX: number[] = [];
for (let i = 0; i < 478; i += 3) IDX.push(i);

export function faceWidth(lm: Landmark[]): number {
  let minX = 1;
  let maxX = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return maxX - minX || 1e-6;
}

function bbox(lm: Landmark[]) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of lm) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX || 1e-6 };
}

// Normalized global motion between two frames (face center shift + size change).
export function globalDisplacement(a: Landmark[], b: Landmark[]): number {
  const ca = bbox(a);
  const cb = bbox(b);
  const d = Math.hypot(cb.cx - ca.cx, cb.cy - ca.cy) + Math.abs(cb.w - ca.w);
  return d / ca.w;
}

function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-9;
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c < 5; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [0, 1, 2, 3].map((i) => M[i][4] / (M[i][i] || 1e-9));
}

// Least-squares similarity transform from->to; returns normalized RMS residual.
// Low  => planar/flat (photo or screen).  In a healthy band => real 3D face.
export function similarityResidual(from: Landmark[], to: Landmark[]): number {
  let Sxx = 0, Sx = 0, Sy = 0, SX = 0, SY = 0, SxXyY = 0, SxYmyX = 0;
  const n = IDX.length;
  for (const i of IDX) {
    const x = from[i].x, y = from[i].y, X = to[i].x, Y = to[i].y;
    Sxx += x * x + y * y;
    Sx += x;
    Sy += y;
    SX += X;
    SY += Y;
    SxXyY += x * X + y * Y;
    SxYmyX += x * Y - y * X;
  }
  const A = [
    [Sxx, 0, Sx, Sy],
    [0, Sxx, -Sy, Sx],
    [Sx, -Sy, n, 0],
    [Sy, Sx, 0, n],
  ];
  const [a, b, tx, ty] = solve4(A, [SxXyY, SxYmyX, SX, SY]);
  let sum = 0;
  for (const i of IDX) {
    const x = from[i].x, y = from[i].y;
    const px = a * x - b * y + tx;
    const py = b * x + a * y + ty;
    sum += (px - to[i].x) ** 2 + (py - to[i].y) ** 2;
  }
  return Math.sqrt(sum / n) / faceWidth(from);
}
