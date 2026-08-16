import { useEffect, useState } from "react";
import { Check, FileText } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { save } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { log } from "@/lib/log";
import { toastSuccess } from "@/lib/toast";
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
  const [logFile, setLogFile] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded per open rather than once at mount: the dialog is opened rarely,
  // and this way a choice made in another window is reflected on reopen.
  useEffect(() => {
    if (!open) return;
    log.info("settings.open");
    setError(null);
    setTheme(readThemePref());
    Promise.all([api.listAppIcons(), api.getAppIcon()])
      .then(([list, current]) => {
        setIcons(list);
        setSelected(current);
      })
      .catch((e) => setError(String(e)));
    // Its own request: the path is only ever shown, and a failure to resolve
    // it must not cost the user the icon picker.
    api.logPath().then(setLogFile, () => setLogFile(null));
    // Straight off the bundle rather than a constant in the frontend, so
    // tauri.conf.json stays the one place the number is written. Same reason
    // it is fetched rather than baked in at build: a UI that can disagree with
    // the binary it ships in is worse than no version at all.
    getVersion().then(setVersion, () => setVersion(null));
  }, [open]);

  async function exportLogs() {
    // Named by date rather than time — one export per sitting is the norm,
    // and a name a user can read is a name they can attach to an issue.
    const today = new Date().toISOString().slice(0, 10);
    const dest = await save({
      defaultPath: `platter-log-${today}.txt`,
      filters: [{ name: "Log", extensions: ["txt", "log"] }],
    });
    if (!dest) return;
    setExporting(true);
    setError(null);
    try {
      await api.exportLogs(dest);
      toastSuccess("Logs exported", dest);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  async function choose(id: string | null) {
    log.info("settings.icon", id ?? "default");
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

            {/* The macOS segmented-control idiom, as ViewTabs uses it — at
                dialog scale rather than the header's, where the tabs are the
                primary navigation and this is one setting among several. */}
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
                    log.info("settings.theme", pref);
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

          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-medium">Advanced</h3>
              {/* Three things, in this order: what it is, that it goes
                  nowhere on its own, and what is in it. The middle sentence
                  carries the weight — a log the app collects reads as
                  telemetry unless it says outright that sending it is a thing
                  the user does by hand. And it earns the ask by saying why:
                  most bugs here are not reproducible without one. The
                  contents warning comes last, immediately above the button,
                  because that is the moment the choice is being made. */}
              <DialogDescription className="text-xs">
                Platter keeps a log of what it does, covering this session only
                — it is cleared at every launch. Nothing is ever sent anywhere:
                exporting the file and passing it on is entirely up to you, and
                for most problems it is the only thing that makes them fixable.
                It names the folders and tracks you worked with.
              </DialogDescription>
            </div>

            <Button
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void exportLogs()}
            >
              <FileText />
              {exporting ? "Exporting…" : "Export Logs…"}
            </Button>

            {/* The fallback when export itself is what's failing. Wrapping
                rather than truncating: a path whose end is cut off is the one
                part a user can't guess, and `break-all` means no width can
                push it past the panel. */}
            {logFile && (
              <p className="font-mono text-[10px] break-all text-muted-foreground/70">
                {logFile}
              </p>
            )}
          </div>

          {/* Last line of the dialog, in the same muted register as the log
              path above it — both are things a user reads out into a bug
              report rather than settings they can change. Absent, not
              "unknown", when it fails to resolve: a version nobody can act on
              is worth less than the space it takes. */}
          {version && (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              {/* The word, not a `-alpha` suffix on the number: that string
                  becomes CFBundleShortVersionString, which macOS expects to be
                  numeric and shows verbatim in Get Info. Semver already says
                  this much — anything below 1.0 promises nothing — but only to
                  a reader who knows it does. */}
              Platter {version} · Alpha
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
