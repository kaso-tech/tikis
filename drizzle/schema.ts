import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Core Manus user table kept for the template OAuth layer. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

/**
 * Tikis phone-based profile. The phone number is unique and the account type
 * is intentionally immutable after first registration.
 */
export const tikisProfiles = mysqlTable("tikis_profiles", {
  id: int("id").autoincrement().primaryKey(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  fullName: varchar("fullName", { length: 70 }).notNull(),
  accountType: mysqlEnum("accountType", ["sender", "driver"]).notNull(),
  vehicles: text("vehicles").notNull(),
  photoKey: varchar("photoKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type TikisProfile = typeof tikisProfiles.$inferSelect;
export type InsertTikisProfile = typeof tikisProfiles.$inferInsert;
