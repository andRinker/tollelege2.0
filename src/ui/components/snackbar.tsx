"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { iconClose } from "@/ui/icons/generated";
import { springs } from "@/ui/motion/tokens";
import { Icon } from "./icon";

export type SnackbarOptions = {
  message: string;
  action?: { label: string; onAction: () => void };
  /** Milliseconds. Defaults to 4s, or 8s when there's an action. */
  duration?: number;
};

type QueuedSnackbar = SnackbarOptions & { id: number };

const SnackbarContext = createContext<(options: SnackbarOptions) => void>(() => {});

export function useSnackbar() {
  return useContext(SnackbarContext);
}

let nextId = 1;

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedSnackbar[]>([]);
  const current = queue[0];

  const show = useCallback((options: SnackbarOptions) => {
    setQueue((items) => [...items, { ...options, id: nextId++ }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setQueue((items) => items.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => dismiss(current.id), current.duration ?? (current.action ? 8000 : 4000));
    return () => clearTimeout(timer);
  }, [current, dismiss]);

  return (
    <SnackbarContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--snackbar-offset,0px)+16px+env(safe-area-inset-bottom))] z-50 flex justify-center px-4"
      >
        <AnimatePresence mode="wait">
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, transition: springs.fastEffects }}
              transition={springs.defaultSpatial}
              className="pointer-events-auto flex min-h-12 w-full max-w-[560px] items-center gap-1 rounded-xs bg-inverse-surface py-1 pr-1 pl-4 text-body-md text-inverse-on-surface shadow-3"
            >
              <p className="grow py-2.5">{current.message}</p>
              {current.action && (
                <button
                  type="button"
                  className="state-layer focus-ring h-10 shrink-0 cursor-pointer rounded-full px-3 text-label-lg text-inverse-primary"
                  onClick={() => {
                    current.action?.onAction();
                    dismiss(current.id);
                  }}
                >
                  {current.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="Dismiss"
                className="state-layer focus-ring grid size-10 shrink-0 cursor-pointer place-items-center rounded-full"
                onClick={() => dismiss(current.id)}
              >
                <Icon icon={iconClose} size={20} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SnackbarContext>
  );
}
