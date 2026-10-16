import { CONFIG } from "./config";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Blendshapes = Record<string, number>;

export interface Challenge {
  id: string;
  label: string;
  hint: string;
  need: number;
  detect: (lm: Landmark[], bs: Blendshapes) => boolean;
}

// Yaw proxy: horizontal offset of the nose tip from the face midline,
// normalized by face width. Coordinates are mirrored (x -> 1-x) so
// "left"/"right" match what the user sees in the selfie view.
export function computeYaw(lm: Landmark[]): number {
  const nx = 1 - lm[1].x;
  const lx = 1 - lm[234].x;
  const rx = 1 - lm[454].x;
  const mid = (lx + rx) / 2;
  const width = Math.abs(rx - lx) || 1e-6;
  return (nx - mid) / width;
}

function headTurn(lm: Landmark[], dir: "left" | "right"): boolean {
  const yaw = computeYaw(lm);
  return dir === "left" ? yaw < -CONFIG.yaw : yaw > CONFIG.yaw;
}

export const CHALLENGES: Challenge[] = [
  {
    id: "blink",
    label: "Blink your eyes",
    hint: "A quick natural blink",
    need: 1,
    detect: (_lm, bs) => (bs.eyeBlinkLeft ?? 0) > CONFIG.blink || (bs.eyeBlinkRight ?? 0) > CONFIG.blink,
  },
  {
    id: "mouth",
    label: "Open your mouth",
    hint: "Open clearly, then close",
    need: CONFIG.confirmFrames,
    detect: (_lm, bs) => (bs.jawOpen ?? 0) > CONFIG.jawOpen,
  },
  {
    id: "smile",
    label: "Smile",
    hint: "A big natural smile",
    need: CONFIG.confirmFrames,
    detect: (_lm, bs) => ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2 > CONFIG.smile,
  },
  {
    id: "left",
    label: "Turn your head LEFT",
    hint: "Slowly turn to your left",
    need: CONFIG.confirmFrames,
    detect: (lm) => headTurn(lm, "left"),
  },
  {
    id: "right",
    label: "Turn your head RIGHT",
    hint: "Slowly turn to your right",
    need: CONFIG.confirmFrames,
    detect: (lm) => headTurn(lm, "right"),
  },
  {
    // Handled specially by the scanner (time-window depth-from-motion), not by detect().
    id: "parallax",
    label: "Move your phone slowly side to side",
    hint: "Keep your face in the oval while moving",
    need: 0,
    detect: () => false,
  },
];

// Every scan includes blink + one head turn + the parallax depth check,
// plus one random blendshape challenge for variety.
export function pickChallenges(): Challenge[] {
  const turn = Math.random() < 0.5 ? "left" : "right";
  const must = ["blink", turn, "parallax"];
  const pool = CHALLENGES.map((c) => c.id).filter((id) => !must.includes(id));
  const extra = pool[Math.floor(Math.random() * pool.length)];
  const ids = [...must, extra].sort(() => Math.random() - 0.5);
  return ids.map((id) => CHALLENGES.find((c) => c.id === id)!);
}
