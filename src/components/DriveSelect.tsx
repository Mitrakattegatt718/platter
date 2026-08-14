import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, HardDrive, Smartphone } from "lucide-react";
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
import { partitionVolumes, volumeCapacity, volumeLabel, volumeSubtitle } from "@/lib/volumes";
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

  // Fetched when the menu opens and whenever the connected volume changes,
  // never polled: list_volumes runs statfs over every mount, and doing that on
  // a timer would spin every attached disk to keep a closed menu warm. The
  // mountPoint dependency is what lets the trigger draw the right icon before
  // the menu has ever been opened.
  useEffect(() => {
    if (!open && mountPoint === null) return;
    let alive = true;
    api
      .listVolumes()
      .then((next) => alive && setVolumes(next))
      .catch(() => alive && setVolumes([]));
    return () => {
      alive = false;
    };
  }, [open, mountPoint]);

  const { ipods, others } = partitionVolumes(volumes);

  // Unknown but mounted means the list hasn't arrived yet, and a library only
  // ever opens on an iPod — so the phone is the better guess than the disk.
  const connected = volumes.find((v) => v.path === mountPoint) ?? null;
  const TriggerIcon =
    mountPoint === null ? HardDrive : connected && !connected.isIpod ? HardDrive : Smartphone;

  const row = (volume: VolumeInfo) => {
    const isConnected = volume.path === mountPoint;
    const subtitle = volumeSubtitle(volume);
    return (
      <DropdownMenuItem
        key={volume.path}
        // Positively identified as a device with no iTunesDB. Shown and
        // disabled, not hidden — clicking through to a libgpod failure is not
        // an answer, and hiding it reads as "PodSync didn't see my iPod".
        disabled={volume.unsupported || busy}
        title={
          volume.unsupported
            ? `${volume.model ?? "This device"} doesn't use an iTunesDB, so PodSync can't manage it`
            : volume.path
        }
        onClick={() => void onConnect(volume.path)}
      >
        {volume.isIpod ? <Smartphone /> : <HardDrive />}
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="flex items-baseline gap-3">
            <span className="truncate">{volumeLabel(volume.path)}</span>
            <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {volume.unsupported ? "Not supported" : volumeCapacity(volume)}
            </span>
          </div>
          {/* Rendered only when it has something to add: an empty element
              still claims the line height it would have filled. */}
          {subtitle !== "" && (
            <span className="truncate text-xs text-muted-foreground/80">{subtitle}</span>
          )}
        </div>
        {isConnected && (
          <ConnectedMark busy={busy} onEject={onEject} />
        )}
      </DropdownMenuItem>
    );
  };

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
            <TriggerIcon />
            <span className="truncate text-sm font-semibold">
              {mountPoint ? volumeLabel(mountPoint) : "No iPod"}
            </span>
            <ChevronsUpDown className="shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-80">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The connected row's trailing slot: a tick that becomes an eject button
 * under the pointer. Eject belongs to a specific device, so it lives on that
 * device's row rather than as a standing menu entry that has to re-state which
 * drive it would act on.
 *
 * Both events are stopped, not just the click: the enclosing menu item's own
 * handler would otherwise reconnect the volume being ejected, and Base UI
 * arms items on pointer-down. */
function ConnectedMark({ busy, onEject }: { busy: boolean; onEject: () => void }) {
  return (
    <span className="relative ml-2 flex size-4 shrink-0 items-center justify-center">
      <Check className="size-4 text-primary transition-opacity group-hover/dropdown-menu-item:opacity-0" />
      <button
        type="button"
        disabled={busy}
        className="absolute inset-0 flex items-center justify-center rounded-sm opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 disabled:pointer-events-none group-hover/dropdown-menu-item:opacity-100"
        title="Disconnect and eject the iPod so you can safely unplug it"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onEject();
        }}
      >
        <EjectIcon />
      </button>
    </span>
  );
}
