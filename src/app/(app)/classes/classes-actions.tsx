"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonSize } from "@/ui/components/button";
import { ConfirmDialog } from "@/ui/components/dialog";
import { Fab } from "@/ui/components/fab";
import { IconButton } from "@/ui/components/icon-button";
import { Menu, MenuDivider, MenuItem, MenuTrigger } from "@/ui/components/menu";
import { useSnackbar } from "@/ui/components/snackbar";
import {
  iconArchive,
  iconDelete,
  iconEdit,
  iconGroupAdd,
  iconMoreVert,
  iconPersonAdd,
  iconUnarchive,
  iconUploadFile,
} from "@/ui/icons/generated";
import { archiveClassAction, deleteClassAction } from "./actions";
import { ClassDialog, type ClassOption, StudentDialog } from "./class-dialogs";
import { ImportStudentsDialog } from "./import-students-dialog";

export function NewClassButton({ defaultSchoolYear, size = "md" }: { defaultSchoolYear: string; size?: ButtonSize }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} icon={iconGroupAdd} onPress={() => setOpen(true)} className="max-medium:hidden">
        New class
      </Button>
      <div className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-20 medium:hidden">
        <Fab icon={iconGroupAdd} label="New class" onPress={() => setOpen(true)} />
      </div>
      <ClassDialog isOpen={open} onOpenChange={setOpen} defaultSchoolYear={defaultSchoolYear} />
    </>
  );
}

type RosterActionsProps = {
  klass: { id: string; name: string; schoolYear: string; archived: boolean };
  studentCount: number;
  defaultSchoolYear: string;
  classes: ClassOption[];
};

export function RosterActions({ klass, studentCount, defaultSchoolYear, classes }: RosterActionsProps) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [dialog, setDialog] = useState<"add" | "import" | "edit" | "delete" | null>(null);

  return (
    <>
      <Button size="md" compact icon={iconPersonAdd} onPress={() => setDialog("add")}>
        Add student
      </Button>
      <Button size="md" compact variant="tonal" icon={iconUploadFile} onPress={() => setDialog("import")}>
        Import
      </Button>
      <MenuTrigger>
        <IconButton icon={iconMoreVert} label="More class actions" size="md" compact />
        <Menu
          disabledKeys={studentCount > 0 ? ["delete"] : []}
          onAction={async (key) => {
            if (key === "edit") setDialog("edit");
            if (key === "delete") setDialog("delete");
            if (key === "archive") {
              const result = await archiveClassAction(klass.id, !klass.archived);
              showSnackbar({ message: result.ok ? (klass.archived ? "Class restored" : "Class archived") : result.message });
            }
          }}
        >
          <MenuItem id="edit" icon={iconEdit}>
            Edit name or year
          </MenuItem>
          <MenuItem id="archive" icon={klass.archived ? iconUnarchive : iconArchive}>
            {klass.archived ? "Restore class" : "Archive class"}
          </MenuItem>
          <MenuDivider />
          <MenuItem id="delete" icon={iconDelete} destructive>
            {studentCount > 0 ? "Delete (remove students first)" : "Delete class"}
          </MenuItem>
        </Menu>
      </MenuTrigger>

      <StudentDialog isOpen={dialog === "add"} onOpenChange={(open) => setDialog(open ? "add" : null)} classes={classes} classId={klass.id} />
      <ImportStudentsDialog classId={klass.id} className={klass.name} isOpen={dialog === "import"} onOpenChange={(open) => setDialog(open ? "import" : null)} />
      <ClassDialog
        isOpen={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        existing={klass}
        defaultSchoolYear={defaultSchoolYear}
      />
      <ConfirmDialog
        isOpen={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title="Delete this class?"
        message={`${klass.name} will be removed. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const result = await deleteClassAction(klass.id);
          if (!result.ok) {
            showSnackbar({ message: result.message });
            return;
          }
          showSnackbar({ message: `Deleted ${klass.name}` });
          router.replace("/classes");
        }}
      />
    </>
  );
}
