// Editor theme: three switchable palettes applied via [data-theme] on <html>.
// Token values live in styles.css; this only tracks the active choice.
import { create } from "zustand";

export type ThemeName = "light" | "soft" | "dark";

export const THEMES: { id: ThemeName; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "soft", label: "Soft" },
  { id: "dark", label: "Dark" },
];

const STORAGE_KEY = "studio-theme";

function readStoredTheme(): ThemeName {
  if (typeof localStorage === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "soft" || stored === "dark" ? stored : "light";
}

function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage failures (private mode, quota)
    }
    set({ theme });
  },
}));

// Apply the persisted theme at module load so first paint matches the choice.
applyTheme(readStoredTheme());
