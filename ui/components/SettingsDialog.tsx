import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { AppIconInfo } from "@/lib/types";
import {
  readThemePref,
  setThemePref,
  THEME_LABELS,
  type ThemePref,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/** App preferences. Currently just the icon picker — the prefs the track list
 * uses (grouping, sort, view) stay in the View menu where they're in reach of
 * the list they affect. */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [icons, setIcons] = useState<AppIconInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePref>(() => readThemePref());
  const [error, setError] = useState<string | null>(null);

  // Loaded per open rather than once at mount: the dialog is opened rarely,
  // and this way a choice made in another window is reflected on reopen.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTheme(readThemePref());
    Promise.all([api.listAppIcons(), api.getAppIcon()])
      .then(([list, current]) => {
        setIcons(list);
        setSelected(current);
      })
      .catch((e) => setError(String(e)));
  }, [open]);

  async function choose(id: string | null) {
    // Optimistic: the Dock swap is instant and the tile should move with it.
    const previous = selected;
    setSelected(id);
    setError(null);
    try {
      await api.setAppIcon(id);
    } catch (e) {
      setSelected(previous);
      setError(String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">Appearance</h3>
              <DialogDescription className="text-xs">
                System follows macOS and switches with it.
              </DialogDescription>
            </div>

            {/* The macOS segmented-control idiom, matching ViewTabs. */}
            <div
              role="radiogroup"
              aria-label="Appearance"
              className="flex items-center rounded-md bg-muted/60 p-0.5"
            >
              {(Object.keys(THEME_LABELS) as ThemePref[]).map((pref) => (
                <button
                  key={pref}
                  type="button"
                  role="radio"
                  aria-checked={theme === pref}
                  onClick={() => {
                    // Repaints immediately; no await, nothing to fail.
                    setThemePref(pref);
                    setTheme(pref);
                  }}
                  className={cn(
                    "flex-1 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                    theme === pref
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {THEME_LABELS[pref]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">App Icon</h3>
              <DialogDescription className="text-xs">
                Changes the Dock and app switcher icon. Finder and Spotlight
                always show Light — macOS only lets a signed app change the one
                it draws at runtime.
              </DialogDescription>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {icons.map((icon) => {
                const isSelected = icon.id === selected;
                return (
                  <button
                    key={icon.id ?? "default"}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => void choose(icon.id)}
                    className={cn(
                      "relative flex flex-col items-center gap-1.5 rounded-md border p-2 transition-colors",
                      isSelected
                        ? "border-primary bg-accent"
                        : "border-transparent hover:bg-accent/50",
                    )}
                  >
                    <img
                      src={icon.preview}
                      alt=""
                      className="size-16"
                      draggable={false}
                    />
                    <span className="text-xs text-muted-foreground">
                      {icon.label}
                    </span>
                    {isSelected && (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
