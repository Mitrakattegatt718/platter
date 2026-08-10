import { HardDrive, ShieldAlert, X } from "lucide-react";
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
import { api } from "@/lib/api";

/**
 * First-launch primer for macOS removable-volume consent (TCC). Access can't
 * be requested programmatically — the binary simply gets EPERM ("Operation
 * not permitted") when it touches /Volumes/<iPod> — so ahead of the first
 * connect we explain what's coming and offer a direct link to the settings
 * pane. Skipping leaves the low-key banner up; a real access failure still
 * routes through the error dialog's recovery path.
 */

export function PermissionPrimer({
  onDecision,
}: {
  /** accepted = user went to grant access now, declined = banner nags later. */
  onDecision: (accepted: boolean) => void;
}) {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <HardDrive className="size-5 text-muted-foreground" />
            <AlertDialogTitle>Allow access to your iPod</AlertDialogTitle>
          </div>
          <AlertDialogDescription
            render={
              <div className="flex flex-col gap-2">
                <span>
                  macOS blocks apps from removable drives by default. PodSync
                  needs read and write access to the iPod&apos;s disk to open its
                  library database, sync play counts, and store artwork.
                </span>
                <span>
                  In System Settings, enable PodSync under{" "}
                  <span className="font-medium text-foreground">
                    Privacy &amp; Security → Files &amp; Folders → Removable
                    Volumes
                  </span>{" "}
                  (or grant Full Disk Access), then quit and relaunch PodSync
                  once.
                </span>
              </div>
            }
          />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onDecision(false)}>
            Not now
          </Button>
          <AlertDialogAction
            onClick={() => {
              void api.openPrivacySettings().catch(() => {});
              onDecision(true);
            }}
          >
            Open System Settings
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The quiet reminder shown when the primer was declined. Dismissal is
 * remembered — repeated nagging after an explicit no trains users to ignore
 * the dialog that actually matters (the EPERM one). */
export function PermissionBanner({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs"
    >
      <ShieldAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 truncate">
        macOS is blocking iPod access — PodSync can&apos;t read the device until
        removable-volume permission is granted.
      </span>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void api.openPrivacySettings().catch(() => {})}
      >
        Open Settings
      </Button>
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
