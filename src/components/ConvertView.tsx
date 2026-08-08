import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  ChevronRight,
  FolderOpen,
  Loader2,
  Music2,
  Smartphone,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import type {
  ConvertLogBatch,
  ConvertLogLine,
  ConvertProgress,
  Destination,
  Estimate,
  FormatOption,
  JobSummary,
  Rate,
  SourceRow,
  TargetFormat,
  TargetSpec,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/** Ring buffer bound. ffmpeg at -v warning is quiet per file, but a
 * thousand-file batch still outruns any DOM that keeps every line. */
const MAX_LOG_LINES = 2000;

const CBR_CHOICES = [128, 160, 192, 256, 320];

function defaultRate(format: TargetFormat): Rate {
  if (format === "aac") return { cbr: 256 };
  if (format === "mp3") return { cbr: 320 };
  return "lossless";
}

function rateKbps(rate: Rate): number | null {
  return typeof rate === "object" && "cbr" in rate ? rate.cbr : null;
}

export function ConvertView({
  ipodMount,
  onLibraryChanged,
  onProgressChange,
}: {
  /** Mount point of the open library, or null when nothing is connected. */
  ipodMount: string | null;
  /** A finished iPod-destined job changed the library; the shell reloads it. */
  onLibraryChanged: () => void;
  /** Surfaces the running job's fraction on the header tab. */
  onProgressChange: (fraction: number | null) => void;
}) {
  const [formats, setFormats] = useState<FormatOption[]>([]);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [format, setFormat] = useState<TargetFormat>("alac");
  const [rate, setRate] = useState<Rate>("lossless");
  const [folder, setFolder] = useState<string | null>(null);
  const [destKind, setDestKind] = useState<"folder" | "ipod">("ipod");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ConvertProgress | null>(null);
  const [log, setLog] = useState<ConvertLogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const target: TargetSpec = useMemo(
    // ipodSafe is forced whenever the files are headed for the device: the
    // 16-bit / 48 kHz clamp is not the user's to switch off there.
    () => ({ format, rate, ipodSafe: destKind === "ipod" || format !== "flac" }),
    [format, rate, destKind],
  );

  const destination: Destination | null = useMemo(() => {
    if (destKind === "ipod") return ipodMount ? { kind: "ipod" } : null;
    return folder ? { kind: "folder", path: folder } : null;
  }, [destKind, ipodMount, folder]);

  useEffect(() => {
    api.convertFormats().then(setFormats).catch(() => {});
  }, []);

  // No iPod attached means the device destination is not offered at all,
  // rather than offered and then failing.
  useEffect(() => {
    if (!ipodMount && destKind === "ipod") setDestKind("folder");
  }, [ipodMount, destKind]);

  const refreshEstimate = useCallback(async () => {
    if (rows.length === 0 || !destination) {
      setEstimate(null);
      setEstimateError(null);
      return;
    }
    try {
      const result = await api.convertEstimate(target, destination);
      setEstimate(result.estimate);
      setRows(result.rows);
      setEstimateError(null);
    } catch (e) {
      setEstimate(null);
      setEstimateError(String(e));
    }
  }, [rows.length, destination, target]);

  useEffect(() => {
    refreshEstimate();
  }, [refreshEstimate]);

  // Job events. Log lines arrive batched; the ring buffer is trimmed here
  // rather than at render so the DOM never sees the excess.
  useEffect(() => {
    const unlistenProgress = listen<ConvertProgress>("convert:progress", (e) => {
      setProgress(e.payload);
      onProgressChange(e.payload.fraction);
    });
    const unlistenLog = listen<ConvertLogBatch>("convert:log", (e) => {
      setLog((prev) => {
        const next = [...prev, ...e.payload.lines];
        return next.length > MAX_LOG_LINES ? next.slice(next.length - MAX_LOG_LINES) : next;
      });
    });
    const unlistenDone = listen<JobSummary>("convert:done", (e) => {
      setSummary(e.payload);
      setRunning(false);
      setProgress(null);
      onProgressChange(null);
      if (destKind === "ipod" && !e.payload.cancelled) onLibraryChanged();
    });
    return () => {
      unlistenProgress.then((f) => f());
      unlistenLog.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [destKind, onLibraryChanged, onProgressChange]);

  async function addFiles() {
    const picked = await openDialog({
      multiple: true,
      filters: [
        {
          name: "Audio",
          extensions: [
            "mp3", "m4a", "aac",
            "flac", "alac", "wav", "wave", "aif", "aiff", "aifc",
            "ape", "wv", "tta", "dsf", "dff", "shn", "caf", "w64", "rf64", "cue",
          ],
        },
      ],
    });
    if (!picked) return;
    await stage(Array.isArray(picked) ? picked : [picked]);
  }

  async function addFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") await stage([picked]);
  }

  async function stage(paths: string[]) {
    setAdding(true);
    setError(null);
    try {
      setRows(await api.convertAdd(paths));
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  }

  async function chooseFolder() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setFolder(picked);
      setDestKind("folder");
    }
  }

  async function start() {
    if (!destination) return;
    setRunning(true);
    setSummary(null);
    setLog([]);
    setError(null);
    setLogOpen(true);
    try {
      await api.convertStart(target, destination);
    } catch (e) {
      setError(String(e));
      setRunning(false);
      onProgressChange(null);
    }
  }

  const chosen = formats.find((f) => f.format === format);
  const blockedAll = rows.length > 0 && rows.every((r) => r.blocked !== null);
  const wontPlay = destKind === "ipod" && chosen && !chosen.ipodPlayable;
  const blockedReason =
    rows.length === 0
      ? "Add some files first."
      : !destination
        ? destKind === "ipod"
          ? "Connect an iPod, or convert to a folder instead."
          : "Choose where to save the files."
        : chosen?.unavailable
          ? chosen.unavailable
          : wontPlay
            ? `${chosen?.label} doesn't play on an iPod — choose another format or save to this Mac.`
            : blockedAll
              ? "None of these files can be converted to this format."
              : estimate?.verdict === "doesNotFit"
                ? "Not enough free space."
                : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <SourceList
          rows={rows}
          adding={adding}
          onAddFiles={addFiles}
          onAddFolder={addFolder}
          onRemove={async (id) => setRows(await api.convertRemove([id]))}
          onClear={async () => setRows(await api.convertClear())}
        />

        <div className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-l p-5">
          <Section label="Format">
            <div className="grid grid-cols-2 gap-1.5">
              {formats.map((f) => (
                <FormatTile
                  key={f.format}
                  option={f}
                  selected={f.format === format}
                  onSelect={() => {
                    setFormat(f.format);
                    setRate(defaultRate(f.format));
                  }}
                />
              ))}
            </div>
          </Section>

          {chosen && !chosen.lossless && (
            <Section label="Bitrate">
              <div className="flex flex-wrap gap-1">
                {CBR_CHOICES.map((kbps) => (
                  <button
                    key={kbps}
                    type="button"
                    onClick={() => setRate({ cbr: kbps })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs tabular-nums transition-colors",
                      rateKbps(rate) === kbps
                        ? "border-primary bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {kbps}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Encoded with {chosen.encoder}.
              </p>
            </Section>
          )}

          <Section label="Save to">
            <div className="flex flex-col gap-1">
              <DestRow
                icon={<Smartphone className="size-3.5" />}
                title="This iPod"
                detail={ipodMount ?? "No iPod connected"}
                disabled={!ipodMount}
                selected={destKind === "ipod"}
                onSelect={() => setDestKind("ipod")}
              />
              <DestRow
                icon={<FolderOpen className="size-3.5" />}
                title="This Mac"
                detail={folder ?? "Choose a folder…"}
                selected={destKind === "folder"}
                onSelect={() => (folder ? setDestKind("folder") : chooseFolder())}
                onEdit={chooseFolder}
              />
            </div>
          </Section>

          <EstimatePanel
            estimate={estimate}
            error={estimateError}
            lossy={chosen ? !chosen.lossless : false}
          />
        </div>
      </div>

      <ConvertFooter
        running={running}
        progress={progress}
        summary={summary}
        error={error}
        blockedReason={blockedReason}
        log={log}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen((v) => !v)}
        onStart={start}
        onCancel={() => api.cancelConvert()}
        fileCount={estimate?.fileCount ?? 0}
      />
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function FormatTile({
  option,
  selected,
  onSelect,
}: {
  option: FormatOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const disabled = option.unavailable !== null;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={option.unavailable ?? undefined}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : "border-border/60 hover:bg-muted/60",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span className="w-full truncate font-medium">{option.label}</span>
      <span className="flex w-full items-center gap-1 text-[10px] text-muted-foreground">
        <span className="flex-1">.{option.ext}</span>
        {!option.ipodPlayable && (
          <span className="rounded bg-muted px-1 py-px text-[9px]">Mac only</span>
        )}
      </span>
    </button>
  );
}

function DestRow({
  icon,
  title,
  detail,
  selected,
  disabled,
  onSelect,
  onEdit,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
        selected ? "border-primary bg-primary/10" : "border-transparent",
        disabled && "opacity-40",
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {icon}
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{title}</span>
          <span className="truncate text-[10px] text-muted-foreground">{detail}</span>
        </span>
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Change
        </button>
      )}
    </div>
  );
}

function SourceList({
  rows,
  adding,
  onAddFiles,
  onAddFolder,
  onRemove,
  onClear,
}: {
  rows: SourceRow[];
  adding: boolean;
  onAddFiles: () => void;
  onAddFolder: () => void;
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" onClick={onAddFiles} disabled={adding}>
          Add Files…
        </Button>
        <Button variant="outline" size="sm" onClick={onAddFolder} disabled={adding}>
          Add Folder…
        </Button>
        <div className="flex-1" />
        {adding && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {rows.length > 0 && (
          <>
            <span className="text-xs tabular-nums text-muted-foreground">
              {rows.length} file{rows.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
          <Music2 className="size-10" />
          <p className="text-sm font-medium">Nothing to Convert</p>
          <p className="max-w-sm text-xs">
            Add audio files or a folder. PodSync reads each one, works out how big
            the result will be, and tells you whether it fits before anything is
            written.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_90px_90px_70px_24px] items-center gap-2 border-b px-3 py-1.5 text-xs",
                row.blocked && "opacity-60",
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate" title={row.srcPath}>
                  {row.display}
                </span>
                {row.blocked && (
                  <span className="flex items-center gap-1 truncate text-[10px] text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="size-2.5 shrink-0" />
                    {row.blocked}
                  </span>
                )}
              </div>
              <span className="truncate text-muted-foreground">{row.codec}</span>
              <span className="tabular-nums text-muted-foreground">
                {row.sampleRate > 0 ? `${(row.sampleRate / 1000).toFixed(1)} kHz` : "—"}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {row.durationS > 0 ? formatDuration(row.durationS * 1000) : "—"}
              </span>
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${row.display}`}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const VERDICT_COPY: Record<string, { tone: string; text: string }> = {
  fits: { tone: "text-muted-foreground", text: "Fits" },
  tight: { tone: "text-amber-600 dark:text-amber-500", text: "Should fit, but it's close" },
  doesNotFit: { tone: "text-destructive", text: "Not enough free space" },
  unknown: { tone: "text-muted-foreground", text: "Can't tell — no file lengths known" },
};

function EstimatePanel({
  estimate,
  error,
  lossy,
}: {
  estimate: Estimate | null;
  error: string | null;
  lossy: boolean;
}) {
  if (error) {
    return (
      <p className="border-t pt-4 text-xs text-destructive">{error}</p>
    );
  }
  if (!estimate) {
    return (
      <p className="border-t pt-4 text-xs text-muted-foreground">
        Add files to see how much space the result needs.
      </p>
    );
  }
  const verdict = VERDICT_COPY[estimate.verdict] ?? VERDICT_COPY.unknown;
  return (
    <div className="flex flex-col gap-2 border-t pt-4 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Files</dt>
        <dd className="text-right tabular-nums">{estimate.fileCount}</dd>
        <dt className="text-muted-foreground">Length</dt>
        <dd className="text-right tabular-nums">
          {formatDuration(estimate.totalDurationS * 1000)}
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd className="text-right tabular-nums">{formatBytes(estimate.sourceBytes)}</dd>
        <dt className="text-muted-foreground">Result</dt>
        <dd className="text-right tabular-nums">
          {/* "about" disappears only when the arithmetic really is exact —
              PCM containers and CBR MP3. Everything else is a band. */}
          {estimate.exact ? "" : "about "}
          {formatBytes(estimate.likelyBytes)}
        </dd>
        {!estimate.exact && (
          <>
            <dt className="text-muted-foreground">Up to</dt>
            <dd className="text-right tabular-nums">{formatBytes(estimate.highBytes)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Free</dt>
        <dd className="text-right tabular-nums">{formatBytes(estimate.destFreeBytes)}</dd>
      </dl>

      <p className={cn("font-medium", verdict.tone)}>{verdict.text}</p>

      {estimate.oversizeFiles.length > 0 && (
        <p className="text-destructive">
          {estimate.oversizeFiles.length} file
          {estimate.oversizeFiles.length === 1 ? "" : "s"} would exceed the 4 GB
          per-file limit of a FAT32 volume.
        </p>
      )}
      {estimate.notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
      {lossy && (
        <p className="text-muted-foreground">
          Lossy encoding discards detail permanently — keep your originals.
        </p>
      )}
    </div>
  );
}

function ConvertFooter({
  running,
  progress,
  summary,
  error,
  blockedReason,
  log,
  logOpen,
  onToggleLog,
  onStart,
  onCancel,
  fileCount,
}: {
  running: boolean;
  progress: ConvertProgress | null;
  summary: JobSummary | null;
  error: string | null;
  blockedReason: string | null;
  log: ConvertLogLine[];
  logOpen: boolean;
  onToggleLog: () => void;
  onStart: () => void;
  onCancel: () => void;
  fileCount: number;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  // Pinned to the bottom unless the user has scrolled up to read something.
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [log]);

  // "Finishing" is honest: once libgpod starts copying, cancelling cannot
  // undo what is already on the device.
  const finishing = progress?.phase === "importing";

  return (
    <div className="shrink-0 border-t">
      {logOpen && (
        <div
          ref={logRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-40 overflow-y-auto border-b bg-muted/30 px-3 py-2 font-mono text-[10px] leading-relaxed"
        >
          {log.length === 0 ? (
            <p className="text-muted-foreground">No output yet.</p>
          ) : (
            log.map((line) => (
              <div
                key={line.seq}
                className={cn(
                  "whitespace-pre-wrap break-all",
                  line.level === "error" && "text-destructive",
                  line.level === "warn" && "text-amber-600 dark:text-amber-500",
                  line.level === "cmd" && "text-muted-foreground",
                )}
              >
                {line.file ? `${line.file}: ${line.line}` : line.line}
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={onToggleLog}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("size-3 transition-transform", logOpen && "rotate-90")} />
          Log
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {running && progress ? (
            <>
              <span className="truncate text-xs text-muted-foreground">
                {finishing
                  ? "Finishing — writing to the iPod…"
                  : `Converting ${progress.done} of ${progress.total}${
                      progress.current ? ` — ${progress.current}` : ""
                    }`}
              </span>
              <Progress value={(progress.fraction ?? 0) * 100} />
            </>
          ) : summary ? (
            <span className="truncate text-xs text-muted-foreground">
              {summary.cancelled
                ? "Cancelled."
                : `${summary.converted} converted${
                    summary.failed > 0 ? `, ${summary.failed} failed` : ""
                  }${
                    summary.outputBytes > 0 ? ` · ${formatBytes(summary.outputBytes)} written` : ""
                  }`}
            </span>
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {error ?? blockedReason ?? ""}
            </span>
          )}
        </div>

        {running ? (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={finishing}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" onClick={onStart} disabled={blockedReason !== null}>
            Convert{fileCount > 0 ? ` ${fileCount}` : ""}
          </Button>
        )}
      </div>
    </div>
  );
}
