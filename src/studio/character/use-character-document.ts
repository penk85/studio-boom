// Character Editor document state, undo/redo snapshots, and debounced persistence.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useStudio } from "../store";
import type { CharacterPreset } from "../types";
import { saveCharacter } from "./character-utils";

const HISTORY_LIMIT = 60;

interface CharacterDocumentOptions {
  onRestore: (character: CharacterPreset) => void;
  onStatus: (message: string) => void;
}

export interface CharacterDocumentController {
  doc: CharacterPreset | null;
  setDoc: Dispatch<SetStateAction<CharacterPreset | null>>;
  saveState: "saved" | "saving";
  canUndo: boolean;
  canRedo: boolean;
  pushUndoSnapshot: () => void;
  resetHistory: () => void;
  undoCharacterHistory: () => void;
  redoCharacterHistory: () => void;
  saveNow: () => Promise<CharacterPreset | null>;
}

export function useCharacterDocument({
  onRestore,
  onStatus,
}: CharacterDocumentOptions): CharacterDocumentController {
  const [doc, setDocState] = useState<CharacterPreset | null>(null);
  const [historyPast, setHistoryPast] = useState<CharacterPreset[]>([]);
  const [historyFuture, setHistoryFuture] = useState<CharacterPreset[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const docRef = useRef<CharacterPreset | null>(null);
  const historyPastRef = useRef<CharacterPreset[]>([]);
  const historyFutureRef = useRef<CharacterPreset[]>([]);
  const onRestoreRef = useRef(onRestore);
  const onStatusRef = useRef(onStatus);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});

  useEffect(() => {
    onRestoreRef.current = onRestore;
    onStatusRef.current = onStatus;
  }, [onRestore, onStatus]);

  const setDoc = useCallback<Dispatch<SetStateAction<CharacterPreset | null>>>((value) => {
    setDocState((current) => {
      const next =
        typeof value === "function"
          ? (value as (character: CharacterPreset | null) => CharacterPreset | null)(current)
          : value;
      docRef.current = next;
      return next;
    });
  }, []);

  const resetHistory = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setHistoryPast([]);
    setHistoryFuture([]);
  }, []);

  const pushUndoSnapshot = useCallback(() => {
    const snapshot = docRef.current;
    if (!snapshot) return;
    const nextPast = [...historyPastRef.current, snapshot].slice(-HISTORY_LIMIT);
    historyPastRef.current = nextPast;
    historyFutureRef.current = [];
    setHistoryPast(nextPast);
    setHistoryFuture([]);
  }, []);

  const restoreSnapshot = useCallback(
    (snapshot: CharacterPreset) => {
      setDoc(snapshot);
      onRestoreRef.current(snapshot);
    },
    [setDoc],
  );

  const undoCharacterHistory = useCallback(() => {
    const current = docRef.current;
    const past = historyPastRef.current;
    if (!current || past.length === 0) return;
    const previous = past[past.length - 1];
    const nextPast = past.slice(0, -1);
    const nextFuture = [current, ...historyFutureRef.current].slice(0, HISTORY_LIMIT);
    historyPastRef.current = nextPast;
    historyFutureRef.current = nextFuture;
    setHistoryPast(nextPast);
    setHistoryFuture(nextFuture);
    restoreSnapshot(previous);
    onStatusRef.current("Undone");
  }, [restoreSnapshot]);

  const redoCharacterHistory = useCallback(() => {
    const current = docRef.current;
    const future = historyFutureRef.current;
    if (!current || future.length === 0) return;
    const next = future[0];
    const nextPast = [...historyPastRef.current, current].slice(-HISTORY_LIMIT);
    const nextFuture = future.slice(1);
    historyPastRef.current = nextPast;
    historyFutureRef.current = nextFuture;
    setHistoryPast(nextPast);
    setHistoryFuture(nextFuture);
    restoreSnapshot(next);
    onStatusRef.current("Redone");
  }, [restoreSnapshot]);

  undoRef.current = undoCharacterHistory;
  redoRef.current = redoCharacterHistory;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redoRef.current();
      } else if (key === "z") {
        event.preventDefault();
        undoRef.current();
      } else if (key === "y") {
        event.preventDefault();
        redoRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!doc) return;
    setSaveState("saving");
    let active = true;
    const timeout = window.setTimeout(() => {
      void saveCharacter(doc).then((saved) => {
        useStudio.getState().registerCharacterPreset(saved);
        if (active) setSaveState("saved");
      });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [doc]);

  const saveNow = useCallback(async () => {
    const current = docRef.current;
    if (!current) return null;
    setSaveState("saving");
    const saved = await saveCharacter(current);
    useStudio.getState().registerCharacterPreset(saved);
    setDoc(saved);
    setSaveState("saved");
    return saved;
  }, [setDoc]);

  return {
    doc,
    setDoc,
    saveState,
    canUndo: historyPast.length > 0,
    canRedo: historyFuture.length > 0,
    pushUndoSnapshot,
    resetHistory,
    undoCharacterHistory,
    redoCharacterHistory,
    saveNow,
  };
}
