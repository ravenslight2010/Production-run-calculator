import { createHash, randomBytes, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, signupAccessCodesTable } from "@workspace/db";
const hash = (value: string) => createHash("sha256").update(value.trim()).digest("hex");
export async function validSignupCode(value: string): Promise<boolean> {
  const [row] = await db.select().from(signupAccessCodesTable).where(eq(signupAccessCodesTable.enabled, true)).orderBy(desc(signupAccessCodesTable.createdAt)).limit(1);
  if (!row) return false;
  const valid = row.codeHash === hash(value);
  await db.update(signupAccessCodesTable).set(valid
    ? { successfulUses: row.successfulUses + 1 }
    : { failedUses: row.failedUses + 1 }).where(eq(signupAccessCodesTable.id, row.id));
  return valid;
}
export async function hasSignupCode(): Promise<boolean> {
  const [row] = await db.select({ id: signupAccessCodesTable.id }).from(signupAccessCodesTable).orderBy(desc(signupAccessCodesTable.createdAt)).limit(1);
  return Boolean(row);
}
export async function rotateSignupCode() {
  const secret = randomBytes(24).toString("base64url");
  await db.update(signupAccessCodesTable).set({ enabled: false }).where(eq(signupAccessCodesTable.enabled, true));
  await db.insert(signupAccessCodesTable).values({ id: randomUUID(), codeHash: hash(secret) });
  return secret;
}
export async function setSignupCodeEnabled(enabled: boolean) {
  await db.update(signupAccessCodesTable).set({ enabled });
}
export async function signupCodeStatus() {
  const [row] = await db.select().from(signupAccessCodesTable).orderBy(desc(signupAccessCodesTable.createdAt)).limit(1);
  return row ? { enabled: row.enabled, successfulUses: row.successfulUses, failedUses: row.failedUses, rotatedAt: row.rotatedAt.toISOString() } : { enabled: false, successfulUses: 0, failedUses: 0, rotatedAt: null };
}