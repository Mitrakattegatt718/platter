import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeviceGlyph } from "@/components/DeviceGlyph";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { sameVolumes } from "@/lib/volumes";
import type { VolumeInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A crisp, monochrome iPod Classic mark — the product's own device rendered
 * as an icon (body, screen, click wheel, center button), not an illustration. */
function IpodGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 84" className={className} fill="none" aria-hidden>
      <rect
        x="9"
        y="3"
        width="38"
        height="78"
        rx="8"
        className="fill-foreground/[0.04] stroke-foreground/20"
        strokeWidth={1.5}
      />
      <rect x="16" y="11" width="24" height="17" rx="3" className="fill-foreground/15" />
      <circle
        cx="28"
        cy="54"
        r="15.5"
        className="stroke-foreground/25"
        strokeWidth={1.5}
      />
      <circle
        cx="28"
        cy="54"
        r="5.5"
        className="stroke-foreground/20"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function volumeName(path: string): string {
  const seg = path.split("/").filter(Boolean).pop();
  return seg || path;
}

function capacityLabel(vol: VolumeInfo): string | null {
  if (vol.freeBytes === null || vol.totalBytes === null || vol.totalBytes <= 0) {
    return null;
  }
  return `${formatBytes(vol.freeBytes)} free of ${formatBytes(vol.totalBytes)}`;
}

const SCAN_INTERVAL_MS = 2500;

/** What the scan draws while the first listVolumes call is in flight — same
 * anatomy as a device row, so the swap to real rows doesn't shift layout. */
function ScanSkeleton() {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
      aria-hidden
    >
      {[72, 48, 60].map((w, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 motion-safe:animate-pulse",
            i > 0 && "border-t border-border",
          )}
        >
          <span className="size-4 shrink-0 rounded-sm bg-muted-foreground/15" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3 rounded-sm bg-muted-foreground/15" style={{ width: `${w}%` }} />
            <span className="h-2.5 rounded-sm bg-muted-foreground/10" style={{ width: `${w + 20}%` }} />
          </span>
        </div>
      ))}
      <span className="sr-only">Scanning for volumes</span>
    </div>
  );
}

/** Empty state for the main content area when no iPod is connected: a quiet
 * "Connect an iPod" notice plus a live list of the volumes under /Volumes,
 * one click from the library. */
export function DisconnectedView({
  onConnect,
  onChooseManually,
}: {
  onConnect: (mountPoint: string) => Promise<boolean>;
  onChooseManually: () => void;
}) {
  const [volumes, setVolumes] = useState<VolumeInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [connectingPath, setConnectingPath] = useState<string | null>(null);
  const connectingRef = useRef<string | null>(null);

  const refresh = useCallback((silent = false) => {
    if (!silent) setScanning(true);
    api
      .listVolumes()
      .then((next) => {
        // Keep the previous array when nothing actually changed. The quiet
        // rescan below runs every 2.5s for as long as this view is up, and a
        // fresh array each time re-rendered the whole list — and re-sorted it —
        // to draw exactly what was already on screen.
        setVolumes((prev) => (sameVolumes(prev, next) ? prev : next));
        setScanError(null);
      })
      // "Couldn't scan" and "no volumes" are different answers — showing the
      // empty state for a TCC denial sends the user hunting for a cable
      // problem that doesn't exist.
      .catch((e) => {
        setScanError(String(e));
        setVolumes((prev) => prev ?? []);
      })
      .finally(() => {
        if (!silent) setScanning(false);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-scan quietly while this view is up, so an iPod plugged in after launch
  // appears on its own. Paused during a connect attempt, and silent so the
  // Refresh control doesn't flicker every interval.
  useEffect(() => {
    const id = setInterval(() => {
      if (connectingRef.current === null) refresh(true);
    }, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // iPods first — they are the volumes the user is here for.
  const ordered = useMemo(
    () =>
      volumes === null
        ? []
        : [...volumes].sort((a, b) => Number(b.isIpod) - Number(a.isIpod)),
    [volumes],
  );
  const showSkeleton = volumes === null;
  const showEmpty = volumes !== null && ordered.length === 0;

  async function connect(path: string) {
    connectingRef.current = path;
    setConnectingPath(path);
    try {
      await onConnect(path);
    } finally {
      connectingRef.current = null;
      setConnectingPath(null);
    }
  }

  return (
    // Centred while everything fits; once it doesn't, max-h-full caps the
    // column at the pane and the volume list — the only part that can grow —
    // takes the overflow as its own scroll. The heading and the manual-path
    // link stay put either way.
    <div className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden px-6 py-10">
      <div className="flex max-h-full w-full min-h-0 max-w-md flex-col gap-6">
        <div className="flex shrink-0 flex-col items-center gap-3.5 text-center">
          <IpodGlyph className="size-16" />
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold tracking-tight">Connect an iPod</h2>
            <p className="max-w-[54ch] text-pretty text-sm leading-relaxed text-muted-foreground">
              Plug it in over USB with disk use enabled. It mounts in Finder
              like any other drive — and shows up in the list below.
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-1.5">
          <div className="flex h-6 shrink-0 items-center justify-between px-0.5">
            <span className="text-xs font-medium text-muted-foreground">
              Mounted volumes
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => refresh()}
              disabled={scanning || connectingPath !== null}
              title="Scan for removable volumes again"
            >
              <RefreshCw className={cn(scanning && "motion-safe:animate-spin")} />
              Refresh
            </Button>
          </div>

          {scanError !== null && (
            <div className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
              Couldn't scan drives: {scanError}
              {scanError.includes("Operation not permitted") &&
                " — grant Platter access under Privacy & Security → Files & Folders → Removable Volumes."}
            </div>
          )}
          {showSkeleton ? (
            <ScanSkeleton />
          ) : showEmpty ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm leading-relaxed text-muted-foreground">
              No disks found. Plug the iPod in and select Refresh. If it still
              doesn't appear, enable disk use once from iTunes 12.6.3 — the last
              version that recognizes a Classic.
            </div>
          ) : (
            <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain rounded-lg border border-border bg-card">
              {ordered.map((vol, i) => {
                const busy = connectingPath === vol.path;
                const dimmed = connectingPath !== null && !busy;
                const capacity = capacityLabel(vol);
                return (
                  <button
                    key={vol.path}
                    disabled={connectingPath !== null}
                    onClick={() => connect(vol.path)}
                    title={vol.isIpod ? "Connect to this iPod" : "Connect to this volume"}
                    className={cn(
                      // shrink-0: rows live in a scroll container now, and a
                      // flex child's default shrink would squash them flat
                      // instead of letting the list scroll.
                      "group flex shrink-0 items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      "outline-none focus-visible:bg-muted",
                      i > 0 && "border-t border-border",
                      busy ? "bg-primary/10" : "hover:bg-muted",
                      dimmed && "opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0",
                        busy || vol.isIpod ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : vol.isIpod ? (
                        <DeviceGlyph family={vol.family} className="size-5" />
                      ) : (
                        <HardDrive className="size-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {volumeName(vol.path)}
                        </span>
                        {vol.isIpod && (
                          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            iPod
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        <span className="font-mono">{vol.path}</span>
                        {capacity && <span className="tabular-nums"> · {capacity}</span>}
                      </span>
                    </span>
                    {busy ? (
                      <span className="shrink-0 text-xs text-primary">Connecting…</span>
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          className="mx-auto shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground underline-offset-4 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={onChooseManually}
        >
          Choose a path manually…
        </button>
      </div>
    </div>
  );
}
