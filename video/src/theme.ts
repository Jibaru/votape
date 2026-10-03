import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

export const MONO = loadMono("normal", { weights: ["400", "700"], subsets: ["latin", "latin-ext"] }).fontFamily;
export const SANS = loadInter("normal", { weights: ["400", "600", "800"], subsets: ["latin", "latin-ext"] }).fontFamily;

// votape's banner gradient (#E63946 → #F1FAEE) on a near-black canvas.
export const COLORS = {
  bg: "#07080c",
  bg2: "#10121a",
  window: "rgba(14, 16, 23, 0.92)",
  windowBorder: "rgba(255, 255, 255, 0.09)",
  titleBar: "rgba(255, 255, 255, 0.035)",
  text: "#e8eaf0",
  muted: "#8b90a0",
  faint: "#4a4f5c",
  red: "#ff6b6b",
  accent: "#E63946",
  cream: "#F1FAEE",
  green: "#8bd99a",
  blue: "#8cb8ff",
  orange: "#ffb454",
  claude: "#d97757",
};
