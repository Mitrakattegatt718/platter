import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { GenreField } from "@/components/GenreField";
import { StepperInput } from "@/components/StepperInput";
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatIpodPath,
  formatRating,
  formatSampleRate,
} from "@/lib/format";
import type { Track, TrackFields } from "@/lib/types";

/** The draft mirrors TrackFields exactly, so `dirty` is a key-by-key compare
 * and Apply sends the object straight through. */
const FIELD_KEYS = [
  "title",
  "artist",
  "albumArtist",
  "album",
  "composer",
  "genre",
  "trackNumber",
  "trackCount",
  "discNumber",
  "discCount",
  "year",
] as const;

function fieldsOf(track: Track): TrackFields {
  return {
    title: track.title,
    artist: track.artist,
    albumArtist: track.albumArtist,
    album: track.album,
    composer: track.composer,
    genre: track.genre,
    trackNumber: track.trackNumber,
    trackCount: track.trackCount,
    discNumber: track.discNumber,
    discCount: track.discCount,
    year: track.year,
  };
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
  onSave: (fields: TrackFields) => Promise<unknown> | void;
  onSetArtwork: (imagePath: string) => void;
  onRemove: () => void;
}) {
  const saved = fieldsOf(track);
  const [draft, setDraft] = useState<TrackFields>(saved);

  // Depend on the saved values, not the Track object: every snapshot refresh
  // (e.g. a drag-drop import finishing) delivers fresh objects with identical
  // values, and resetting then would wipe the user's in-progress edits.
  useEffect(() => {
    setDraft(fieldsOf(track));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track.id,
    track.title,
    track.artist,
    track.albumArtist,
    track.album,
    track.composer,
    track.genre,
    track.trackNumber,
    track.trackCount,
    track.discNumber,
    track.discCount,
    track.year,
  ]);

  const dirty = FIELD_KEYS.some((k) => draft[k] !== saved[k]);

  const set = <K extends keyof TrackFields>(key: K, value: TrackFields[K]) =>
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
          setDraft(fieldsOf(track));
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
        <Field
          label="Album Artist"
          hint={draft.albumArtist ? undefined : "Falls back to the artist"}
        >
          <Input
            value={draft.albumArtist}
            placeholder={draft.artist}
            onChange={(e) => set("albumArtist", e.target.value)}
            title="What the iPod groups the album under. Set this to keep a compilation together."
          />
        </Field>
        <Field label="Album">
          <Input value={draft.album} onChange={(e) => set("album", e.target.value)} />
        </Field>
        <Field label="Composer">
          <Input
            value={draft.composer}
            placeholder="—"
            onChange={(e) => set("composer", e.target.value)}
            title="Shown under the Classic's Composers menu"
          />
        </Field>
        <Field label="Genre">
          <GenreField value={draft.genre} onChange={(g) => set("genre", g)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <PairField
            label="Track"
            value={draft.trackNumber}
            total={draft.trackCount}
            onValue={(n) => set("trackNumber", n)}
            onTotal={(n) => set("trackCount", n)}
          />
          <PairField
            label="Disc"
            value={draft.discNumber}
            total={draft.discCount}
            onValue={(n) => set("discNumber", n)}
            onTotal={(n) => set("discCount", n)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
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
          <InfoRow label="Sample rate" value={formatSampleRate(track.sampleRate)} />
          <InfoRow label="Plays" value={track.playCount > 0 ? `${track.playCount}` : "—"} />
          <InfoRow label="Rating" value={formatRating(track.rating)} />
          <InfoRow label="Last played" value={formatDate(track.lastPlayed)} />
          <InfoRow label="Date added" value={formatDate(track.dateAdded)} />
        </dl>

        {/* Collapsed by default: three answers to "the track is in the list but
         * the iPod won't play it", and noise the rest of the time. */}
        <details className="border-t pt-3 text-sm">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
            Diagnostics
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
            <InfoRow
              label="On device"
              value={track.transferred ? "Yes" : "No — file missing"}
              warn={!track.transferred}
            />
            <InfoRow
              label="Protected"
              value={track.hasDrm ? "Yes — FairPlay DRM" : "No"}
              warn={track.hasDrm}
            />
          </dl>
          <div className="mt-2 flex flex-col gap-1">
            <dt className="text-muted-foreground">Location</dt>
            <dd className="font-mono text-[11px] leading-snug break-all text-muted-foreground/80">
              {formatIpodPath(track.ipodPath)}
            </dd>
          </div>
        </details>
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-baseline gap-1.5 text-xs font-normal text-muted-foreground">
        {label}
        {hint && <span className="text-muted-foreground/70">· {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/** "3 of 12" — position and total side by side, since one without the other
 * is what produces the Classic's half-labelled album listings. */
function PairField({
  label,
  value,
  total,
  onValue,
  onTotal,
}: {
  label: string;
  value: number;
  total: number;
  onValue: (n: number) => void;
  onTotal: (n: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        {/* min-w-0 so the pair shrinks with the panel instead of overflowing
         * — the inputs carry pr-7 for their steppers and won't shrink on
         * their own. */}
        <StepperInput
          className="min-w-0 flex-1"
          allowBlank
          value={value}
          placeholder="—"
          onChange={onValue}
        />
        <span className="shrink-0 text-xs text-muted-foreground">of</span>
        <StepperInput
          className="min-w-0 flex-1"
          allowBlank
          value={total}
          placeholder="—"
          onChange={onTotal}
        />
      </div>
    </Field>
  );
}

function InfoRow({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  /** Draws attention to a state that explains a broken track. */
  warn?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          warn
            ? "flex items-center justify-end gap-1.5 text-right text-destructive"
            : "text-right tabular-nums"
        }
      >
        {warn && <AlertTriangle className="size-3.5 shrink-0" />}
        {value}
      </dd>
    </>
  );
}
