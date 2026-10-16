import { useEffect, useRef, useState } from "react";
import { CONFIG } from "~/lib/config";
import {
  pickChallenges,
  computeYaw,
  type Blendshapes,
  type Challenge,
  type Landmark,
} from "~/lib/challenges";
import { similarityResidual, globalDisplacement } from "~/lib/parallax";
import { saveCapture } from "~/lib/captureStore";

type Status = "loading" | "ready" | "error";

interface EngineState {
  landmarker: any;
  lastVideoTime: number;
  loopRunning: boolean;
  queue: Challenge[];
  current: Challenge | null;
  confirmCount: number;
  challengeStart: number;
  scanActive: boolean;
  bs: Blendshapes;
  yaw: number;
  captureOn: boolean;
  parallaxSamples: Landmark[][];
  parallaxMotion: number;
  parallaxResidual: number;
}

export function LivenessScanner({ onCaptureSaved }: { onCaptureSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const lastBadge = useRef("");
  const lastFaceOk = useRef(false);

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [badge, setBadge] = useState("camera off");
  const [faceOk, setFaceOk] = useState(false);
  const [instruction, setInstruction] = useState("Tap Start to begin");
  const [hint, setHint] = useState("Center your face in the oval, in good light");
  const [doneCount, setDoneCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scanning, setScanning] = useState(false);
  const [captureOn, setCaptureOn] = useState(true);
  const [result, setResult] = useState<null | { pass: boolean; title: string; meta: string }>(null);

  const engine = useRef<EngineState>({
    landmarker: null,
    lastVideoTime: -1,
    loopRunning: false,
    queue: [],
    current: null,
    confirmCount: 0,
    challengeStart: 0,
    scanActive: false,
    bs: {},
    yaw: 0,
    captureOn: true,
    parallaxSamples: [],
    parallaxMotion: 0,
    parallaxResidual: 0,
  });

  function faceBigEnough(lm: Landmark[]): boolean {
    const xs = lm.map((p) => p.x);
    return Math.max(...xs) - Math.min(...xs) >= CONFIG.minFaceWidth;
  }

  function updateDebug(lm: Landmark[] | null, ok: boolean) {
    const e = engine.current;
    const f = (n: string) => (e.bs[n] != null ? e.bs[n].toFixed(2) : "—");
    if (debugRef.current) {
      debugRef.current.textContent =
        `face: ${lm ? "yes" : "no"}  locked: ${ok ? "yes" : "no"}\n` +
        `yaw proxy: ${e.yaw.toFixed(3)}  (thr ±${CONFIG.yaw})\n` +
        `eyeBlink L/R: ${f("eyeBlinkLeft")} / ${f("eyeBlinkRight")}  (thr ${CONFIG.blink})\n` +
        `jawOpen: ${f("jawOpen")}  (thr ${CONFIG.jawOpen})\n` +
        `smile L/R: ${f("mouthSmileLeft")} / ${f("mouthSmileRight")}  (thr ${CONFIG.smile})\n` +
        `depth: motion ${e.parallaxMotion.toFixed(3)} (min ${CONFIG.parallaxMinMotion})  residual ${e.parallaxResidual.toFixed(4)} (band ${CONFIG.parallaxResidualFloor}–${CONFIG.parallaxResidualCeil})\n` +
        `challenge: ${e.current ? e.current.id : "none"}  confirm: ${e.confirmCount}/${e.current ? e.current.need : 0}`;
    }
  }

  function nextChallenge() {
    const e = engine.current;
    e.current = e.queue.shift() ?? null;
    e.confirmCount = 0;
    e.challengeStart = performance.now();
    e.parallaxSamples = [];
    e.parallaxMotion = 0;
    e.parallaxResidual = 0;
    if (e.current) {
      setInstruction(e.current.label);
      setHint(e.current.hint);
    }
    if (timerRef.current) timerRef.current.style.width = "100%";
  }

  function advance() {
    const e = engine.current;
    e.current = null;
    e.confirmCount = 0;
    setDoneCount((d) => {
      const nd = d + 1;
      if (e.queue.length === 0) {
        pass();
        setActiveIndex(-1);
      } else {
        setActiveIndex(nd);
        nextChallenge();
      }
      return nd;
    });
  }

  function pass() {
    const e = engine.current;
    e.scanActive = false;
    setScanning(false);
    setInstruction("Scan complete");
    setHint("");
    if (timerRef.current) timerRef.current.style.width = "0%";
    setResult({
      pass: true,
      title: "✓ Liveness verified",
      meta: "All challenges passed — challenge–response plus depth-from-motion (anti-photo).",
    });
    if (e.captureOn && videoRef.current) {
      saveCapture(videoRef.current).then((ok) => {
        if (ok) {
          setResult((r) =>
            r ? { ...r, meta: r.meta + " Capture saved on this device only." } : r
          );
          onCaptureSaved();
        }
      });
    }
  }

  function fail(reason: string) {
    const e = engine.current;
    e.scanActive = false;
    e.current = null;
    setScanning(false);
    setInstruction("Scan failed");
    setHint("");
    if (timerRef.current) timerRef.current.style.width = "0%";
    setResult({ pass: false, title: "✗ Not verified", meta: reason + ". Try again in better light." });
  }

  function processFrame(res: any) {
    const e = engine.current;
    const lm: Landmark[] | undefined = res.faceLandmarks && res.faceLandmarks[0];
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const set: Blendshapes = {};
    if (res.faceBlendshapes && res.faceBlendshapes[0]) {
      for (const c of res.faceBlendshapes[0].categories) set[c.categoryName] = c.score;
    }
    e.bs = set;
    e.yaw = lm ? computeYaw(lm) : 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (lm) {
      ctx.fillStyle = "rgba(0,229,155,0.55)";
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const ok = !!lm && faceBigEnough(lm);
    if (ok !== lastFaceOk.current) {
      lastFaceOk.current = ok;
      setFaceOk(ok);
    }
    const badgeText = !lm ? "no face" : ok ? "face locked" : "move closer";
    if (badgeText !== lastBadge.current) {
      lastBadge.current = badgeText;
      setBadge(badgeText);
    }
    updateDebug(lm ?? null, ok);

    if (!e.scanActive || !e.current) return;

    const elapsed = performance.now() - e.challengeStart;
    const windowMs =
      e.current.id === "parallax" ? CONFIG.parallaxWindowMs : CONFIG.challengeTimeoutMs;
    if (timerRef.current) {
      timerRef.current.style.width = Math.max(0, 100 - (elapsed / windowMs) * 100) + "%";
    }
    if (elapsed > CONFIG.challengeTimeoutMs) {
      fail("Timed out on: " + e.current.label);
      return;
    }

    // Depth-from-motion: collect landmark poses across a time window, then judge
    // whether the face deforms like a real 3D object (parallax) or a flat plane.
    if (e.current.id === "parallax") {
      if (ok) e.parallaxSamples.push(lm!);
      const s = e.parallaxSamples;
      if (s.length >= 2) {
        let peak = 0;
        let peakIdx = 0;
        for (let i = 1; i < s.length; i++) {
          const d = globalDisplacement(s[0], s[i]);
          if (d > peak) {
            peak = d;
            peakIdx = i;
          }
        }
        e.parallaxMotion = peak;
        e.parallaxResidual = similarityResidual(s[0], s[peakIdx]);
      }
      if (elapsed >= CONFIG.parallaxWindowMs) {
        if (s.length < 2) {
          fail("Couldn't track your face while moving");
        } else if (e.parallaxMotion < CONFIG.parallaxMinMotion) {
          fail("Not enough motion to judge depth — move the phone slowly side to side");
        } else if (e.parallaxResidual < CONFIG.parallaxResidualFloor) {
          fail("No depth detected — looks flat (photo or screen)");
        } else if (e.parallaxResidual > CONFIG.parallaxResidualCeil) {
          fail("Too shaky to judge depth — move more slowly and steadily");
        } else {
          advance();
        }
      }
      return;
    }

    if (!ok) {
      e.confirmCount = 0;
      return;
    }
    if (e.current.detect(lm!, e.bs)) {
      e.confirmCount++;
      if (e.confirmCount >= e.current.need) advance();
    } else {
      e.confirmCount = Math.max(0, e.confirmCount - 1);
    }
  }

  function loop() {
    const e = engine.current;
    if (!e.loopRunning) return;
    const video = videoRef.current;
    if (video && e.landmarker && video.currentTime !== e.lastVideoTime) {
      e.lastVideoTime = video.currentTime;
      const res = e.landmarker.detectForVideo(video, performance.now());
      processFrame(res);
    }
    requestAnimationFrame(loop);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
        const fileset = await FilesetResolver.forVisionTasks(CONFIG.wasmDir);
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: CONFIG.modelUrl, delegate: "GPU" },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1,
        });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          landmarker.close();
          return;
        }
        engine.current.landmarker = landmarker;
        const video = videoRef.current!;
        video.srcObject = stream;
        await new Promise((res) => {
          video.onloadedmetadata = () => res(null);
        });
        await video.play();
        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        engine.current.loopRunning = true;
        setStatus("ready");
        loop();
      } catch (err: any) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err && err.message ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      engine.current.loopRunning = false;
      const video = videoRef.current;
      const stream = video && video.srcObject;
      if (stream) (stream as MediaStream).getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startScan() {
    const e = engine.current;
    if (!e.landmarker) return;
    e.queue = pickChallenges();
    e.scanActive = true;
    e.confirmCount = 0;
    setResult(null);
    setScanning(true);
    setDoneCount(0);
    setTotal(e.queue.length);
    setActiveIndex(0);
    nextChallenge();
  }

  function reset() {
    const e = engine.current;
    e.scanActive = false;
    e.current = null;
    e.queue = [];
    e.confirmCount = 0;
    e.parallaxSamples = [];
    e.parallaxMotion = 0;
    e.parallaxResidual = 0;
    setResult(null);
    setScanning(false);
    setDoneCount(0);
    setTotal(0);
    setActiveIndex(-1);
    setInstruction("Tap Start to begin");
    setHint("Center your face in the oval, in good light");
    if (timerRef.current) timerRef.current.style.width = "100%";
  }

  const startLabel =
    status === "loading" ? "Loading model…" : status === "error" ? "Unavailable" : scanning ? "Scanning…" : "Start scan";

  return (
    <div className="card">
      <div className="stage">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        <div className={"guide" + (faceOk ? " ok" : "")} />
        <div className="badge">{badge}</div>
      </div>

      <div className="challenge">
        <div className="big">{instruction}</div>
        <div className="sub">{hint}</div>
        <div className="dots">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={"dot" + (i < doneCount ? " done" : i === activeIndex ? " active" : "")}
            />
          ))}
        </div>
        <div className="timer">
          <div ref={timerRef} style={{ width: "100%" }} />
        </div>
      </div>

      {result && (
        <div className={"result show " + (result.pass ? "pass" : "fail")}>
          <div className="title">{result.title}</div>
          <div className="meta">{result.meta}</div>
        </div>
      )}

      {status === "error" && (
        <div className="banner err">
          <b>Could not start:</b> {errorMsg}
          {!window.isSecureContext && (
            <>
              <br />
              This is usually because the page isn't served over <code>localhost</code>/HTTPS.
            </>
          )}
        </div>
      )}

      <div style={{ height: 14 }} />
      <div className="row">
        <button onClick={startScan} disabled={status !== "ready" || scanning}>
          {startLabel}
        </button>
        {result && (
          <button className="ghost" onClick={reset}>
            Run again
          </button>
        )}
      </div>

      <label className="captoggle">
        <input
          type="checkbox"
          checked={captureOn}
          onChange={(ev) => {
            setCaptureOn(ev.target.checked);
            engine.current.captureOn = ev.target.checked;
          }}
        />
        <span>Save a capture on this device when verified</span>
      </label>
      <div className="capnote">
        Captures are stored only in this browser (IndexedDB) and never uploaded. Delete them anytime below.
      </div>

      <details>
        <summary>Show live signal debug</summary>
        <pre ref={debugRef} className="debug">
          waiting for camera…
        </pre>
      </details>
    </div>
  );
}
