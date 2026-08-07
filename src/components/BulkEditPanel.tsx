import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GenreField } from "@/components/GenreField";
import type { Track } from "@/lib/types";

/** The one value they all carry, or null when they disagree or are blank. */
function shared(values: string[]): string | null {
  const unique = new Set(values);
  if (unique.size !== 1) return null;
  const only = [...unique][0];
  return only || null;
}

/** "Oasis", "Oasis & 1 other", "4 values" — enough to confirm the selection
 * is what you meant without listing 40 names. */
function summarize(values: string[]): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (unique.length === 0) return "none";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique.sort()[0]} & 1 other`;
  return `${unique.length} values`;
}

type BulkField = "artist" | "album" | "genre";

/** Shown when more than one track is selected. Drafts prefill only when the
 * selection already agrees; one Apply at the end stamps JUST the fields the
 * user touched — never an untouched field across a mixed selection. */
export function BulkEditPanel({
  tracks,
  busy,
  onSetField,
  onSetArtwork,
  onRemove,
}: {
  tracks: Track[];
  busy: boolean;
  onSetField: (field: BulkField, value: string) => Promise<unknown> | void;
  onSetArtwork: (imagePath: string) => void;
  onRemove: () => void;
}) {
  const [initial] = useState<Record<BulkField, string>>({
    artist: shared(tracks.map((t) => t.artist)) ?? "",
    album: shared(tracks.map((t) => t.album)) ?? "",
    genre: shared(tracks.map((t) => t.genre)) ?? "",
  });
  const [draft, setDraft] = useState(initial);
  const [applying, setApplying] = useState(false);

  // A field applies when it was changed away from its starting value — a
  // draft kept at "" can't stamp (matches the old per-field `disabled={!x}`).
  const changed = (Object.keys(initial) as BulkField[]).filter(
    (k) => draft[k] !== initial[k] && draft[k] !== "",
  );

  async function apply() {
    if (changed.length === 0 || busy || applying) return;
    setApplying(true);
    // Sequential, not parallel: each set_field returns a fresh snapshot and
    // the last one to land wins — overlapping runs would race the UI state.
    for (const field of changed) {
      await onSetField(field, draft[field]);
    }
    setApplying(false);
  }

  const artworkCount = tracks.filter((t) => t.hasArtwork).length;

  async function pickArtwork() {
    const file = await openDialog({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
    });
    if (typeof file === "string") onSetArtwork(file);
  }

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div>
          <h2 className="text-lg font-semibold">{tracks.length} Tracks Selected</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {summarize(tracks.map((t) => t.artist))} ·{" "}
            {summarize(tracks.map((t) => t.album))}
          </p>
        </div>

        <Field label="Artist" mixed={initial.artist === ""}>
          <Input
            placeholder="Artist"
            value={draft.artist}
            onChange={(e) => setDraft((d) => ({ ...d, artist: e.target.value }))}
            title="Applies to every selected track, whether or not they agree today"
          />
        </Field>
        <Field label="Album" mixed={initial.album === ""}>
          <Input
            placeholder="Album"
            value={draft.album}
            onChange={(e) => setDraft((d) => ({ ...d, album: e.target.value }))}
            title="Applies to every selected track, whether or not they agree today"
          />
        </Field>
        <Field label="Genre" mixed={initial.genre === ""}>
          <GenreField
            value={draft.genre}
            onChange={(g) => setDraft((d) => ({ ...d, genre: g }))}
            allowEmpty
          />
        </Field>

        <div className="flex items-center gap-4">
          <div className="flex size-20 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ImagePlus className="size-6" />
          </div>
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={busy}
              onClick={pickArtwork}
            >
              Choose Cover Art…
            </Button>
            <p className="text-xs text-muted-foreground">
              {artworkCount === 0
                ? "None of these tracks have cover art — this sets it."
                : artworkCount === tracks.length
                  ? "All tracks already have cover art — this replaces it."
                  : `${artworkCount} of ${tracks.length} already have cover art — this replaces it.`}{" "}
              Applies on its own, right away.
            </p>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center border-t px-5 py-3">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" size="sm" type="button" disabled={busy}>
                Remove {tracks.length} Tracks
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {tracks.length} tracks from the iPod?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The files are deleted from the device the next time you save.
                This can't be undone from within PodSync.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={onRemove}
              >
                Remove {tracks.length} Tracks
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="flex-1" />
        <Button type="submit" size="sm" disabled={changed.length === 0 || busy || applying}>
          {applying ? "Applying…" : changed.length > 0 ? `Apply ${changed.length === 1 ? changed[0][0].toUpperCase() + changed[0].slice(1) : `${changed.length} Fields`} to ${tracks.length} Tracks` : "No Changes"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  mixed,
  children,
}: {
  label: string;
  /** Selection disagrees on this value — flag it instead of hiding it. */
  mixed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-baseline gap-1.5 text-xs font-normal text-muted-foreground">
        {label}
        {mixed && <span className="text-muted-foreground/70">· mixed</span>}
      </Label>
      {children}
    </div>
  );
}
