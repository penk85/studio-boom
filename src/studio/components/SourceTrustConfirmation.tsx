// Shared consent gate for HTML that will execute inside Studio's same-origin Stage.
import { ShieldAlert } from "lucide-react";
import { useId } from "react";

interface SourceTrustConfirmationProps {
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
}

export const SOURCE_TRUST_REQUIRED_MESSAGE =
  "Confirm that you created this executable source or trust who provided it.";

export function SourceTrustConfirmation({
  confirmed,
  onConfirmedChange,
}: SourceTrustConfirmationProps) {
  const inputId = useId();

  return (
    <div className="rounded-md border border-destructive/45 bg-destructive/10 p-3 text-xs">
      <div className="flex items-start gap-2">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-destructive" />
        <div className="space-y-2">
          <div className="font-medium text-foreground">Executable source</div>
          <p className="leading-relaxed text-muted-foreground">
            HyperFrames HTML can run JavaScript. After import, it executes in the editable Stage and
            can access Studio Boom&apos;s local projects and local API. Continue only with source
            you created or trust.
          </p>
          <label
            htmlFor={inputId}
            className="flex cursor-pointer items-start gap-2 text-foreground"
          >
            <input
              id={inputId}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirmedChange(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
            />
            <span>I created this source or trust who provided it.</span>
          </label>
        </div>
      </div>
    </div>
  );
}
