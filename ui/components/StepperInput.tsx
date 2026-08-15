import { useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Number input with in-field stepper buttons (▲▼ stacked at the trailing
 * edge), like an NSStepper-bearing NSTextField. ArrowUp/ArrowDown keep working
 * thanks to type="number"; the native web spinners are hidden so only the
 * custom pair shows. */
export function StepperInput({
  value,
  onChange,
  min = 0,
  max = 999,
  placeholder,
  allowBlank = false,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  /** When true an empty field stays empty instead of collapsing to min. */
  allowBlank?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blank = allowBlank && (value === 0 || Number.isNaN(value));

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const step = (delta: number) => {
    onChange(clamp((blank ? 0 : value) + delta));
    inputRef.current?.focus();
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={blank ? "" : value}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(allowBlank ? 0 : min);
            return;
          }
          const n = Number(raw);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        className={cn(
          "pr-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      <div className="absolute inset-y-1 right-1 flex w-5 flex-col rounded-sm">
        <StepperButton label="Increase" onStep={() => step(1)}>
          <ChevronUp className="size-3" />
        </StepperButton>
        <div className="mx-0.5 h-px bg-border" />
        <StepperButton label="Decrease" onStep={() => step(-1)}>
          <ChevronDown className="size-3" />
        </StepperButton>
      </div>
    </div>
  );
}

function StepperButton({
  label,
  onStep,
  children,
}: {
  label: string;
  onStep: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Mousedown must not blur the input mid-gesture; we refocus it after.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onStep}
      // Out of the tab order — the steppers are redundant with the keyboard
      // arrows native to number inputs, and tab should move between fields.
      tabIndex={-1}
      aria-label={label}
      title={label}
      className="flex flex-1 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
