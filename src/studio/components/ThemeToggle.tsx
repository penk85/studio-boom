// Compact 3-way theme switcher: Light / Soft / Dark.
import { Contrast, Moon, Sun, type LucideIcon } from "lucide-react";
import { THEMES, useTheme, type ThemeName } from "../theme";

const ICONS: Record<ThemeName, LucideIcon> = {
  light: Sun,
  soft: Contrast,
  dark: Moon,
};

export function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  return (
    <div
      className="flex items-center gap-0.5 rounded-md bg-panel-2 p-0.5"
      role="group"
      aria-label="Theme"
    >
      {THEMES.map((t) => {
        const Icon = ICONS[t.id];
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            title={`${t.label} theme`}
            aria-label={`${t.label} theme`}
            aria-pressed={active}
            className={`grid h-6 w-6 place-items-center rounded transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}
