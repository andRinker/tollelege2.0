"use client";

import { useState } from "react";
import { checkInAction, markLostAction, undoCheckInAction } from "@/app/(app)/checkout/actions";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconInput, iconMoreVert, iconReport } from "@/ui/icons/generated";

export function useReturnWithUndo() {
  const showSnackbar = useSnackbar();
  return async (loanId: string) => {
    const result = await checkInAction(loanId);
    if (!result.ok) {
      showSnackbar({ message: result.message });
      return false;
    }
    showSnackbar({
      message: `Returned ${result.data.title} from ${result.data.studentName}`,
      action: {
        label: "Undo",
        onAction: async () => {
          const undo = await undoCheckInAction(loanId);
          if (!undo.ok) showSnackbar({ message: undo.message });
        },
      },
    });
    return true;
  };
}

/** Return and Mark lost controls for one open loan. */
export function LoanActions({ loanId, title, studentName }: { loanId: string; title: string; studentName: string }) {
  const showSnackbar = useSnackbar();
  const returnBook = useReturnWithUndo();
  const [pending, setPending] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);

  return (
    <>
      <Button
        variant="tonal"
        size="xs"
        icon={iconInput}
        isPending={pending}
        onPress={async () => {
          setPending(true);
          await returnBook(loanId);
          setPending(false);
        }}
      >
        {/* Icon-only on phones so the title keeps its room. */}
        <span className="max-medium:sr-only">Return</span>
      </Button>
      <MenuTrigger>
        <IconButton icon={iconMoreVert} label={`More actions for ${title}`} tooltip={false} />
        <Menu onAction={(key) => key === "lost" && setConfirmLost(true)}>
          <MenuItem id="lost" icon={iconReport}>
            Mark lost
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <ConfirmDialog
        isOpen={confirmLost}
        onOpenChange={setConfirmLost}
        title="Mark this book lost?"
        message={`${title} will be checked in from ${studentName} and its copy marked lost. You can return the copy to circulation from the book's page if it turns up.`}
        confirmLabel="Mark lost"
        onConfirm={async () => {
          const result = await markLostAction(loanId);
          showSnackbar({ message: result.ok ? `${title} marked lost` : result.message });
        }}
      />
    </>
  );
}
