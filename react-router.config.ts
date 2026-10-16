import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  // Server-side render by default; set to false for SPA mode.
  ssr: true,
  presets: [vercelPreset()],
} satisfies Config;
