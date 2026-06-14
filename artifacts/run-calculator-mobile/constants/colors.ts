/**
 * Design tokens derived from the sibling web artifact (artifacts/run-calculator).
 * Web theme: "Industrial Dark Steel and Amber"
 *
 * HSL → hex conversions from the web's index.css dark block:
 *   --background:       hsl(222 25% 10%)  → #131720
 *   --foreground:       hsl(210 40% 98%)  → #f5f8fc
 *   --card:             hsl(222 25% 12%)  → #171e2c
 *   --border:           hsl(217 25% 20%)  → #212f45
 *   --primary:          hsl(35 100% 50%)  → #ff9900  (Industrial Amber)
 *   --secondary/muted:  hsl(217 25% 18%)  → #1d2a3d
 *   --muted-foreground: hsl(215 20.2% 65.1%) → #8fa4be
 *   --destructive:      hsl(0 62.8% 30.6%)  → #7a1e1e
 *
 * Light block:
 *   --background:       hsl(210 20% 98%)  → #f5f8fa
 *   --foreground:       hsl(222 47% 11%)  → #0f1729
 *   --card:             hsl(0 0% 100%)    → #ffffff
 *   --border:           hsl(214 32% 91%)  → #dde5f0
 *   --primary:          hsl(35 100% 50%)  → #ff9900
 *   --muted-foreground: hsl(215.4 16.3% 46.9%) → #6b7c93
 *   --destructive:      hsl(0 84.2% 60.2%) → #f03a3a
 *
 * --radius: 0.25rem → 4px
 */
const colors = {
  light: {
    text: "#0f1729",
    tint: "#ff9900",
    background: "#f5f8fa",
    foreground: "#0f1729",
    card: "#ffffff",
    cardForeground: "#0f1729",
    primary: "#ff9900",
    primaryForeground: "#ffffff",
    secondary: "#eef3f8",
    secondaryForeground: "#0f1729",
    muted: "#eef3f8",
    mutedForeground: "#6b7c93",
    accent: "#eef3f8",
    accentForeground: "#0f1729",
    destructive: "#f03a3a",
    destructiveForeground: "#ffffff",
    border: "#dde5f0",
    input: "#dde5f0",
    success: "#16a34a",
    warning: "#d97706",
  },
  dark: {
    text: "#f5f8fc",
    tint: "#ff9900",
    background: "#131720",
    foreground: "#f5f8fc",
    card: "#171e2c",
    cardForeground: "#f5f8fc",
    primary: "#ff9900",
    primaryForeground: "#0f1729",
    secondary: "#1d2a3d",
    secondaryForeground: "#f5f8fc",
    muted: "#1d2a3d",
    mutedForeground: "#8fa4be",
    accent: "#1d2a3d",
    accentForeground: "#f5f8fc",
    destructive: "#7a1e1e",
    destructiveForeground: "#f5f8fc",
    border: "#212f45",
    input: "#212f45",
    success: "#22c55e",
    warning: "#f59e0b",
  },
  radius: 4,
};

export default colors;
