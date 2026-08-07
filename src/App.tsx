import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LayoutGrid, Music, Plus, Usb } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { BulkEditPanel } from "@/components/BulkEditPanel";
import { CapacityGauge } from "@/components/CapacityGauge";
import { ImportDialog } from "@/components/ImportDialog";
import { DisconnectedView } from "@/components/DisconnectedView";
import { MountPickerDialog } from "@/components/MountPickerDialog";
import { ProgressBanner } from "@/components/ProgressBanner";
import { TrackEditPanel } from "@/components/TrackEditPanel";
import { TrackList } from "@/components/TrackList";
import { api, invalidateArtwork } from "@/lib/api";
import {
  flattenRows,
  groupTracks,
  visibleTrackIds,
  type AlbumSubgroup,
} from "@/lib/grouping";
import type {
  ImportOutcome,
  ImportResult,
  LibrarySnapshot,
  PendingImport,
  Progress,
  TrackGrouping,
  TrackSort,
} from "@/lib/types";
import { GROUPING_LABELS, SORT_LABELS } from "@/lib/types";

const EMPTY_SNAPSHOT: LibrarySnapshot = {
  mountPoint: null,
  tracks: [],
  capacity: null,
};

function EjectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="M5 13 L12 5 L19 13 Z" strokeLinejoin="round" />
      <line x1="5" y1="18" x2="19" y2="18" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(EMPTY_SNAPSHOT);
  // A counter, not a flag: operations can overlap (a drop during an import
  // queues behind the backend mutex), and the banner must stay up until the
  // last one finishes.
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  const [search, setSearch] = useState("");
  // Grouping recomputation trails typing so keystrokes stay responsive.
  const deferredSearch = useDeferredValue(search);
  const [grouping, setGrouping] = useState<TrackGrouping>(
    () => (localStorage.getItem("trackGrouping") as TrackGrouping) || "artist",
  );
  const [sort, setSort] = useState<TrackSort>(
    () => (localStorage.getItem("trackSort") as TrackSort) || "albumOrder",
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedAlbums, setCollapsedAlbums] = useState<Set<string>>(new Set());
  const [showImporter, setShowImporter] = useState(false);
  const [showMountPicker, setShowMountPicker] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [detailWidth, setDetailWidth] = useState(440);
  const detailRef = useRef<HTMLDivElement>(null);

  const isOpen = snapshot.mountPoint !== null;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    localStorage.setItem("trackGrouping", grouping);
  }, [grouping]);
  useEffect(() => {
    localStorage.setItem("trackSort", sort);
  }, [sort]);

  useEffect(() => {
    const title = snapshot.mountPoint ? `iPod (${snapshot.mountPoint})` : "PodSync";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [snapshot.mountPoint]);

  // The window starts hidden (tauri.conf.json) so launch never flashes an
  // unpainted white surface; show it once React has committed a frame.
  useEffect(() => {
    getCurrentWindow().show().catch(() => {});
  }, []);

  /** Runs a backend call with the shared busy counter and error alert. */
  const run = useCallback(async <T,>(work: Promise<T>): Promise<T | null> => {
    setBusyCount((c) => c + 1);
    setProgress(null);
    try {
      return await work;
    } catch (e) {
      setLastError(String(e));
      return null;
    } finally {
      setBusyCount((c) => c - 1);
      setProgress(null);
    }
  }, []);

  const applySnapshot = useCallback((next: LibrarySnapshot) => {
    setSnapshot(next);
    const alive = new Set(next.tracks.map((t) => t.id));
    setSelection((prev) => new Set([...prev].filter((id) => alive.has(id))));
  }, []);

  // Progress events from imports and tag reads.
  useEffect(() => {
    const unlisten = listen<Progress>("progress", (e) => setProgress(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleImportResult = useCallback(
    (result: ImportResult | null): ImportOutcome => {
      if (!result) return { ok: false, failedIndices: [] };
      applySnapshot(result.snapshot);
      if (result.failures.length > 0) {
        setLastError(result.failures.join("\n"));
      }
      return { ok: result.failures.length === 0, failedIndices: result.failedIndices };
    },
    [applySnapshot],
  );

  // Files dropped anywhere on the window import into the library.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const kind = event.payload.type;
      if (kind === "over" || kind === "enter") {
        setIsDropTarget(true);
      } else if (kind === "drop") {
        setIsDropTarget(false);
        if (!isOpenRef.current) {
          setLastError("Connect an iPod before adding songs.");
          return;
        }
        const paths = event.payload.paths;
        if (paths.length > 0) {
          run(api.importFiles(paths)).then(handleImportResult);
        }
      } else {
        setIsDropTarget(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [run, handleImportResult]);

  // At launch: if the last-connected iPod is still mounted, connect silently;
  // otherwise the disconnected empty state is already the connect surface.
  const didLaunchConnect = useRef(false);
  useEffect(() => {
    if (didLaunchConnect.current) return;
    didLaunchConnect.current = true;
    (async () => {
      const last = localStorage.getItem("lastMountPoint");
      if (last) {
        const volumes = await api.listVolumes().catch(() => []);
        if (volumes.some((v) => v.path === last)) {
          const result = await run(api.openLibrary(last));
          if (result) {
            invalidateArtwork();
            applySnapshot(result);
          }
        }
      }
      // No silent connect: the disconnected empty state is the connect surface,
      // so there's no reason to auto-open the mount-picker dialog on launch.
    })();
  }, [run, applySnapshot]);

  const connect = useCallback(
    async (mountPoint: string): Promise<boolean> => {
      const result = await run(api.openLibrary(mountPoint));
      if (!result) return false;
      invalidateArtwork();
      applySnapshot(result);
      localStorage.setItem("lastMountPoint", mountPoint);
      return true;
    },
    [run, applySnapshot],
  );

  const eject = useCallback(async () => {
    const result = await run(api.ejectIpod());
    // Even when diskutil refuses, the backend has closed the library.
    invalidateArtwork();
    applySnapshot(result ?? EMPTY_SNAPSHOT);
  }, [run, applySnapshot]);

  const groups = useMemo(
    () => groupTracks(snapshot.tracks, grouping, sort, deferredSearch),
    [snapshot.tracks, grouping, sort, deferredSearch],
  );

  const rows = useMemo(
    () => flattenRows(groups, grouping, collapsedGroups, collapsedAlbums),
    [groups, grouping, collapsedGroups, collapsedAlbums],
  );

  const visibleIds = useMemo(() => visibleTrackIds(rows), [rows]);

  /** Every track in display order, IGNORING collapse state — collapsing a
   * section must not silently drop its tracks from the active selection
   * (matching the SwiftUI app, which flatMapped all groups). Search still
   * filters, because groups themselves are built from the filtered set. */
  const orderedIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groups) {
      if (group.albums) {
        for (const album of group.albums) for (const t of album.tracks) ids.push(t.id);
      } else {
        for (const t of group.tracks) ids.push(t.id);
      }
    }
    return ids;
  }, [groups]);

  const trackById = useMemo(
    () => new Map(snapshot.tracks.map((t) => [t.id, t])),
    [snapshot.tracks],
  );

  /** Tracks the user has selected, in the order they appear in the list. */
  const selectedTracks = useMemo(
    () => orderedIds.filter((id) => selection.has(id)).map((id) => trackById.get(id)!),
    [orderedIds, selection, trackById],
  );

  const selectionKey = useMemo(() => [...selection].sort().join(","), [selection]);

  const handleRowClick = useCallback(
    (trackId: string, event: React.MouseEvent) => {
      setSelection((prev) => {
        if (event.shiftKey && anchorRef.current) {
          const from = visibleIds.indexOf(anchorRef.current);
          const to = visibleIds.indexOf(trackId);
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from];
            return new Set(visibleIds.slice(lo, hi + 1));
          }
        }
        if (event.metaKey || event.ctrlKey) {
          const next = new Set(prev);
          if (next.has(trackId)) next.delete(trackId);
          else next.add(trackId);
          anchorRef.current = trackId;
          return next;
        }
        anchorRef.current = trackId;
        return new Set([trackId]);
      });
    },
    [visibleIds],
  );

  const toggleAlbumSelection = useCallback((album: AlbumSubgroup) => {
    setSelection((prev) => {
      const next = new Set(prev);
      const allSelected = album.tracks.every((t) => next.has(t.id));
      for (const t of album.tracks) {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAlbum = useCallback((id: string) => {
    setCollapsedAlbums((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // The drag writes the width straight to the pane element; React state is
  // committed once on mouseup, so dragging costs one style write per move
  // instead of a full re-render.
  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = detailRef.current?.offsetWidth ?? detailWidth;
    let latest = startWidth;
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(720, Math.max(400, startWidth + (startX - ev.clientX)));
      if (detailRef.current) detailRef.current.style.width = `${latest}px`;
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDetailWidth(latest);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const importTracks = useCallback(
    async (items: PendingImport[]): Promise<ImportOutcome> => {
      const result = await run(api.importTracks(items));
      return handleImportResult(result);
    },
    [run, handleImportResult],
  );

  const readTags = useCallback(
    (paths: string[]) => run(api.readTags(paths)),
    [run],
  );

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Tools row only exists once a library is open — while disconnected the
          connect surface owns the whole window (the native titlebar still
          shows "PodSync"). */}
      {isOpen && (
        <header className="flex h-11 shrink-0 items-center border-b px-3">
        <span className="text-sm font-semibold">
          {snapshot.mountPoint ? `iPod (${snapshot.mountPoint})` : "PodSync"}
        </span>
        <CapacityGauge capacity={snapshot.capacity} />
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title="Choose the mounted iPod volume to open"
            onClick={() => setShowMountPicker(true)}
          >
            <Usb /> Connect
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!isOpen || busy}
            title="Import MP3/M4A directly, or convert FLAC, WAV and other lossless files to Apple Lossless — or drag files and folders onto the track list"
            onClick={() => setShowImporter(true)}
          >
            <Plus /> Add Songs
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!isOpen || busy}
            title="Disconnect and eject the iPod so you can safely unplug it"
            onClick={eject}
          >
            <EjectIcon /> Eject
          </Button>
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
            {/* Each label lives INSIDE its radio group: Base UI's GroupLabel
                reads group context and throws without one. */}
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={grouping}
                onValueChange={(v) => setGrouping(v as TrackGrouping)}
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
                onValueChange={(v) => setSort(v as TrackSort)}
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
      </header>
      )}

      <div className="relative flex min-h-0 flex-1">
        {isOpen ? (
          <>
            <div className="min-w-80 flex-1">
              <TrackList
                rows={rows}
                searchValue={search}
                searchQuery={deferredSearch}
                onSearchChange={setSearch}
                selection={selection}
                onRowClick={handleRowClick}
                collapsedGroups={collapsedGroups}
                collapsedAlbums={collapsedAlbums}
                onToggleGroup={toggleGroup}
                onToggleAlbum={toggleAlbum}
                onToggleAlbumSelection={toggleAlbumSelection}
                isDropTarget={isDropTarget}
              />
            </div>

            <div
              className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40"
              onMouseDown={startResize}
            />

            <div
              ref={detailRef}
              className="shrink-0 overflow-hidden"
              style={{ width: detailWidth }}
            >
              {selectedTracks.length === 1 ? (
                <TrackEditPanel
                  key={selectedTracks[0].id}
                  track={selectedTracks[0]}
                  busy={busy}
                  onSave={(fields) =>
                    run(api.updateTrack({ id: selectedTracks[0].id, ...fields })).then(
                      (s) => s && applySnapshot(s),
                    )
                  }
                  onSetArtwork={(path) => {
                    const ids = [selectedTracks[0].id];
                    run(api.setArtwork(ids, path)).then((s) => {
                      if (s) {
                        invalidateArtwork(ids);
                        applySnapshot(s);
                      }
                    });
                  }}
                  onRemove={() => {
                    const ids = [selectedTracks[0].id];
                    run(api.removeTracks(ids)).then((s) => {
                      if (s) {
                        invalidateArtwork(ids);
                        applySnapshot(s);
                      }
                    });
                  }}
                />
              ) : selectedTracks.length > 1 ? (
                <BulkEditPanel
                  key={selectionKey}
                  tracks={selectedTracks}
                  busy={busy}
                  onSetField={(field, value) =>
                    run(api.setField(selectedTracks.map((t) => t.id), field, value)).then(
                      (s) => s && applySnapshot(s),
                    )
                  }
                  onSetArtwork={(path) => {
                    const ids = selectedTracks.map((t) => t.id);
                    run(api.setArtwork(ids, path)).then((s) => {
                      if (s) {
                        invalidateArtwork(ids);
                        applySnapshot(s);
                      }
                    });
                  }}
                  onRemove={() => {
                    const ids = selectedTracks.map((t) => t.id);
                    run(api.removeTracks(ids)).then((s) => {
                      if (s) {
                        invalidateArtwork(ids);
                        applySnapshot(s);
                      }
                    });
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
                  <Music className="size-10" />
                  <p className="font-medium">No Track Selected</p>
                  <p className="max-w-60 text-xs">
                    Select a track to edit it, or ⌘-click several to edit them
                    together.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <DisconnectedView
            onConnect={connect}
            onChooseManually={() => setShowMountPicker(true)}
          />
        )}

        <ProgressBanner busy={busy} progress={progress} />
      </div>

      <MountPickerDialog
        open={showMountPicker}
        onOpenChange={setShowMountPicker}
        onConnect={connect}
      />

      <ImportDialog
        open={showImporter}
        onOpenChange={setShowImporter}
        onReadTags={readTags}
        onImport={importTracks}
      />

      <AlertDialog open={lastError !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Error</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {lastError}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setLastError(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
