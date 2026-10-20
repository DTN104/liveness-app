import { useEffect, useState } from "react";
import { CONFIG } from "~/lib/config";
import { enroll, verify, getTemplate, deleteTemplate, loadFaceApi } from "~/lib/faceAuth";

type Msg = { kind: "info" | "pass" | "fail"; text: string } | null;

// Reuses the scanner's live <video> element (passed by ref) so we don't open a
// second camera stream. Enroll once, then Verify: same person => PASS.
export function FaceAuthPanel({
  videoRef,
  ready,
}: {
  videoRef: { current: HTMLVideoElement | null };
  ready: boolean;
}) {
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => {
    let alive = true;
    getTemplate()
      .then((t) => alive && setEnrolled(!!t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function ensureModel() {
    setMsg({ kind: "info", text: "Loading face-recognition model (first time only, ~7 MB)…" });
    await loadFaceApi();
  }

  function cameraReady(): boolean {
    const v = videoRef.current;
    if (!ready || !v || v.readyState < 2 || !v.videoWidth) {
      setMsg({ kind: "fail", text: "Camera not ready yet — wait for the preview, then retry." });
      return false;
    }
    return true;
  }

  async function onEnroll() {
    if (!cameraReady()) return;
    setBusy(true);
    try {
      await ensureModel();
      const r = await enroll(videoRef.current!);
      if (r.ok) {
        setEnrolled(true);
        setMsg({ kind: "pass", text: "Enrolled ✓ Your face template is stored on this device only." });
      } else {
        setMsg({ kind: "fail", text: r.error ?? "Enroll failed." });
      }
    } catch (e: any) {
      setMsg({ kind: "fail", text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!cameraReady()) return;
    setBusy(true);
    try {
      await ensureModel();
      const r = await verify(videoRef.current!);
      if (r.status === "no-template") {
        setMsg({ kind: "fail", text: "No template enrolled yet — tap Enroll first." });
      } else if (r.status === "no-face") {
        setMsg({ kind: "fail", text: "No face detected — center your face in the oval and retry." });
      } else if (r.status === "match") {
        setMsg({
          kind: "pass",
          text: `✓ MATCH — distance ${r.distance!.toFixed(3)} < ${r.threshold} (same person)`,
        });
      } else {
        setMsg({
          kind: "fail",
          text: `✗ NO MATCH — distance ${r.distance!.toFixed(3)} ≥ ${r.threshold} (different person)`,
        });
      }
    } catch (e: any) {
      setMsg({ kind: "fail", text: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await deleteTemplate();
      setEnrolled(false);
      setMsg({ kind: "info", text: "Template deleted from this device." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="big" style={{ fontSize: 18 }}>
        Identity check (face verification)
      </div>
      <div className="sub">
        Liveness proves it's a <b>real person</b>; this proves it's the <b>same person</b>. Enroll once,
        then Verify.
      </div>

      <div style={{ height: 10 }} />
      <div className="row">
        <button onClick={onEnroll} disabled={busy || !ready}>
          {enrolled ? "Re-enroll" : "Enroll my face"}
        </button>
        <button onClick={onVerify} disabled={busy || !ready || !enrolled}>
          Verify
        </button>
        {enrolled && (
          <button className="ghost" onClick={onDelete} disabled={busy}>
            Delete
          </button>
        )}
      </div>

      {msg &&
        (msg.kind === "info" ? (
          <div className="capnote" style={{ marginTop: 10 }}>
            {msg.text}
          </div>
        ) : (
          <div className={"result show " + (msg.kind === "pass" ? "pass" : "fail")}>
            <div className="meta">{msg.text}</div>
          </div>
        ))}

      <div className="capnote">
        Status: {enrolled ? "template enrolled on this device" : "no template yet"}. Match threshold{" "}
        {CONFIG.matchThreshold} (Euclidean distance on a 128-d embedding). Stored in IndexedDB, never
        uploaded.
      </div>
    </div>
  );
}
