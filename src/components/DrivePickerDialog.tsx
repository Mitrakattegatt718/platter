import { useEffect, useState } from "react";
import { HardDrive, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { toastError } from "@/lib/toast";
import type { VolumeInfo, VolumeScan } from "@/lib/types";

/** Import everything from a mounted drive — a USB stick, an SD card, another
 * iPod's disk. Dropping a volume on the window already did this; this is the
 * same path with somewhere to click and a count up front, since "import a
 * whole drive" deserves to say how much that is before it starts. */
export function DrivePickerDialog({
  open,
  onOpenChange,
  connectedMount,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The iPod currently open, so it isn't offered as its own source. */
  connectedMount: string | null;
  onImport: (path: string) => Promise<void>;
}) {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [scan, setScan] = useState<VolumeScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setScan(null);
    api.listVolumes().then(setVolumes).catch((e) => {
      setVolumes([]);
      toastError("Couldn't scan drives", String(e));
    });
  }, [open]);

  async function choose(path: string) {
    setSelected(path);
    setScan(null);
    setScanning(true);
    try {
      const result = await api.scanVolume(path);
      // Ignore a scan that finished after the user moved on.
      setSelected((current) => {
        if (current === path) setScan(result);
        return current;
      });
    } catch (e) {
      setScan(null);
      toastError("Couldn't scan the drive", String(e));
    } finally {
      setScanning(false);
    }
  }

  async function start() {
    if (!selected) return;
    setImporting(true);
    try {
      await onImport(selected);
      onOpenChange(false);
    } finally {
      setImporting(false);
    }
  }

  const sources = volumes.filter((v) => v.path !== connectedMount);
  const nothingFound = scan !== null && scan.tracks === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Import from Drive</DialogTitle>
          <DialogDescription className="text-xs">
            Pick a mounted drive and Platter imports every audio file on it,
            folders and all. Lossless files convert to Apple Lossless on the
            way in.
          </DialogDescription>
        </DialogHeader>

        {sources.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No other drives are mounted.
          </p>
        ) : (
          <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-1">
            {sources.map((vol) => (
              <Button
                key={vol.path}
                variant={selected === vol.path ? "secondary" : "ghost"}
                className="w-full justify-start"
                size="sm"
                onClick={() => void choose(vol.path)}
              >
                {vol.isIpod ? <Smartphone /> : <HardDrive />}
                <span className="truncate">{vol.path}</span>
                {vol.totalBytes !== null && (
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                    {formatBytes(vol.totalBytes)}
                  </span>
                )}
              </Button>
            ))}
          </div>
        )}

        {selected && (
          <p className="text-xs text-muted-foreground">
            {scanning
              ? "Scanning…"
              : nothingFound
                ? "No importable audio found on this drive."
                : scan
                  ? `${scan.tracks.toLocaleString()} track${scan.tracks === 1 ? "" : "s"} found` +
                    (scan.cueTracks > 0
                      ? ` — ${scan.cueTracks.toLocaleString()} of them from cue sheets, which have to be rendered first and take considerably longer.`
                      : ".")
                  : "Couldn't scan this drive."}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void start()}
            disabled={!selected || scanning || importing || nothingFound || !scan}
          >
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
