import { useState } from "react";
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

/** Type a mount point by hand. The detected volumes are listed in the
 * toolbar's drive menu, which is where this dialog is opened from — repeating
 * the list here would make the same devices clickable in two places, one of
 * which the user had already scrolled past to get here.
 *
 * So this is the escape hatch only: a device that never showed up in the list,
 * or a path somewhere other than /Volumes. An iPod Classic in disk-use mode
 * mounts as an ordinary FAT32 disk, so any readable path can be tried. */
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
  const [manualPath, setManualPath] = useState("/Volumes/");
  const [connecting, setConnecting] = useState(false);

  async function connect() {
    setConnecting(true);
    try {
      // A failed connect keeps the dialog open next to the error alert
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
          <DialogDescription>
            Type the mount point of the iPod to open. If it isn't in the drive
            menu, make sure it's mounted (it should show up in Finder's
            sidebar). If it's your first time syncing with this Mac, 'disk use'
            must be enabled once via iTunes 12.6.3 or by holding the iPod in
            disk-mode.
          </DialogDescription>
        </DialogHeader>

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
