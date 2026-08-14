import { formatBytes } from "./format";
import type { VolumeInfo } from "./types";

/** "/Volumes/PODSIM" → "PODSIM". The toolbar names the volume the way Finder
 * does; the full path stays in each menu row's tooltip, where it is available
 * without spending toolbar width on it. */
export function volumeLabel(mountPoint: string): string {
  const trimmed = mountPoint.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const name = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  return name === "" ? mountPoint : name;
}

/** The drive menu's two sections. */
export interface VolumeSections {
  ipods: VolumeInfo[];
  others: VolumeInfo[];
}

/** Split for display. Order within each section is whatever list_volumes
 * returned — /Volumes order, which is stable between opens. */
export function partitionVolumes(volumes: VolumeInfo[]): VolumeSections {
  const ipods: VolumeInfo[] = [];
  const others: VolumeInfo[] = [];
  for (const v of volumes) {
    (v.isIpod ? ipods : others).push(v);
  }
  return { ipods, others };
}

/** libgpod hands back the literal string "Unknown" for a device it could not
 * place, in the same field it uses for real answers. Printed as-is it reads as
 * something the device reported about itself. */
function known(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "unknown") return null;
  return trimmed;
}

/** The second line of a drive row: what the device is, or — for an ordinary
 * volume, which has no such story — where it is mounted.
 *
 * The "iPod" prefix is added here because libgpod's model name drops it:
 * itdb_info_get_ipod_model_name_string yields "Classic (Black)". */
export function volumeSubtitle(volume: VolumeInfo): string {
  if (!volume.isIpod) return volume.path;

  const model = known(volume.model);
  const generation = known(volume.generation);
  const family = known(volume.family);

  // A model name and a family slug are the same fact at different
  // resolutions, so only the better one is shown.
  const name =
    model ?? (family === null ? null : family.charAt(0).toUpperCase() + family.slice(1));

  if (name === null) {
    // A Classic with a wiped SysInfo has to stay connectable, so this is a
    // state to name rather than an error to hide.
    return "iPod · unidentified";
  }
  return generation === null ? `iPod ${name}` : `iPod ${name} · ${generation}`;
}

/** Free against total, for the right-hand column of a drive row. Empty — not
 * "0 B" — when statfs failed: no free space and "couldn't ask" must never look
 * the same, since one blocks an import and the other means we don't know. */
export function volumeCapacity(volume: VolumeInfo): string {
  const { freeBytes, totalBytes } = volume;
  if (freeBytes !== null && totalBytes !== null) {
    return `${formatBytes(freeBytes)} free of ${formatBytes(totalBytes)}`;
  }
  if (totalBytes !== null) return formatBytes(totalBytes);
  if (freeBytes !== null) return `${formatBytes(freeBytes)} free`;
  return "";
}
