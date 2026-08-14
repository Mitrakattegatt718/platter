import { useEffect, useState } from "react";
import { ChevronsUpDown, HardDrive, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { partitionVolumes, volumeLabel } from "@/lib/volumes";
import type { VolumeInfo } from "@/lib/types";

/** The eject glyph. Lives here rather than in App because this menu is now the
 * only place that ejects. */
function EjectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="M5 13 L12 5 L19 13 Z" strokeLinejoin="round" />
      <line x1="5" y1="18" x2="19" y2="18" strokeLinecap="round" />
    </svg>
  );
}

/** Total size, not free space: it is the number that tells two devices apart
 * before either is connected, and unlike free space it does not move. */
function capacityLabel(volume: VolumeInfo): string {
  return volume.totalBytes === null ? "" : formatBytes(volume.totalBytes);
}

/** The connected device, as something you can act on. Replaces the static
 * "iPod (/Volumes/…)" label and absorbs the Connect and Eject buttons that
 * used to sit on the right of the toolbar. */
export function DriveSelect({
  mountPoint,
  busy,
  onConnect,
  onEject,
  onConnectManually,
}: {
  mountPoint: string | null;
  busy: boolean;
  /** Resolves true when the library opened. */
  onConnect: (mountPoint: string) => Promise<boolean>;
  onEject: () => void;
  onConnectManually: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);

  // Fetched when the menu opens, never polled: list_volumes runs statvfs over
  // every mount, and doing that on a timer would spin every attached disk to
  // keep a closed menu warm.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .listVolumes()
      .then((next) => alive && setVolumes(next))
      .catch(() => alive && setVolumes([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const { ipods, others } = partitionVolumes(volumes);

  const row = (volume: VolumeInfo) => (
    <DropdownMenuItem
      key={volume.path}
      // Positively identified as a device with no iTunesDB. Shown and
      // disabled, not hidden — clicking through to a libgpod failure is not an
      // answer, and hiding it reads as "PodSync didn't see my iPod".
      disabled={volume.unsupported || busy}
      title={
        volume.unsupported
          ? `${volume.model ?? "This device"} doesn't use an iTunesDB, so PodSync can't manage it`
          : volume.path
      }
      onClick={() => void onConnect(volume.path)}
    >
      {volume.isIpod ? <Smartphone /> : <HardDrive />}
      <span className="truncate">{volumeLabel(volume.path)}</span>
      <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">
        {volume.unsupported ? "Not supported" : capacityLabel(volume)}
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0"
            title={mountPoint ?? "No iPod connected"}
          >
            <span className="truncate font-mono text-sm font-semibold">
              {mountPoint ? volumeLabel(mountPoint) : "No iPod"}
            </span>
            <ChevronsUpDown className="shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-64">
        {/* Each label lives INSIDE a group: the wrapper maps DropdownMenuLabel
            onto Base UI's GroupLabel, which reads group context and throws
            without one. */}
        {ipods.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>iPods</DropdownMenuLabel>
            {ipods.map(row)}
          </DropdownMenuGroup>
        )}
        {others.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Other volumes</DropdownMenuLabel>
            {others.map(row)}
          </DropdownMenuGroup>
        )}
        {volumes.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onConnectManually}>Connect&hellip;</DropdownMenuItem>
        <DropdownMenuItem disabled={mountPoint === null || busy} onClick={onEject}>
          <EjectIcon /> Eject
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
