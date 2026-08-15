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

/** libgpod's generation string leads with the same family word its model name
 * already carries — model "Classic (Silver)" comes with generation "Classic",
 * and printing both spells one fact as two. Leading words the model already
 * contains are dropped; whatever is left is the part that says something new,
 * so "Shuffle (2nd Gen.)" against "Shuffle (Silver)" keeps "2nd Gen." — the
 * only thing separating a supported 2nd-gen Shuffle from a 4th. */
function generationBeyond(generation: string, model: string): string | null {
  const haystack = model.toLowerCase();
  const words = generation.split(/\s+/);
  let i = 0;
  while (i < words.length && haystack.includes(words[i].toLowerCase())) i++;
  let rest = words.slice(i).join(" ").trim();
  // Removing the leading word can leave the remainder wrapped in the brackets
  // that used to trail it.
  const wrapped = /^\((.*)\)$/.exec(rest);
  if (wrapped) rest = wrapped[1].trim();
  return rest === "" ? null : rest;
}

/** The second line of a drive row: what the device is.
 *
 * The "iPod" prefix is added here because libgpod's model name drops it:
 * itdb_info_get_ipod_model_name_string yields "Classic (Black)".
 *
 * An ordinary volume has no such story, so it gets its mount path — but only
 * when that path says more than the row's own title already does. Under
 * /Volumes it does not, and a second line repeating the first with a prefix
 * costs menu height for nothing. */
export function volumeSubtitle(volume: VolumeInfo): string {
  if (!volume.isIpod) {
    return volume.path === `/Volumes/${volumeLabel(volume.path)}` ? "" : volume.path;
  }

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
  const extra = generation === null ? null : generationBeyond(generation, name);
  return extra === null ? `iPod ${name}` : `iPod ${name} · ${extra}`;
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

/** Whether two scans describe the same set of volumes in the same state.
 *
 * The disconnected view rescans every 2.5 seconds for as long as it is open.
 * Without this the answer is a new array each time, so React re-renders and
 * re-sorts the whole list to paint pixels identical to the ones already there.
 * Capacity is part of the comparison on purpose — free space is displayed per
 * row, so a drive filling up in the background should still refresh. */
export function sameVolumes(
  a: VolumeInfo[] | null,
  b: VolumeInfo[] | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null || a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.path === y.path &&
      x.isIpod === y.isIpod &&
      x.freeBytes === y.freeBytes &&
      x.totalBytes === y.totalBytes &&
      x.family === y.family &&
      x.model === y.model &&
      x.generation === y.generation &&
      x.unsupported === y.unsupported
    );
  });
}
