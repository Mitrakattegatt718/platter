import type { ReactNode } from "react";

/** The centred "there is nothing here" panel, shared by every pane that has
 * one.
 *
 * Library and Convert had grown their own: one with a full-contrast heading
 * over a 288px measure, the other with a muted `text-sm` heading over 384px and
 * a hand-added `mt-3` under the button. Two panels that say the same kind of
 * thing in the same place read as two different apps when their type and rhythm
 * disagree.
 *
 * The heading is deliberately not muted. It is the one line that says what
 * happened, and greying it leaves a pane whose every element is a shade of
 * "unimportant". Muted is for the sentence underneath, which explains.
 *
 * `max-w-72` on that sentence, not `max-w-sm`: at 12px, 384px runs past a
 * comfortable measure and the paragraph starts reading as a wall.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  children,
}: {
  /** Rendered muted at whatever size it carries; callers use `size-10`. */
  icon?: ReactNode;
  title: string;
  body: ReactNode;
  /** The one thing worth doing here, if there is one. */
  action?: ReactNode;
  /** Anything that belongs under the action — progress, a second line. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-72 text-xs text-muted-foreground">{body}</p>
      </div>
      {action}
      {children}
    </div>
  );
}
