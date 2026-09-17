"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Form } from "react-aria-components";
import { Button } from "@/ui/components/button";
import { Dialog } from "@/ui/components/dialog";
import { ListBoxItem } from "@/ui/components/menu";
import { Select } from "@/ui/components/select";
import { useSnackbar } from "@/ui/components/snackbar";
import { TextField } from "@/ui/components/text-field";
import { createClassAction, updateClassAction, addStudentAction, updateStudentAction } from "./actions";

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-error-container px-4 py-3 text-body-md text-on-error-container">
      {message}
    </p>
  );
}

type ClassDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when renaming an existing class. */
  existing?: { id: string; name: string; schoolYear: string };
  defaultSchoolYear: string;
};

export function ClassDialog({ isOpen, onOpenChange, existing, defaultSchoolYear }: ClassDialogProps) {
  const router = useRouter();
  const showSnackbar = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const formId = existing ? "rename-class-form" : "new-class-form";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setError(null);
      }}
      title={existing ? "Edit class" : "New class"}
      actions={(close) => (
        <>
          <Button variant="text" onPress={close}>
            Cancel
          </Button>
          <Button type="submit" form={formId} isPending={pending}>
            {existing ? "Save" : "Create"}
          </Button>
        </>
      )}
    >
      <Form
        id={formId}
        className="flex flex-col gap-4 pt-1"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const input = { name: String(data.get("name")), schoolYear: String(data.get("schoolYear")) };
          setPending(true);
          const result = existing ? await updateClassAction(existing.id, input) : await createClassAction(input);
          setPending(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onOpenChange(false);
          if (existing) {
            showSnackbar({ message: "Class updated" });
          } else if (result.data && "classId" in result.data) {
            router.push(`/classes/${result.data.classId}`);
          }
        }}
      >
        <FormError message={error} />
        <TextField
          label="Class name"
          name="name"
          isRequired
          autoFocus
          maxLength={60}
          defaultValue={existing?.name}
          description="For example, “Room 12” or “Period 3 English”"
        />
        <TextField label="School year" name="schoolYear" isRequired maxLength={20} defaultValue={existing?.schoolYear ?? defaultSchoolYear} />
      </Form>
    </Dialog>
  );
}

export type ClassOption = { id: string; name: string };

type StudentDialogProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  classes: ClassOption[];
  /** Adding: the class to add to. Editing: the student's current values. */
  classId: string | null;
  existing?: { id: string; firstName: string; lastName: string; studentNumber: string | null };
  onSaved?: (studentId: string | null) => void;
  children?: ReactNode;
};

export function StudentDialog({ isOpen, onOpenChange, classes, classId, existing, onSaved }: StudentDialogProps) {
  const showSnackbar = useSnackbar();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string>(classId ?? "none");
  const formId = existing ? "edit-student-form" : "add-student-form";

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setError(null);
      }}
      title={existing ? "Edit student" : "Add a student"}
      actions={(close) => (
        <>
          <Button variant="text" onPress={close}>
            {existing ? "Cancel" : "Done"}
          </Button>
          <Button type="submit" form={formId} isPending={pending}>
            {existing ? "Save" : "Add"}
          </Button>
        </>
      )}
    >
      <Form
        id={formId}
        className="flex flex-col gap-4 pt-1"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const input = {
            firstName: String(data.get("firstName")),
            lastName: String(data.get("lastName")),
            studentNumber: String(data.get("studentNumber") ?? ""),
          };
          setPending(true);
          const result = existing
            ? await updateStudentAction(existing.id, { ...input, classId: selectedClass === "none" ? null : selectedClass })
            : await addStudentAction(classId, input);
          setPending(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          setError(null);
          if (existing) {
            onOpenChange(false);
            showSnackbar({ message: "Student updated" });
            onSaved?.(existing.id);
          } else {
            // Stay open so several students can be added in a row.
            showSnackbar({ message: `Added ${input.firstName.trim()} ${input.lastName.trim()}`.trim() });
            form.reset();
            (form.elements.namedItem("firstName") as HTMLInputElement | null)?.focus();
            onSaved?.(null);
          }
        }}
      >
        <FormError message={error} />
        <div className="grid gap-4 medium:grid-cols-2">
          <TextField label="First name" name="firstName" isRequired autoFocus maxLength={60} defaultValue={existing?.firstName} autoComplete="off" />
          <TextField label="Last name" name="lastName" maxLength={60} defaultValue={existing?.lastName} autoComplete="off" />
        </div>
        <TextField
          label="Student ID"
          name="studentNumber"
          maxLength={30}
          defaultValue={existing?.studentNumber ?? undefined}
          description="Optional. Handy if two students share a name."
          autoComplete="off"
        />
        {existing && (
          <Select
            label="Class"
            selectedKey={selectedClass}
            onSelectionChange={(key) => setSelectedClass(String(key))}
            items={[{ id: "none", name: "No class" }, ...classes]}
          >
            {(item) => <ListBoxItem id={item.id}>{item.name}</ListBoxItem>}
          </Select>
        )}
      </Form>
    </Dialog>
  );
}
