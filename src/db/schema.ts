import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const sightings = sqliteTable("sightings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  species: text("species").notNull(),
  speciesCode: text("species_code").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  locationName: text("location_name").notNull(),
  notes: text("notes").default(""),
  userId: text("user_id").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sightingId: integer("sighting_id")
    .notNull()
    .references(() => sightings.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
