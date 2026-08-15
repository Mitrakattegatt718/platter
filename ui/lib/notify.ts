import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** System notification, sent only while the window is in the background —
 * a terabyte import runs for hours and its owner has long since switched
 * apps; in the foreground the toasts already cover it. Best-effort: denied
 * permission or a plugin failure must never break the operation being
 * reported on. */
export async function notifyIfBackground(title: string, body?: string) {
  if (!document.hidden) return;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  } catch (e) {
    console.error("notification failed:", e);
  }
}
