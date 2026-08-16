import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

/** The build number, in the header beside Settings.
 *
 * Bug reports arrive without one, and the log file names a path rather than a
 * build. On screen at all times rather than a line inside the dialog: the
 * number is only ever read out, and a reader who has to open a dialog to find
 * it is a reader who reports the bug without it. */
export function AppVersion() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    // Straight off the bundle rather than a constant in the frontend, so
    // tauri.conf.json stays the one place the number is written. Same reason
    // it is fetched rather than baked in at build: a UI that can disagree with
    // the binary it ships in is worse than no version at all.
    getVersion().then(setVersion, () => setVersion(null));
  }, []);

  // Absent, not "unknown", when it fails to resolve: a version nobody can act
  // on is worth less than the space it takes, and this space is beside a
  // control the header needs to keep in the same place.
  if (!version) return null;

  return (
    // The app's own name only in the tooltip — the window it labels is the
    // app, so the header would be saying it to nobody. "Alpha" is a word
    // beside the number rather than a `-alpha` suffix on it: that string
    // becomes CFBundleShortVersionString, which macOS expects to be numeric
    // and prints verbatim in Get Info.
    <span
      className="select-text px-1 text-xs whitespace-nowrap text-muted-foreground"
      title={`Platter ${version} · Alpha`}
    >
      {version} · Alpha
    </span>
  );
}
