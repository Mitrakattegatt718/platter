import { CheckCircle2, LayoutGrid, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddMusicButton } from "@/components/AddMusicButton";
import type { TrackGrouping, TrackSort } from "@/lib/types";
import { GROUPING_LABELS, SORT_LABELS } from "@/lib/types";

/** The row above the track list. Two states.
 *
 * At two or more selected tracks the search field is replaced by a selection
 * summary and a way out of it. One selected track keeps the search row: the
 * editor on the right already makes a single selection obvious, and swapping
 * this early would take the field away for a selection the user is about to
 * replace with the next click.
 *
 * The search text is NOT cleared by the swap — it lives in App and comes back
 * with the field. A selection that silently discarded the query would be a
 * small data-loss bug, and the user has no way to know it happened.
 *
 * View stays in both states. Regrouping with a selection active is ordinary,
 * and the selection survives it: App recomputes its ordering from the groups
 * without touching the selected set. */
export function LibraryHeaderRow({
  searchValue,
  onSearchChange,
  selectedCount,
  onDeselectAll,
  onAdd,
  addDisabled,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedCount: number;
  onDeselectAll: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  grouping: TrackGrouping;
  onGroupingChange: (grouping: TrackGrouping) => void;
  sort: TrackSort;
  onSortChange: (sort: TrackSort) => void;
}) {
  const selecting = selectedCount >= 2;
  return (
    <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
      {selecting ? (
        <>
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm">{selectedCount} tracks selected</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" title="Clear the selection" onClick={onDeselectAll}>
            Deselect
          </Button>
        </>
      ) : (
        <>
          {/* Add leads the row, ahead of search. It is the only thing here
              that changes the library; search and View only change how it is
              looked at, so a control that writes should not be filed after two
              that read. No empty-library case to handle: the caller does not
              render this row at all until there is music, and the list's
              placeholder carries the one useful action until then. */}
          <AddMusicButton onClick={onAdd} disabled={addDisabled} />
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search title, artist or album"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchValue && (
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onSearchChange("")}
            >
              <X className="size-4" />
            </button>
          )}
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              title="Group the track list by artist, album or genre, and choose its sort order"
            >
              <LayoutGrid /> View
            </Button>
          }
        />
        {/* Each label lives INSIDE its radio group: Base UI's GroupLabel reads
            group context and throws without one. */}
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={grouping}
            onValueChange={(v) => onGroupingChange(v as TrackGrouping)}
          >
            <DropdownMenuLabel>Group By</DropdownMenuLabel>
            {Object.entries(GROUPING_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(v) => onSortChange(v as TrackSort)}
          >
            <DropdownMenuLabel>Sort By</DropdownMenuLabel>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
