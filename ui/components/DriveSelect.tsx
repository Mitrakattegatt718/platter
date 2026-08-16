import { useEffect, useState } from "react";
import { ChevronDown, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeviceGlyph } from "@/components/DeviceGlyph";
import { EjectIcon } from "@/components/EjectIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import {
  partitionVolumes,
  volumeCapacity,
  volumeFree,
  volumeLabel,
  volumeSubtitle,
} from "@/lib/volumes";
import type { VolumeInfo } from "@/lib/types";

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
      // Keep whatever list we had: replacing it with [] on a transient
      // failure would read as "your iPod vanished".
      .catch((e) => alive && toastError("Couldn't scan drives", String(e)));
    return () => {
      alive = false;
    };
  }, [open, mountPoint]);

  const { ipods, others } = partitionVolumes(volumes);

  // Unknown but mounted means the list hasn't arrived yet, and a library only
  // ever opens on an iPod — so a device is the better guess than the disk. The
  // family is null until the scan lands, which draws the unidentified body
  // rather than claiming a model.
  const connected = volumes.find((v) => v.path === mountPoint) ?? null;
  const triggerIcon =
    mountPoint === null || (connected !== null && !connected.isIpod) ? (
      <HardDrive />
    ) : (
      <DeviceGlyph family={connected?.family ?? null} className="size-5" />
    );

  const row = (volume: VolumeInfo) => {
    const isConnected = volume.path === mountPoint;
    const subtitle = volumeSubtitle(volume);
    const capacity = volumeCapacity(volume);
    return (
      <DropdownMenuItem
        key={volume.path}
        // Positively identified as a device with no iTunesDB. Shown and
        // disabled, not hidden — clicking through to a libgpod failure is not
        // an answer, and hiding it reads as "Platter didn't see my iPod".
        disabled={volume.unsupported || busy}
        // A wash of the accent rather than the neutral one hover uses, so the
        // open device still reads as chosen in a menu where the pointer is
        // always sitting on some other row. 12%: at 8 it disappears against
        // the dark popover, at 16 it turns into a block of colour on the light
        // one. Hover's own `focus:bg-accent` outranks it and takes over, which
        // is what keeps the pointer's position legible.
        // pr-3 against the item's own pl-1.5, which looks lopsided but is not:
        // the left column is a 24px box holding a silhouette that fills about
        // half of it, so the artwork already starts ~6px inside its own slot.
        // Matching the raw padding would leave the right edge visibly tighter
        // than the left; matching the *visible* inset is what reads as equal.
        className={cn("pr-3", isConnected && "bg-primary/12")}
        // The path is what the row cannot show; the total is what it chose not
        // to. Both belong here rather than on the row, where they would double
        // its width to restate things most of the time.
        title={
          volume.unsupported
            ? `${volume.model ?? "This device"} doesn't use an iTunesDB, so Platter can't manage it`
            : capacity === ""
              ? volume.path
              : `${volume.path} — ${capacity}`
        }
        onClick={() => void onConnect(volume.path)}
      >
        {/* The silhouette, not one phone for every iPod: the question a user
            scans this list with is "which one is the Shuffle", and a row of
            identical rectangles put that answer in the text only.

            One fixed-width column, whatever goes in it, so every label starts
            at the same x. The glyph gets the full 24px and the lucide disk
            stays at 16: a silhouette is a tall body on a square grid and
            spends about half its width, while a lucide icon is drawn edge to
            edge, so matching the boxes would leave the iPods looking smaller
            than the drives. 24 is where the device reads at a glance without
            out-measuring the two lines of text beside it. */}
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center",
            // The glyph is drawn entirely in currentColor, so the connected
            // device takes the accent without knowing anything about state.
            isConnected && "text-primary",
          )}
        >
          {volume.isIpod ? (
            <DeviceGlyph family={volume.family} className="size-6" />
          ) : (
            <HardDrive className="size-4" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          {/* The name carries the accent, not the whole row: the model line
              and the free-space figure stay muted, so the colour reads as
              "this is the one that's open" rather than as emphasis on
              everything the row says. */}
          <span className={cn("truncate", isConnected && "text-primary")}>
            {volumeLabel(volume.path)}
          </span>
          {/* Rendered only when it has something to add: an empty element
              still claims the line height it would have filled. */}
          {subtitle !== "" && (
            <span className="truncate text-xs text-muted-foreground/80">{subtitle}</span>
          )}
        </div>
        {/* A third column of the row, not a tail on its first line. Sitting
            inside the name's line left it hanging level with the name while the
            device glyph opposite was centred on the whole row — on a two-line
            row that reads as misaligned. Out here the item's own `items-center`
            centres it against the full height, matching the glyph. */}
        {isConnected ? (
          // The padding sits on the outer span so the relative box stays tight
          // to the figure: `inset-0` on the button would otherwise centre it
          // across the gap as well, pulling the glyph left of the text it
          // replaces.
          <span className="shrink-0 pl-3">
            {/* On the open device the figure gives way to eject under the
                pointer — same column, right edge, no reserved gutter, and
                nothing moves as it swaps. Eject earns that spot because for
                this one row the free space is already on the header gauge a
                few pixels away. */}
            <span className="relative flex items-center">
              <span className="text-xs tabular-nums text-muted-foreground transition-opacity group-hover/dropdown-menu-item:opacity-0">
                {volumeFree(volume)}
              </span>
              <EjectButton busy={busy} onEject={onEject} />
            </span>
          </span>
        ) : (
          <span className="shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">
            {volume.unsupported ? "Not supported" : volumeFree(volume)}
          </span>
        )}
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* The trigger wears a well rather than being a bare label: it is the one
          control in the header that names what the whole window is acting on,
          and as a ghost button it announced itself only under the pointer.
          A black wash and not `bg-muted`, which is what the tabs sit in,
          because every surface token in this palette is *lighter* than the
          background in dark mode — `muted`, `secondary` and `accent` are all
          oklch 0.335 against a 0.235 page — so nothing in the set can go
          darker. The palette is pure greyscale, so a plain black overlay stays
          in it; the light-mode value is much weaker because the same wash over
          white reads far heavier than over near-black. */}
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="lg"
            className="min-w-0 bg-black/5 hover:bg-black/10 dark:bg-black/25 dark:hover:bg-black/35"
            title={mountPoint ?? "No iPod connected"}
          >
            {triggerIcon}
            <span className="truncate text-sm font-semibold">
              {mountPoint ? volumeLabel(mountPoint) : "No iPod"}
            </span>
            {/* One chevron, not two: this opens a menu. The paired up/down
                arrows are the combobox idiom and promise a listbox that is not
                there. */}
            <ChevronDown className="size-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-72">
        {/* No "iPods" / "Other volumes" headings. Two section labels above two
            or three rows is more chrome than content, and the per-row icon
            already carries the distinction the headings were spelling out —
            the rule between the sections is enough to group them. */}
        {ipods.map(row)}
        {ipods.length > 0 && others.length > 0 && <DropdownMenuSeparator />}
        {others.map(row)}
        {/* A menu whose only entry is "Connect…" reads as broken rather than
            empty. Say which of the two it is. */}
        {volumes.length === 0 && (
          <div className="px-1.5 py-1 text-sm text-muted-foreground">No drives found</div>
        )}
        {volumes.length > 0 && <DropdownMenuSeparator />}
        {/* Indented past the icon column, so its label starts where every
            other row's label does instead of hanging left of them. 36px is the
            item's own 6px padding plus the 24px column plus the 6px gap — not
            the `inset` prop, whose 28px was sized for a 16px column. */}
        <DropdownMenuItem className="pl-9" onClick={onConnectManually}>
          Connect&hellip;
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Eject, laid over the free-space figure it replaces on hover. It belongs to a
 * specific device, so it lives on that device's row rather than as a standing
 * menu entry that has to re-state which drive it would act on.
 *
 * `absolute inset-0` rather than a sibling in the flex line: the button and the
 * figure occupy the same space, so the row cannot change width as one fades
 * into the other.
 *
 * `justify-end` and not centred. The figure it replaces is right-aligned
 * against the row's edge like every other row's is, and centring the glyph in
 * that box parks it wherever the text happened to end — a "29.8 GB free" row
 * and a "132 MB free" row put the same control in two different places, and
 * neither is the edge the eye is following down the list.
 *
 * `focus-visible:opacity-100` is what keeps it reachable without a pointer —
 * hover alone would make it keyboard-invisible.
 *
 * Both events are stopped, not just the click: the enclosing menu item's own
 * handler would otherwise reconnect the volume being ejected, and Base UI
 * arms items on pointer-down. */
function EjectButton({ busy, onEject }: { busy: boolean; onEject: () => void }) {
  return (
    <button
      type="button"
      disabled={busy}
      className="absolute inset-0 flex items-center justify-end rounded-sm opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 disabled:pointer-events-none group-hover/dropdown-menu-item:opacity-100"
      // The glyph is the whole button, so without this a screen reader
      // reaches a control announced only as "button".
      aria-label="Eject"
      title="Disconnect and eject the iPod so you can safely unplug it"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onEject();
      }}
    >
      <EjectIcon />
    </button>
  );
}
