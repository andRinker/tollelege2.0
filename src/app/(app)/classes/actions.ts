"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { MAX_IMPORT_ROWS } from "@/lib/roster-parse";
import { isUserFacingError } from "@/server/errors";
import {
  addStudent,
  createClass,
  deleteClass,
  deleteStudent,
  importStudents,
  setClassArchived,
  setStudentActive,
  updateClass,
  updateStudent,
} from "@/server/roster";
import { assertClassInScope, assertOwner, assertStudentInScope, type Classroom } from "@/server/coteaching";
import { requireClassroom } from "@/server/session";

function handleError(error: unknown): { ok: false; message: string } {
  if (isUserFacingError(error)) return fail(error.message);
  console.error(error);
  return fail("Something went wrong. Try again.");
}

function revalidateRosters() {
  // Rosters appear on class, student, checkout, and dashboard pages.
  revalidatePath("/", "layout");
}

const id = z.uuid();

const classInput = z.object({
  name: z.string().trim().min(1, "Enter a class name.").max(60, "Keep the class name under 60 characters."),
  schoolYear: z.string().trim().min(1, "Enter a school year.").max(20),
});

const name = (label: string, required: boolean) =>
  z
    .string()
    .trim()
    .max(60, `Keep the ${label} under 60 characters.`)
    .refine((value) => !required || value.length > 0, `Enter a ${label}.`);

const studentInput = z.object({
  firstName: name("first name", true),
  lastName: name("last name", false),
  studentNumber: z
    .string()
    .trim()
    .max(30, "Keep the student ID under 30 characters.")
    .nullable()
    .transform((value) => value || null),
});

function firstIssue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Check the details and try again.";
}

/**
 * Where a co-teacher may put a student: one of their shared classes, never "no class",
 * which would take the student out of every class they can see.
 */
async function assertStudentClassAllowed(classroom: Classroom, classId: string | null): Promise<void> {
  if (classId === null) {
    assertOwner(classroom, "take a student out of their classes");
    return;
  }
  await assertClassInScope(getDb(), classroom, classId);
}

export async function createClassAction(input: z.input<typeof classInput>): Promise<ActionResult<{ classId: string }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  const parsed = classInput.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    assertOwner(classroom, "add classes to this classroom");
    const klass = await createClass(getDb(), teacherId, parsed.data);
    revalidateRosters();
    return ok({ classId: klass.id });
  } catch (error) {
    return handleError(error);
  }
}

export async function updateClassAction(classId: string, input: z.input<typeof classInput>): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  const parsed = classInput.safeParse(input);
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    assertOwner(classroom, "rename this class");
    await updateClass(getDb(), teacherId, classId, parsed.data);
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function archiveClassAction(classId: string, archived: boolean): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  try {
    assertOwner(classroom, "archive this class");
    await setClassArchived(getDb(), teacherId, classId, archived);
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteClassAction(classId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  try {
    assertOwner(classroom, "delete this class");
    await deleteClass(getDb(), teacherId, classId);
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function addStudentAction(
  classId: string | null,
  input: z.input<typeof studentInput>,
): Promise<ActionResult<{ studentId: string }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (classId !== null && !id.safeParse(classId).success) return fail("That class wasn't found.");
  const parsed = studentInput.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await assertStudentClassAllowed(classroom, classId);
    const student = await addStudent(getDb(), teacherId, classId, parsed.data);
    revalidateRosters();
    return ok({ studentId: student!.id });
  } catch (error) {
    return handleError(error);
  }
}

export async function importStudentsAction(
  classId: string,
  incoming: Array<z.input<typeof studentInput>>,
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(classId).success) return fail("That class wasn't found.");
  const parsed = z.array(studentInput).min(1, "There are no students to add.").max(MAX_IMPORT_ROWS).safeParse(incoming);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await assertStudentClassAllowed(classroom, classId);
    const result = await importStudents(getDb(), teacherId, classId, parsed.data);
    revalidateRosters();
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function updateStudentAction(
  studentId: string,
  input: z.input<typeof studentInput> & { classId: string | null },
): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  const parsed = studentInput.safeParse(input);
  if (!id.safeParse(studentId).success || (input.classId !== null && !id.safeParse(input.classId).success)) {
    return fail("That student wasn't found.");
  }
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await assertStudentInScope(getDb(), classroom, studentId);
    await assertStudentClassAllowed(classroom, input.classId);
    await updateStudent(getDb(), teacherId, studentId, { ...parsed.data, classId: input.classId });
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function setStudentActiveAction(studentId: string, active: boolean): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(studentId).success) return fail("That student wasn't found.");
  try {
    await assertStudentInScope(getDb(), classroom, studentId);
    await setStudentActive(getDb(), teacherId, studentId, active);
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteStudentAction(studentId: string): Promise<ActionResult> {
  const classroom = await requireClassroom();
  const { teacherId } = classroom;
  if (!id.safeParse(studentId).success) return fail("That student wasn't found.");
  try {
    assertOwner(classroom, "delete students, since it erases their reading history");
    await deleteStudent(getDb(), teacherId, studentId);
    revalidateRosters();
    return ok();
  } catch (error) {
    return handleError(error);
  }
}
