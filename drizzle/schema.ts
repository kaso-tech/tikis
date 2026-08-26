import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
  referralCode: varchar("referralCode", { length: 8 }).unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Canonical GPS-first place cache. Coordinates remain the source of truth for all geographic calculations. */
export const tikisPlaces = mysqlTable("tikis_places", {
  id: int("id").autoincrement().primaryKey(),
  googlePlaceId: varchar("googlePlaceId", { length: 255 }).unique(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  formattedAddress: varchar("formattedAddress", { length: 255 }).notNull(),
  placeName: varchar("placeName", { length: 140 }).notNull(),
  street: varchar("street", { length: 160 }),
  district: varchar("district", { length: 120 }),
  city: varchar("city", { length: 120 }),
  province: varchar("province", { length: 120 }),
  country: varchar("country", { length: 120 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** Sender-owned shortcuts to canonical places; natural labels make favourites recognisable in the form. */
export const tikisFavoritePlaces = mysqlTable("tikis_favorite_places", {
  id: int("id").autoincrement().primaryKey(),
  profilePhone: varchar("profilePhone", { length: 20 }).notNull(),
  placeId: int("placeId").notNull(),
  label: varchar("label", { length: 80 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [uniqueIndex("tikis_favorite_places_profile_place_unique").on(table.profilePhone, table.placeId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type TikisProfile = typeof tikisProfiles.$inferSelect;
export type InsertTikisProfile = typeof tikisProfiles.$inferInsert;
export type TikisPlace = typeof tikisPlaces.$inferSelect;
export type InsertTikisPlace = typeof tikisPlaces.$inferInsert;
export type TikisFavoritePlace = typeof tikisFavoritePlaces.$inferSelect;
