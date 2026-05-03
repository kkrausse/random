# Photo Comments and Likes Plan

## Overview

Add photo-scoped likes and threaded comments to sighting detail pages. The interaction model is intentionally basic and close to Hacker News: each photo has its own comment thread directly below it, comments can have nested replies, comments can be liked, photos can be liked, and signed-out users are sent through sign-in before they can mutate anything.

Photos already have stable database identity in `photos.id`, so likes and comments should target individual photo rows rather than sightings or filenames.

## Decisions

- Photo likes require a signed-in user.
- Photo comments and replies require a signed-in user.
- Comment likes require a signed-in user.
- Users cannot like their own comments for now.
- Clicking the heart toggles the current user's photo like when signed in.
- Clicking the heart while signed out navigates to `/sign-in`.
- Clicking the visible likes text opens a shadcn dialog listing users who liked the photo.
- Each photo's comment section renders directly below that photo on the sighting detail page.
- Comment links use `/sighting/:id?photo=:photoId&comment=:commentId` for now.
- Loading a URL with `photo` or `comment` query params scrolls to that photo/comment after the page renders.

## Schema

- [ ] Add `photo_likes` table with `photo_id`, `user_id`, and `created_at`.
- [ ] Add a unique index on `photo_likes(photo_id, user_id)` so a user can like a photo once.
- [ ] Add foreign keys from `photo_likes.photo_id` to `photos.id` and `photo_likes.user_id` to `users.id`, both cascading on delete.
- [ ] Add `photo_comments` table with `id`, `photo_id`, `user_id`, `parent_id`, `body`, `created_at`, and optional `updated_at`.
- [ ] Make `photo_comments.parent_id` a self-reference with cascading delete, or document and implement the chosen delete behavior if full cascade is awkward in SQLite/Drizzle.
- [ ] Add indexes for `photo_comments(photo_id, created_at)`, `photo_comments(parent_id, created_at)`, and `photo_comments(user_id)`.
- [ ] Add `photo_comment_likes` table with `comment_id`, `user_id`, and `created_at`.
- [ ] Add a unique index on `photo_comment_likes(comment_id, user_id)`.
- [ ] Add foreign keys from `photo_comment_likes.comment_id` to `photo_comments.id` and `photo_comment_likes.user_id` to `users.id`, both cascading on delete.
- [ ] Generate a Drizzle migration with `bun run db:generate`.
- [ ] Review the generated SQL for SQLite-compatible constraints and index names.

## Server Data

- [ ] Update `src/db/schema.ts` with the three new tables and relations/indexes.
- [ ] On `src/app/sighting/[id]/page.tsx`, query photo like counts for all photos in the sighting.
- [ ] Include whether the current signed-in user liked each photo.
- [ ] Query photo liker users for dialog display, either upfront for the current sighting or lazily through an API route.
- [ ] Query all comments for the sighting's photos in one batch.
- [ ] Query comment like counts for those comments.
- [ ] Include whether the current signed-in user liked each comment.
- [ ] Include comment authors with `username` and `displayName`.
- [ ] Convert flat comment rows into nested trees in application code.

## API

- [ ] Add `POST /api/photos/[photoId]/likes` to toggle or create the current user's photo like.
- [ ] Add `DELETE /api/photos/[photoId]/likes` if explicit unlike is cleaner than toggle semantics.
- [ ] Return `401` for signed-out users; client should navigate to `/sign-in`.
- [ ] Return `404` if the photo does not exist.
- [ ] Add `GET /api/photos/[photoId]/likes` for the liker list if not loaded in the page query.
- [ ] Add `POST /api/photos/[photoId]/comments` to create a top-level comment or reply with optional `parentId`.
- [ ] Validate that `parentId`, when provided, belongs to the same `photoId`.
- [ ] Add `POST /api/photo-comments/[commentId]/likes` to like a comment.
- [ ] Add `DELETE /api/photo-comments/[commentId]/likes` or toggle behavior for unliking.
- [ ] Block liking your own comment with a `403`.
- [ ] Validate comment body length and reject empty or whitespace-only comments.
- [ ] Revalidate or refresh sighting detail data after mutations.

## UI Components

- [ ] Create a client component for a photo block with image, heart button, like count text, and comments below.
- [ ] Use `Heart` from `lucide-react` for the photo like button.
- [ ] Render an outlined heart when not liked and a filled/active heart when liked.
- [ ] Keep the heart button separate from the likes text so the text can open the liker dialog.
- [ ] Use existing shadcn `Dialog` for the liker list.
- [ ] Add a lightweight threaded comment component styled like Hacker News: compact text, author/time metadata, small action links, indentation for replies.
- [ ] Add a comment form below each photo for top-level comments.
- [ ] Add inline reply forms under comments.
- [ ] Add comment like controls and counts to each comment.
- [ ] Disable or redirect comment and like actions for signed-out users.
- [ ] Keep optimistic UI minimal; prefer correctness and `router.refresh()` unless latency becomes painful.

## Auth Behavior

- [ ] Use Clerk `auth()` on the server and API routes to identify the current user.
- [ ] When a signed-out user clicks photo like, comment like, comment submit, or reply, navigate to `/sign-in`.
- [ ] Preserve return location with the current sighting/photo/comment target if Clerk supports the current app's sign-in return flow.
- [ ] Ensure server routes enforce auth even if the client hides or redirects controls.

## Deep Links and Scrolling

- [ ] Read `photo` and `comment` from sighting page `searchParams`.
- [ ] Add stable DOM IDs such as `photo-:photoId` and `comment-:commentId`.
- [ ] Add a small client-side scroll helper that scrolls to the comment if present, otherwise the photo.
- [ ] Highlight the target comment briefly or with a subtle static style.
- [ ] Ensure generated comment links use `/sighting/:sightingId?photo=:photoId&comment=:commentId`.

## Edge Cases

- [ ] Handle photos with zero likes and zero comments cleanly.
- [ ] Handle deleted users only if the current user deletion behavior can leave orphaned comments; otherwise rely on cascade.
- [ ] Handle a `comment` query param that does not belong to the requested `photo`.
- [ ] Prevent duplicate likes under rapid clicks through database uniqueness and client pending state.
- [ ] Make comment trees deterministic by sorting siblings by `created_at` then `id`.
- [ ] Decide whether deleting a photo deletes all likes/comments through cascade and verify it does.

## Verification

- [ ] Run `bun run tsc` for type validation.
- [ ] Run `bun run lint` if changes touch enough client UI to warrant lint coverage.
- [ ] Manually verify signed-out photo like redirects to `/sign-in`.
- [ ] Manually verify signed-in photo like/unlike changes count and heart state.
- [ ] Manually verify the likes text opens a dialog listing liker usernames.
- [ ] Manually verify top-level comments, replies, and comment likes.
- [ ] Manually verify liking your own comment is blocked.
- [ ] Manually verify `/sighting/:id?photo=:photoId&comment=:commentId` scrolls to the expected comment.
