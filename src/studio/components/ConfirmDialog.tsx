// Themed replacements for window.confirm / window.alert.
//
// The native dialogs ignore the app's theme, cannot render structure, and put
// destructive choices behind an OS-styled button the user has been trained to
// dismiss. Studio Boom's delete flows have real explanatory copy (which clips a
// character is used by, what deleting a scene takes with it) that deserves to be
// readable. This exposes the same imperative shape the old calls had, so call
// sites keep reading top-to-bottom:
//
//   if (!(await confirm({ title: "…", confirmLabel: "Delete", destructive: true }))) return;
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmRequest {
  title: string;
  /** Supporting copy. An array renders as separate paragraphs. */
  body?: ReactNode | string[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface NoticeRequest {
  title: string;
  body?: ReactNode | string[];
  dismissLabel?: string;
}

type PendingDialog =
  | ({ kind: "confirm"; resolve: (ok: boolean) => void } & ConfirmRequest)
  | ({ kind: "notice"; resolve: (ok: boolean) => void } & NoticeRequest);

interface ConfirmContextValue {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  notify: (request: NoticeRequest) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

function renderBody(body: ConfirmRequest["body"]): ReactNode {
  if (body == null) return null;
  if (Array.isArray(body)) {
    return (
      <div className="space-y-2">
        {body.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    );
  }
  return body;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingDialog | null>(null);
  // Guards against the Radix close animation resolving a request twice.
  const settledRef = useRef(false);

  const settle = useCallback((result: boolean) => {
    setPending((current) => {
      if (current && !settledRef.current) {
        settledRef.current = true;
        current.resolve(result);
      }
      return null;
    });
  }, []);

  const value = useMemo<ConfirmContextValue>(
    () => ({
      confirm: (request) =>
        new Promise<boolean>((resolve) => {
          settledRef.current = false;
          setPending({ kind: "confirm", resolve, ...request });
        }),
      notify: (request) =>
        new Promise<boolean>((resolve) => {
          settledRef.current = false;
          setPending({ kind: "notice", resolve, ...request });
        }),
    }),
    [],
  );

  const isConfirm = pending?.kind === "confirm";
  const destructive = isConfirm && pending.destructive === true;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        <DialogContent className="max-w-md gap-4 rounded-lg border-border bg-panel text-foreground">
          <DialogHeader>
            <DialogTitle>{pending?.title ?? ""}</DialogTitle>
            {pending?.body != null && (
              <DialogDescription asChild>
                <div className="text-sm leading-relaxed text-muted-foreground">
                  {renderBody(pending.body)}
                </div>
              </DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter className="gap-2">
            {isConfirm && (
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded border border-border px-3 py-1.5 text-sm text-foreground hover:bg-panel-2"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => settle(true)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                destructive
                  ? "bg-destructive text-destructive-foreground hover:opacity-90"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {pending == null
                ? "OK"
                : pending.kind === "confirm"
                  ? (pending.confirmLabel ?? "Confirm")
                  : (pending.dismissLabel ?? "OK")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

function useConfirmContext(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm/useNotify require <ConfirmDialogProvider>.");
  }
  return context;
}

/** Promise-based replacement for `window.confirm`. Resolves false on dismiss. */
export function useConfirm(): ConfirmContextValue["confirm"] {
  return useConfirmContext().confirm;
}

/** Promise-based replacement for `window.alert`. */
export function useNotify(): ConfirmContextValue["notify"] {
  return useConfirmContext().notify;
}
