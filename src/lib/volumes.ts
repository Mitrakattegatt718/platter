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
