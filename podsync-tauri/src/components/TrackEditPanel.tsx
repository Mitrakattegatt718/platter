import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { GenreField } from "@/components/GenreField";
import { StepperInput } from "@/components/StepperInput";
import { formatBytes, formatDuration } from "@/lib/format";
import type { Track } from "@/lib/types";

interface Fields {
  title: string;
  artist: string;
  album: string;
  genre: string;
  trackNumber: number;
  year: number;
}

export function TrackEditPanel({
  track,
  busy,
  onSave,
  onSetArtwork,
  onRemove,
}: {
  track: Track;
  busy: boolean;
  onSave: (fields: Fields) => Promise<unknown> | void;
  onSetArtwork: (imagePath: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<Fields>({
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    trackNumber: track.trackNumber,
    year: track.year,
  });

  // Depend on the saved values, not the Track object: every snapshot refresh
  // (e.g. a drag-drop import finishing) delivers fresh objects with identical
  // values, and resetting then would wipe the user's in-progress edits.
  useEffect(() => {
    setDraft({
      title: track.title,
      artist: track.artist,
      album: track.album,
      genre: track.genre,
      trackNumber: track.trackNumber,
      year: track.year,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track.id,
    track.title,
    track.artist,
    track.album,
    track.genre,
    track.trackNumber,
    track.year,
  ]);

  const dirty =
    draft.title !== track.title ||
    draft.artist !== track.artist ||
    draft.album !== track.album ||
    draft.genre !== track.genre ||
    draft.trackNumber !== track.trackNumber ||
    draft.year !== track.year;

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function apply() {
    if (dirty && !busy) onSave(draft);
  }

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
      onKeyDown={(e) => {
        if (e.key === "Escape" && dirty) {
          e.preventDefault();
          setDraft({
            title: track.title,
            artist: track.artist,
            album: track.album,
            genre: track.genre,
            trackNumber: track.trackNumber,
            year: track.year,
          });
        }
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        {/* Live preview of the edited title — the field below IS this text. */}
        <h2 className="truncate text-lg font-semibold">{draft.title}</h2>

        <div className="flex items-center gap-4">
          {track.hasArtwork ? (
            <ArtworkThumb trackId={track.id} size={96} className="rounded-md" />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ImageIcon className="size-7" />
            </div>
          )}
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={pickArtwork}
              disabled={busy}
            >
              Choose Image…
            </Button>
            <p className="text-xs text-muted-foreground">
              {track.hasArtwork ? "Replaces this track's cover art." : "No cover art set."}
            </p>
          </div>
        </div>

        <Field label="Title">
          <Input value={draft.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Artist">
          <Input value={draft.artist} onChange={(e) => set("artist", e.target.value)} />
        </Field>
        <Field label="Album">
          <Input value={draft.album} onChange={(e) => set("album", e.target.value)} />
        </Field>
        <Field label="Genre">
          <GenreField value={draft.genre} onChange={(g) => set("genre", g)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Track #">
            <StepperInput
              min={0}
              max={999}
              value={draft.trackNumber}
              onChange={(n) => set("trackNumber", n)}
            />
          </Field>
          <Field label="Year">
            <StepperInput
              min={0}
              max={2100}
              allowBlank
              value={draft.year}
              placeholder="—"
              onChange={(n) => set("year", n)}
            />
          </Field>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t pt-4 text-sm">
          <InfoRow label="Type" value={track.fileType || "—"} />
          <InfoRow label="Duration" value={formatDuration(track.durationMs)} />
          <InfoRow label="Size" value={formatBytes(track.sizeBytes)} />
          <InfoRow label="Bitrate" value={track.bitrate > 0 ? `${track.bitrate} kbps` : "—"} />
        </dl>
      </div>

      <div className="flex shrink-0 items-center border-t px-5 py-3">
        <Button
          variant="destructive"
          size="sm"
          type="button"
          disabled={busy}
          onClick={onRemove}
        >
          Remove from iPod
        </Button>
        <div className="flex-1" />
        <Button type="submit" size="sm" disabled={!dirty || busy}>
          Apply Changes
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </>
  );
}
