import { useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Highlight } from "@/components/Highlight";
import { COMMON_GENRES } from "@/lib/types";
import { cn } from "@/lib/utils";

const OTHER = "__other__"; // sentinel value checked in onValueChange
const NONE = "__none__"; // bulk-edit "clear genre" row

/** Listed genres, minus Other — Other always sits last, under a hairline,
 * and opens the free-text input instead of being itself the value. */
const LISTED = COMMON_GENRES.filter((g) => g !== "Other");

function isCustomValue(v: string): boolean {
  return v !== "" && v !== "Other" && !COMMON_GENRES.includes(v);
}

/** Genre picker: combobox with type-to-filter + match highlight.
 *  "Other" (always last, separated) reveals a text input for a custom genre.
 *  Value/onChange contract is a plain genre string, same as before.
 *
 *  Search discipline: at rest the input shows the selected label; the moment
 *  the popup opens (chevron, click-in, or tab-in) the input switches to a
 *  blank search field, and typing replaces rather than appends. */
export function GenreField({
  value,
  onChange,
  allowEmpty = false,
}: {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  const [customMode, setCustomMode] = useState(() => isCustomValue(value));
  const customDraftRef = useRef(isCustomValue(value) ? value : "");
  const customInputRef = useRef<HTMLInputElement>(null);

  const labelOf = () => {
    if (customMode) return "Other";
    if (value === "") return allowEmpty ? "—" : "";
    return value;
  };
  /** null = resting (show the label); a string = the live search text. */
  const [search, setSearch] = useState<string | null>(null);
  const query = search ?? "";

  const trimmed = query.trim().toLowerCase();
  const filtered = LISTED.filter((g) => g.toLowerCase().includes(trimmed));

  function commit(next: string) {
    onChange(next);
    if (isCustomValue(next)) customDraftRef.current = next;
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox.Root
        value={customMode ? OTHER : value === "" ? (allowEmpty ? NONE : null) : value}
        inputValue={search ?? labelOf()}
        onInputValueChange={(v) => setSearch(v)}
        onValueChange={(v) => {
          setSearch(null);
          if (v === OTHER) {
            setCustomMode(true);
            commit(customDraftRef.current);
            requestAnimationFrame(() => customInputRef.current?.focus());
          } else {
            setCustomMode(false);
            commit(v === NONE || v === null ? "" : v);
          }
        }}
      >
        <div className="relative">
          <Combobox.Input
            placeholder="Pick a genre"
            onFocus={() => setSearch("")}
            onBlur={() => setSearch(null)}
            className={cn(
              "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 pr-8 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30",
            )}
          />
          <Combobox.Trigger
            aria-label="Show genre options"
            className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => setSearch("")}
          >
            <ChevronDown className="size-4" />
          </Combobox.Trigger>
        </div>

        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
            <Combobox.Popup className="w-(--anchor-width) min-w-36 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              <Combobox.List className="max-h-56 overflow-y-auto p-1">
                {allowEmpty && (
                  <GenreOption value={NONE} label="—" query={query} current={value === ""} />
                )}
                {filtered.map((g) => (
                  <GenreOption
                    key={g}
                    value={g}
                    label={g}
                    query={query}
                    current={!customMode && value === g}
                  />
                ))}
                {trimmed !== "" && filtered.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No matches — use Other below.
                  </div>
                )}
                {/* Other never filters out: it's the fallback hatch, kept last
                    and separated per the control's grammar. */}
                <Combobox.Separator className="-mx-1 my-1 h-px bg-border" />
                <GenreOption
                  value={OTHER}
                  label="Other"
                  query={query}
                  current={customMode}
                />
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      {customMode && (
        <Input
          ref={customInputRef}
          placeholder="Custom genre"
          value={isCustomValue(value) ? value : ""}
          onChange={(e) => commit(e.target.value)}
          title="Free-text genre — the iPod builds its Genres menu from whatever values exist"
        />
      )}
    </div>
  );
}

function GenreOption({
  value,
  label,
  query,
  current,
}: {
  value: string;
  label: string;
  query: string;
  current: boolean;
}) {
  return (
    <Combobox.Item
      value={value}
      className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
    >
      <Highlight text={label} query={query.trim()} />
      {current && (
        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
          <Check className="size-4 text-muted-foreground" />
        </span>
      )}
    </Combobox.Item>
  );
}
