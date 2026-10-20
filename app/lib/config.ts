export const CONFIG = {
  modelUrl: "/models/face_landmarker.task",
  wasmDir: "/wasm",
  numChallenges: 4,
  challengeTimeoutMs: 8000,
  confirmFrames: 3,
  blink: 0.5,
  jawOpen: 0.5,
  smile: 0.35,
  yaw: 0.06,
  minFaceWidth: 0.18,
  // Depth-from-motion (parallax) tuning
  parallaxWindowMs: 2500,     // how long the parallax challenge samples
  parallaxMinMotion: 0.10,    // min normalized face displacement required
  parallaxResidualFloor: 0.004, // below => planar/flat (photo or screen)
  parallaxResidualCeil: 0.10,  // above => too shaky / tracking noise
  // Face verification (1:1 identity) tuning
  faceApiModelDir: "/models/face-api", // self-hosted face-api weights
  matchThreshold: 0.5,        // Euclidean distance below this => same person
};
