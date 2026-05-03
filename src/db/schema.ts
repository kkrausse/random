import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user id
    // Mirrored from Clerk for joins and public URLs. Clerk remains authoritative for these fields.
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    // App-owned profile fields live here and can be edited by this app.
    bio: text("bio"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("users_username_lower_unique").on(sql`lower(${table.username})`),
  ]
);

export const sightings = sqliteTable("sightings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  species: text("species").notNull(),
  speciesCode: text("species_code").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  locationName: text("location_name").notNull(),
  notes: text("notes").default(""),
  // onDelete cascade: deleting a user removes all their sightings
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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

export const photoLikes = sqliteTable(
  "photo_likes",
  {
    photoId: integer("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("photo_likes_photo_id_user_id_unique").on(
      table.photoId,
      table.userId
    ),
  ]
);

export const photoComments = sqliteTable(
  "photo_comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => photoComments.id,
      { onDelete: "cascade" }
    ),
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at"),
  },
  (table) => [
    index("photo_comments_photo_id_created_at_idx").on(
      table.photoId,
      table.createdAt
    ),
    index("photo_comments_parent_id_created_at_idx").on(
      table.parentId,
      table.createdAt
    ),
    index("photo_comments_user_id_idx").on(table.userId),
  ]
);

export const photoCommentLikes = sqliteTable(
  "photo_comment_likes",
  {
    commentId: integer("comment_id")
      .notNull()
      .references(() => photoComments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("photo_comment_likes_comment_id_user_id_unique").on(
      table.commentId,
      table.userId
    ),
  ]
);
