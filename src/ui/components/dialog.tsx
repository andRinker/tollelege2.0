"use client";

import { type ReactNode, useState } from "react";
import {
  Dialog as AriaDialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  type ModalOverlayProps,
} from "react-aria-components";
import { cx } from "@/ui/cx";
import { iconClose } from "@/ui/icons/generated";
import { Button } from "./button";
import { IconButton } from "./icon-button";

export { DialogTrigger };

const OVERLAY =
  "fixed inset-0 z-50 flex items-center justify-center bg-scrim/32 p-6 data-[entering]:animate-[fade-in_200ms_var(--ease-default-effects)] data-[exiting]:animate-[fade-in_150ms_var(--ease-fast-effects)_reverse]";

type DialogProps = Omit<ModalOverlayProps, "className" | "children"> & {
  title: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Buttons at the bottom right. */
  actions?: (close: () => void) => ReactNode;
  /** Fills the screen on phones, with the actions in a top bar. */
  fullScreenOnCompact?: boolean;
  className?: string;
};

export function Dialog({ title, children, actions, fullScreenOnCompact = false, className, ...props }: DialogProps) {
  return (
    <ModalOverlay {...props} className={cx(OVERLAY, fullScreenOnCompact && "max-medium:p-0")}>
      <Modal
        className={cx(
          "flex max-h-full w-full max-w-[560px] min-w-[280px] flex-col rounded-xl bg-surface-container-high text-on-surface shadow-3 [--field-bg:var(--md-sys-color-surface-container-high)]",
          "data-[entering]:animate-[dialog-in_350ms_var(--ease-default-spatial)] data-[exiting]:animate-[fade-in_150ms_var(--ease-fast-effects)_reverse]",
          fullScreenOnCompact && "max-medium:h-full max-medium:max-w-none max-medium:rounded-none max-medium:bg-surface",
          className,
        )}
      >
        <AriaDialog className="flex max-h-full min-h-0 grow flex-col outline-none">
          {({ close }) => (
            <>
              {fullScreenOnCompact && (
                <div className="flex h-16 shrink-0 items-center gap-1 px-1 medium:hidden">
                  <IconButton icon={iconClose} label="Close" onPress={close} tooltip={false} />
                  <Heading slot="title" className="grow truncate text-title-lg">
                    {title}
                  </Heading>
                  <div className="flex gap-2 pr-3">{actions?.(close)}</div>
                </div>
              )}
              <Heading
                slot={fullScreenOnCompact ? undefined : "title"}
                className={cx("px-6 pt-6 pb-4 text-headline-sm", fullScreenOnCompact && "max-medium:hidden")}
              >
                {title}
              </Heading>
              <div className="min-h-0 grow overflow-y-auto px-6 text-body-md text-on-surface-variant max-medium:pb-6">
                {typeof children === "function" ? children(close) : children}
              </div>
              {actions && (
                <div className={cx("flex flex-wrap justify-end gap-2 px-6 pt-4 pb-6", fullScreenOnCompact && "max-medium:hidden")}>
                  {actions(close)}
                </div>
              )}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

type ConfirmDialogProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
};

export function ConfirmDialog({ isOpen, onOpenChange, title, message, confirmLabel, destructive, onConfirm }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable={!pending}
      title={title}
      actions={(close) => (
        <>
          <Button variant="text" onPress={close} isDisabled={pending}>
            Cancel
          </Button>
          <Button
            variant="text"
            className={destructive ? "text-error" : undefined}
            isPending={pending}
            onPress={async () => {
              setPending(true);
              try {
                await onConfirm();
                close();
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      <p>{message}</p>
    </Dialog>
  );
}
