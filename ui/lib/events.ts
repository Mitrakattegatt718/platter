/** Tearing down a Tauri event subscription, without the teardown taking the
 * app down with it.
 *
 * `listen()` resolves as soon as the *command* replies, but the bookkeeping it
 * depends on is installed separately: the Rust side evaluates a small script
 * in the webview that records the new listener under
 * `window.__TAURI_EVENT_LISTENERS__[event][id]`. Those two arrive over
 * different paths, so the reply can beat the script.
 *
 * That gap is only observable if you unsubscribe inside it — and then
 * `unregisterListener` reads `listeners[eventId].handlerId` off an entry that
 * is not there yet and throws `TypeError: undefined is not an object`
 * (tauri 2.11.5, `src/event/mod.rs`, no guard on the lookup). React's
 * StrictMode makes exactly that window routine in development: every effect
 * mounts, tears down and mounts again immediately, so a subscribe/unsubscribe
 * pair can land inside a single frame.
 *
 * Two things go wrong when it does. The throw happens before
 * `plugin:event|unlisten` is invoked, so the *backend* listener survives —
 * every StrictMode cycle leaks one more, and each keeps calling a handler
 * closed over a dead render. And the rejection is unhandled, which main.tsx's
 * unhandledrejection hook turns into a "Something went wrong" toast.
 *
 * So: retry rather than swallow. The entry appears as soon as the queued
 * script runs, so the next turn of the event loop is almost always enough. */

import type { UnlistenFn } from "@tauri-apps/api/event";

/** Roughly a quarter second in total, front-loaded — long enough for a webview
 * that is busy mounting a lazy route, short enough that a genuinely broken
 * unlisten is reported while the cause is still on screen. */
const RETRY_DELAYS_MS = [0, 16, 32, 64, 128];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cleanup for a `listen()` promise. Resolves in every case — a subscription
 * that never came up has nothing to tear down, and one that refuses to come
 * down is logged rather than thrown, because this runs from effect cleanup
 * where there is no one left to catch it. */
export async function unsubscribe(pending: Promise<UnlistenFn>): Promise<void> {
  let unlisten: UnlistenFn;
  try {
    unlisten = await pending;
  } catch {
    // Never subscribed; the call site already surfaced that failure.
    return;
  }

  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await sleep(delay);
    try {
      await unlisten();
      return;
    } catch (e) {
      lastError = e;
    }
  }
  console.error("event unlisten failed, listener leaked:", lastError);
}
