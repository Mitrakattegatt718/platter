import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The one control that puts music into the app, drawn the same wherever it
 * appears.
 *
 * There were four of these and no two matched: ghost "Add" in the library
 * toolbar, a large primary "Add Music" in its empty state, and outline
 * "Add Music…" twice over in Convert. They open different dialogs — the
 * importer on one screen, the file panel on the other — but to a user they are
 * the same move, and a move that looks different in four places reads as four
 * different moves.
 *
 * Two treatments, not one. `prominent` is for an empty pane, where this is the
 * only thing worth doing and gets the middle of the surface; the default is for
 * a toolbar, where it sits among controls that only change how existing music
 * is looked at. Outline rather than ghost there on purpose: search and View
 * read, this one writes, and the edge is what says so.
 *
 * The ellipsis is load-bearing in both — every caller opens something.
 */
export function AddMusicButton({
  onClick,
  disabled = false,
  prominent = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** True on an empty pane, where this is the whole point of the screen. */
  prominent?: boolean;
}) {
  return (
    <Button
      variant={prominent ? "default" : "outline"}
      size={prominent ? "lg" : "sm"}
      className={prominent ? "px-6" : undefined}
      disabled={disabled}
      onClick={onClick}
      title="Import MP3/M4A directly, or convert FLAC, WAV and other lossless files to Apple Lossless — or drag files and folders onto the window"
    >
      <Plus /> Add Music…
    </Button>
  );
}
