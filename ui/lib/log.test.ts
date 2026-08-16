import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogBuffer,
  describeError,
  formatLine,
  isBenignError,
  summarizeArgs,
  summarizeValue,
  type LogLine,
} from "./log";

describe("summarizeValue", () => {
  it("keeps short scalars verbatim", () => {
    expect(summarizeValue("/Volumes/IPOD")).toBe('"/Volumes/IPOD"');
    expect(summarizeValue(412)).toBe("412");
    expect(summarizeValue(true)).toBe("true");
    expect(summarizeValue(null)).toBe("null");
  });

  it("truncates a long string rather than wrapping the line", () => {
    const rendered = summarizeValue("x".repeat(200));
    expect(rendered.length).toBeLessThan(100);
    expect(rendered.endsWith("…")).toBe(true);
  });

  it("counts a collection instead of dumping it", () => {
    // import_tracks carries thousands of records with cover art attached.
    expect(summarizeValue(new Array(4000).fill({}))).toBe("[4000 items]");
  });

  it("keeps a single-element array legible — that's the common case", () => {
    expect(summarizeValue(["/tmp/a.flac"])).toBe('["/tmp/a.flac"]');
  });

  it("reduces an object to its shape", () => {
    expect(summarizeValue({ id: "1", fields: {} })).toBe("{id,fields}");
    expect(summarizeValue({})).toBe("{}");
  });
});

describe("summarizeArgs", () => {
  it("renders a call's shape with its values", () => {
    expect(summarizeArgs({ mountPoint: "/Volumes/IPOD", size: 64 })).toBe(
      'mountPoint="/Volumes/IPOD" size=64',
    );
  });

  it("drops undefined and handles no args at all", () => {
    expect(summarizeArgs({ a: 1, b: undefined })).toBe("a=1");
    expect(summarizeArgs()).toBe("");
  });
});

describe("formatLine", () => {
  it("leaves a bare event alone", () => {
    expect(formatLine("view.change")).toBe("view.change");
  });

  it("passes a string detail through unquoted — it's already prose", () => {
    expect(formatLine("view.change", "library → convert")).toBe(
      "view.change library → convert",
    );
  });

  it("summarizes anything else", () => {
    expect(formatLine("cmd.call", { ids: [1, 2] })).toBe("cmd.call {ids}");
  });
});

describe("describeError", () => {
  it("unwraps both shapes a rejection arrives in", () => {
    // Tauri commands reject with a plain string; everything else throws.
    expect(describeError("no iPod at /Volumes/X")).toBe("no iPod at /Volumes/X");
    expect(describeError(new Error("boom"))).toBe("boom");
  });
});

describe("isBenignError", () => {
  it("catches the two the app actually raises, trailers and all", () => {
    // Both observed in a real session log, verbatim.
    expect(
      isBenignError("ResizeObserver loop completed with undelivered notifications."),
    ).toBe(true);
    expect(
      isBenignError(
        "webview.internal_toggle_devtools explicitly denied on origin local\n\nreferenced by: capability: default, permission: deny-internal-toggle-devtools",
      ),
    ).toBe(true);
  });

  it("leaves real failures alone", () => {
    expect(isBenignError("Couldn't open iPod library: itdb_parse failed")).toBe(false);
    expect(isBenignError("undefined is not an object (evaluating 'x.y')")).toBe(false);
    // Near-misses must not be swallowed: a genuine fault in observer code
    // still has to reach the user.
    expect(isBenignError("ResizeObserver is not defined")).toBe(false);
  });
});

describe("createLogBuffer", () => {
  let sent: LogLine[][];
  let sink: (lines: LogLine[]) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    sink = (lines) => sent.push(lines);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches info lines into one delivery", () => {
    const log = createLogBuffer(sink, { flushDelayMs: 250 });
    log.info("a");
    log.info("b");
    expect(sent).toHaveLength(0);

    vi.advanceTimersByTime(250);

    expect(sent).toHaveLength(1);
    expect(sent[0].map((l) => l.message)).toEqual(["a", "b"]);
  });

  it("sends an error at once — the next thing may be a crash", () => {
    const log = createLogBuffer(sink, { flushDelayMs: 250 });
    log.info("before");
    log.error("boom", "detail");

    expect(sent).toHaveLength(1);
    expect(sent[0].map((l) => l.level)).toEqual(["info", "error"]);
  });

  it("flushes on demand, for ordering against a command", () => {
    const log = createLogBuffer(sink, { flushDelayMs: 250 });
    log.info("clicked");
    log.flush();
    expect(sent[0][0].message).toBe("clicked");

    // The pending timer must not fire a second, empty delivery.
    vi.advanceTimersByTime(250);
    expect(sent).toHaveLength(1);
  });

  it("does nothing when there is nothing to send", () => {
    const log = createLogBuffer(sink);
    log.flush();
    expect(sent).toHaveLength(0);
  });

  it("drops the oldest lines on overflow and says so", () => {
    const log = createLogBuffer(sink, { flushDelayMs: 250, maxPending: 3 });
    for (const message of ["1", "2", "3", "4", "5"]) log.info(message);

    vi.advanceTimersByTime(250);

    const messages = sent[0].map((l) => l.message);
    expect(messages[0]).toContain("2 line(s) dropped");
    // Nearest the failure is what's kept.
    expect(messages.slice(1)).toEqual(["3", "4", "5"]);
  });

  it("reports an overflow once, not on every later flush", () => {
    const log = createLogBuffer(sink, { flushDelayMs: 250, maxPending: 1 });
    log.info("1");
    log.info("2");
    vi.advanceTimersByTime(250);
    log.info("3");
    vi.advanceTimersByTime(250);

    expect(sent[1].map((l) => l.message)).toEqual(["3"]);
  });
});
