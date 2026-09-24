"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/dialog";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuDivider, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import { iconDelete, iconEdit, iconMoreVert, iconPerson, iconPersonRemove } from "@/ui/icons/generated";
import { deleteStudentAction, setStudentActiveAction } from "./actions";
import { type ClassOption, StudentDialog } from "./class-dialogs";

type Student = {
  id: string;
  firstName: string;
  lastName: string;
  studentNumber: string | null;
  active: boolean;
  classId: string | null;
  booksOut: number;
};

type Props = {
  student: Student;
  classes: ClassOption[];
  /** "menu" for roster rows; "page" adds an Edit button for the student page. */
  variant: "menu" | "page";
  /** Where to go after deleting from the student page. */
  afterDeleteHref?: string;
  /** False for a co-teacher: deleting a student erases their history, so it stays with the owner. */
  canDelete?: boolean;
};

export function StudentActions({ student, classes, variant, afterDeleteHref, canDelete = true }: Props) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const fullName = `${student.firstName} ${student.lastName}`.trim();

  return (
    <>
      {variant === "page" && (
        <Button size="md" compact variant="tonal" icon={iconEdit} onPress={() => setDialog("edit")}>
          Edit
        </Button>
      )}
      <MenuTrigger>
        <IconButton icon={iconMoreVert} label={`Actions for ${fullName}`} size={variant === "page" ? "md" : "sm"} compact={variant === "page"} tooltip={variant === "page"} />
        <Menu
          disabledKeys={student.booksOut > 0 ? ["delete"] : []}
          onAction={async (key) => {
            if (key === "edit") setDialog("edit");
            if (key === "delete") setDialog("delete");
            if (key === "active") {
              const result = await setStudentActiveAction(student.id, !student.active);
              showSnackbar({
                message: result.ok ? `${fullName} ${student.active ? "is now inactive" : "is active again"}` : result.message,
              });
            }
          }}
        >
          {variant === "menu" && (
            <MenuItem id="edit" icon={iconEdit}>
              Edit or move
            </MenuItem>
          )}
          <MenuItem id="active" icon={student.active ? iconPersonRemove : iconPerson}>
            {student.active ? "Mark inactive" : "Mark active"}
          </MenuItem>
          {canDelete && <MenuDivider />}
          {canDelete && (
            <MenuItem id="delete" icon={iconDelete} destructive>
              {student.booksOut > 0 ? "Delete (check in books first)" : "Delete student"}
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>

      <StudentDialog
        isOpen={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        classes={classes}
        classId={student.classId}
        existing={student}
      />
      <ConfirmDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title={`Delete ${fullName}?`}
        message="Their checkout history will be deleted too. To keep it, mark the student inactive instead."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await deleteStudentAction(student.id);
          if (!result.ok) {
            showSnackbar({ message: result.message });
            return;
          }
          showSnackbar({ message: `Deleted ${fullName}` });
          if (afterDeleteHref) router.replace(afterDeleteHref);
        }}
      />
    </>
  );
}
