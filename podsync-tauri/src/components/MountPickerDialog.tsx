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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import type { VolumeInfo } from "@/lib/types";

/** Pick the mounted iPod volume from /Volumes, or type a path manually. An
 * iPod Classic in disk-use mode mounts as an ordinary FAT32 disk. */
export function MountPickerDialog({
  open,
  onOpenChange,
  onConnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the library opened. */
  onConnect: (mountPoint: string) => Promise<boolean>;
}) {
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [manualPath, setManualPath] = useState("/Volumes/");
  const [onlyIpods, setOnlyIpods] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (open) {
      api.listVolumes().then(setVolumes).catch(() => setVolumes([]));
    }
  }, [open]);

  const filtered = onlyIpods ? volumes.filter((v) => v.isIpod) : volumes;

  async function connect() {
    setConnecting(true);
    try {
      // A failed connect keeps the picker open next to the error alert
      // instead of dumping the user back onto an empty window.
      if (await onConnect(manualPath)) onOpenChange(false);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Connect iPod</DialogTitle>
          {volumes.length === 0 && (
            <DialogDescription>
              No removable volumes detected. Make sure the iPod is connected and
              mounted (it should show up in Finder's sidebar), then reopen this
              dialog. If it's your first time syncing with this Mac, 'disk use'
              must be enabled once via iTunes 12.6.3 or by holding the iPod in
              disk-mode.
            </DialogDescription>
          )}
        </DialogHeader>

        {volumes.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <Switch id="only-ipods" checked={onlyIpods} onCheckedChange={setOnlyIpods} />
              <Label htmlFor="only-ipods" className="text-xs">
                Show only iPods
              </Label>
            </div>

            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {onlyIpods
                  ? 'No iPods detected. Toggle off "Show only iPods" to see all volumes, or type the path manually below.'
                  : "No volumes found."}
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1">
                {filtered.map((vol) => (
                  <Button
                    key={vol.path}
                    variant={manualPath === vol.path ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    size="sm"
                    onClick={() => setManualPath(vol.path)}
                  >
                    {vol.isIpod ? <Smartphone /> : <HardDrive />}
                    <span className="truncate">{vol.path}</span>
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        <Input
          placeholder="Mount point"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !connecting && connect()}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={connect} disabled={connecting}>
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
