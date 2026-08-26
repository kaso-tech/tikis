import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, tikisProfiles, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: new Date() };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export type PersistedTikisProfile = {
  phone: string;
  fullName: string;
  accountType: "sender" | "driver";
  vehicles: string;
  photoKey?: string | null;
};

export async function getTikisProfileByPhone(phone: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tikisProfiles).where(eq(tikisProfiles.phone, phone)).limit(1);
  return result[0];
}

/** Creates a profile once; an existing profile is returned untouched to preserve its account type. */
export async function createTikisProfile(input: PersistedTikisProfile) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  const existing = await getTikisProfileByPhone(input.phone);
  if (existing) return existing;
  await db.insert(tikisProfiles).values(input);
  const created = await getTikisProfileByPhone(input.phone);
  if (!created) throw new Error("Le profil n’a pas pu être enregistré.");
  return created;
}

export async function updateTikisProfile(phone: string, changes: Pick<PersistedTikisProfile, "fullName" | "photoKey">) {
  const db = await getDb();
  if (!db) throw new Error("La base de données sécurisée est temporairement indisponible.");
  await db.update(tikisProfiles).set({ ...changes, updatedAt: new Date() }).where(eq(tikisProfiles.phone, phone));
  const profile = await getTikisProfileByPhone(phone);
  if (!profile) throw new Error("Le profil est introuvable.");
  return profile;
}
