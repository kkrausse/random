import { Suspense } from "react";
import { connection } from "next/server";
import { db } from "@/db";
import {
  photoCommentLikes,
  photoComments,
  photoLikes,
  photos,
  sightings,
  users,
} from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import DeleteButton from "@/components/DeleteButton";
import PhotoBlock from "@/components/PhotoBlock";
import { userRoute } from "@/lib/routes";
import Loading from "./loading";

type PhotoLiker = {
  userId: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
};

type SightingSearchParams = {
  photo?: string | string[];
  comment?: string | string[];
};

type PhotoCommentTree = {
  id: number;
  photoId: number;
  userId: string;
  parentId: number | null;
  body: string;
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
  author: {
    username: string;
    displayName: string;
    profileImageUrl: string | null;
  };
  likeCount: number;
  likedByCurrentUser: boolean;
  replies: PhotoCommentTree[];
};

function buildCommentTrees(
  comments: Omit<PhotoCommentTree, "replies">[]
): PhotoCommentTree[] {
  const byId = new Map<number, PhotoCommentTree>();
  const roots: PhotoCommentTree[] = [];

  for (const comment of comments) {
    byId.set(comment.id, { ...comment, replies: [] });
  }

  for (const comment of byId.values()) {
    if (comment.parentId && byId.has(comment.parentId)) {
      byId.get(comment.parentId)?.replies.push(comment);
    } else {
      roots.push(comment);
    }
  }

  const sortComments = (items: PhotoCommentTree[]) => {
    items.sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id
    );
    for (const item of items) {
      sortComments(item.replies);
    }
  };

  sortComments(roots);
  return roots;
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInteger(value: string | string[] | undefined) {
  const parsed = Number(firstSearchParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function SightingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SightingSearchParams>;
}) {
  return (
    <Suspense fallback={<Loading />}>
      <SightingDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SightingDetailContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SightingSearchParams>;
}) {
  await connection();
  const { userId } = await auth();
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const sightingId = Number(id);
  if (isNaN(sightingId)) notFound();
  const targetPhotoId = parsePositiveInteger(resolvedSearchParams.photo);
  const targetCommentId = parsePositiveInteger(resolvedSearchParams.comment);

  const [sightingRow] = await db
    .select({
      sighting: sightings,
      username: users.username,
      displayName: users.displayName,
    })
    .from(sightings)
    .innerJoin(users, eq(sightings.userId, users.id))
    .where(eq(sightings.id, sightingId));

  if (!sightingRow) notFound();

  const { sighting, username, displayName } = sightingRow;

  const sightingPhotos = await db
    .select()
    .from(photos)
    .where(eq(photos.sightingId, sightingId));

  const photoIds = sightingPhotos.map((photo) => photo.id);

  const photoLikeCountRows = photoIds.length
    ? await db
        .select({
          photoId: photoLikes.photoId,
          likeCount: sql<number>`count(*)`,
        })
        .from(photoLikes)
        .where(inArray(photoLikes.photoId, photoIds))
        .groupBy(photoLikes.photoId)
    : [];

  const currentUserPhotoLikeRows =
    userId && photoIds.length
      ? await db
          .select({
            photoId: photoLikes.photoId,
          })
          .from(photoLikes)
          .where(
            and(
              eq(photoLikes.userId, userId),
              inArray(photoLikes.photoId, photoIds)
            )
          )
      : [];

  const photoLikerRows = photoIds.length
    ? await db
        .select({
          photoId: photoLikes.photoId,
          userId: users.id,
          username: users.username,
          displayName: users.displayName,
          profileImageUrl: users.profileImageUrl,
        })
        .from(photoLikes)
        .innerJoin(users, eq(photoLikes.userId, users.id))
        .where(inArray(photoLikes.photoId, photoIds))
    : [];

  const commentRows = photoIds.length
    ? await db
        .select({
          id: photoComments.id,
          photoId: photoComments.photoId,
          userId: photoComments.userId,
          parentId: photoComments.parentId,
          body: photoComments.body,
          createdAt: photoComments.createdAt,
          updatedAt: photoComments.updatedAt,
          deletedAt: photoComments.deletedAt,
          authorUsername: users.username,
          authorDisplayName: users.displayName,
          authorProfileImageUrl: users.profileImageUrl,
        })
        .from(photoComments)
        .innerJoin(users, eq(photoComments.userId, users.id))
        .where(inArray(photoComments.photoId, photoIds))
        .orderBy(photoComments.createdAt, photoComments.id)
    : [];

  const commentIds = commentRows.map((comment) => comment.id);

  const commentLikeCountRows = commentIds.length
    ? await db
        .select({
          commentId: photoCommentLikes.commentId,
          likeCount: sql<number>`count(*)`,
        })
        .from(photoCommentLikes)
        .where(inArray(photoCommentLikes.commentId, commentIds))
        .groupBy(photoCommentLikes.commentId)
    : [];

  const currentUserCommentLikeRows =
    userId && commentIds.length
      ? await db
          .select({
            commentId: photoCommentLikes.commentId,
          })
          .from(photoCommentLikes)
          .where(
            and(
              eq(photoCommentLikes.userId, userId),
              inArray(photoCommentLikes.commentId, commentIds)
            )
          )
      : [];

  const photoLikeCounts = new Map(
    photoLikeCountRows.map((row) => [row.photoId, row.likeCount])
  );
  const currentUserPhotoLikes = new Set(
    currentUserPhotoLikeRows.map((row) => row.photoId)
  );
  const photoLikers = new Map<number, PhotoLiker[]>();
  for (const row of photoLikerRows) {
    const likers = photoLikers.get(row.photoId) ?? [];
    likers.push({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      profileImageUrl: row.profileImageUrl,
    });
    photoLikers.set(row.photoId, likers);
  }

  const commentLikeCounts = new Map(
    commentLikeCountRows.map((row) => [row.commentId, row.likeCount])
  );
  const currentUserCommentLikes = new Set(
    currentUserCommentLikeRows.map((row) => row.commentId)
  );
  const commentsByPhoto = new Map<number, PhotoCommentTree[]>();
  for (const photoId of photoIds) {
    const flatComments = commentRows
      .filter((comment) => comment.photoId === photoId)
      .map((comment) => ({
        id: comment.id,
        photoId: comment.photoId,
        userId: comment.userId,
        parentId: comment.parentId,
        body: comment.body,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        deletedAt: comment.deletedAt,
        author: {
          username: comment.authorUsername,
          displayName: comment.authorDisplayName,
          profileImageUrl: comment.authorProfileImageUrl,
        },
        likeCount: commentLikeCounts.get(comment.id) ?? 0,
        likedByCurrentUser: currentUserCommentLikes.has(comment.id),
      }));

    commentsByPhoto.set(photoId, buildCommentTrees(flatComments));
  }

  const photoBlocks = sightingPhotos.map((photo) => ({
    photo,
    likeCount: photoLikeCounts.get(photo.id) ?? 0,
    likedByCurrentUser: currentUserPhotoLikes.has(photo.id),
    likers: photoLikers.get(photo.id) ?? [],
    comments: commentsByPhoto.get(photo.id) ?? [],
  }));

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Link href="/" className="text-blue-600 hover:underline text-sm">
        &larr; Back to Explore
      </Link>

      <h1 className="text-2xl font-bold mt-3 mb-1">{sighting.species}</h1>
      <Link
        href={`/user/${username}`}
        className="text-sm text-blue-600 hover:underline"
      >
        by @{username}
        <span className="sr-only"> ({displayName})</span>
      </Link>
      <p className="text-sm text-gray-500 mb-1">{sighting.date}</p>
      <p className="text-sm text-gray-600 mb-1">{sighting.locationName}</p>
      <p className="text-xs text-gray-400 mb-4">
        {sighting.lat.toFixed(5)}, {sighting.lng.toFixed(5)}
      </p>

      {sighting.notes && (
        <p className="text-gray-700 mb-6">{sighting.notes}</p>
      )}

      {sightingPhotos.length > 0 && (
        <div className="space-y-4 mb-6">
          {photoBlocks.map((photoBlock) => (
            <PhotoBlock
              key={photoBlock.photo.id}
              photo={{
                id: photoBlock.photo.id,
                filename: photoBlock.photo.filename,
                width: photoBlock.photo.width,
                height: photoBlock.photo.height,
              }}
              species={sighting.species}
              sightingId={sighting.id}
              currentUserId={userId}
              initialLikeCount={photoBlock.likeCount}
              initialLikedByCurrentUser={photoBlock.likedByCurrentUser}
              likers={photoBlock.likers}
              comments={photoBlock.comments}
              targetPhotoId={targetPhotoId}
              targetCommentId={targetCommentId}
            />
          ))}
        </div>
      )}

      {sightingPhotos.length === 0 && (
        <div className="mb-6 rounded-lg border border-dashed p-4 text-sm text-gray-500">
          No photos for this sighting yet.
        </div>
      )}

      {userId === sighting.userId && (
        <div className="flex gap-3">
          <Link
            href={`/sighting/${sighting.id}/edit`}
            className="text-blue-600 hover:underline text-sm"
          >
            Edit
          </Link>
          <DeleteButton
            sightingId={sighting.id}
            redirectHref={userRoute(username)}
          />
        </div>
      )}
    </main>
  );
}
