import { useEffect, useState } from "react";
import type { Route } from "./+types/home";
import { LivenessScanner } from "~/components/LivenessScanner";
import { CaptureGallery } from "~/components/CaptureGallery";

export const meta: Route.MetaFunction = () => [
  { title: "Liveness Scan — Free Web MVP" },
  {
    name: "description",
    content:
      "Free, fully client-side challenge–response liveness detection. No face data leaves your browser.",
  },
];

function SecureContextBanner() {
  const [insecure, setInsecure] = useState(false);
  useEffect(() => {
    setInsecure(typeof window !== "undefined" && !window.isSecureContext);
  }, []);
  if (!insecure) return null;
  return (
    <div className="banner warn">
      <b>Camera needs a secure context.</b> Open this page via <code>localhost</code> or HTTPS — opening
      over plain HTTP on a non-localhost host blocks camera access in most browsers.
    </div>
  );
}

export default function Home() {
  const [capVersion, setCapVersion] = useState(0);
  return (
    <div className="wrap">
      <header>
        <h1>Liveness Scan</h1>
        <p>
          Free, fully client-side challenge–response liveness. Built on MediaPipe Face Landmarker
          (Apache-2.0). No face data leaves your browser.
        </p>
      </header>

      <SecureContextBanner />

      <LivenessScanner onCaptureSaved={() => setCapVersion((v) => v + 1)} />

      <CaptureGallery version={capVersion} />

      <div className="foot">
        Educational MVP. Active challenge–response plus depth-from-motion (3D parallax) to reject flat
        photos/screens. For regulated KYC, add a passive anti-spoof CNN + server-side checks.
        <br />
        Thresholds are tunable in <code>app/lib/config.ts</code>.
      </div>
    </div>
  );
}
