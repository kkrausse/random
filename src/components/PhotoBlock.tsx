"use client";

import { FormEvent, useEffect, useState } from "react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Heart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import UserAvatar from "@/components/UserAvatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type PhotoBlockComment = {
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
  replies: PhotoBlockComment[];
};

type PhotoBlockLiker = {
  userId: string;
  username: string;
  displayName: string;
  profileImageUrl: string | null;
};

type PhotoBlockPhoto = {
  id: number;
  filename: string;
  width: number | null;
  height: number | null;
};

type PhotoBlockProps = {
  photo: PhotoBlockPhoto;
  species: string;
  sightingId: number;
  currentUserId: string | null;
  initialLikeCount: number;
  initialLikedByCurrentUser: boolean;
  likers: PhotoBlockLiker[];
  comments: PhotoBlockComment[];
  targetPhotoId: number | null;
  targetCommentId: number | null;
};

type AuthRedirectTarget = {
  photoId?: number;
  commentId?: number;
};

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countComments(comments: PhotoBlockComment[]): number {
  return comments.reduce(
    (total, comment) =>
      total + (comment.deletedAt ? 0 : 1) + countComments(comment.replies),
    0
  );
}

function hasComment(comments: PhotoBlockComment[], commentId: number): boolean {
  return comments.some(
    (comment) =>
      comment.id === commentId || hasComment(comment.replies, commentId)
  );
}

function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function PhotoBlock({
  photo,
  species,
  sightingId,
  currentUserId,
  initialLikeCount,
  initialLikedByCurrentUser,
  likers,
  comments,
  targetPhotoId,
  targetCommentId,
}: PhotoBlockProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [liked, setLiked] = useState(initialLikedByCurrentUser);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [photoLikePending, setPhotoLikePending] = useState(false);
  const commentCount = countComments(comments);
  const targetCommentIsInPhoto =
    targetCommentId !== null && hasComment(comments, targetCommentId);
  const shouldTargetComment =
    targetCommentIsInPhoto &&
    (targetPhotoId === null || targetPhotoId === photo.id);
  const highlightedCommentId = shouldTargetComment ? targetCommentId : null;

  useEffect(() => {
    if (window.location.hash === `#photo-${photo.id}-comments`) {
      document
        .getElementById(`photo-${photo.id}-comments`)
        ?.scrollIntoView({ block: "start" });
      return;
    }

    if (shouldTargetComment && targetCommentId !== null) {
      document
        .getElementById(`comment-${targetCommentId}`)
        ?.scrollIntoView({ block: "center" });
      return;
    }

    if (targetCommentId === null && targetPhotoId === photo.id) {
      document
        .getElementById(`photo-${photo.id}`)
        ?.scrollIntoView({ block: "start" });
    }
  }, [photo.id, shouldTargetComment, targetCommentId, targetPhotoId]);

  function redirectToSignIn(target?: AuthRedirectTarget) {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (target?.photoId) {
      nextSearchParams.set("photo", String(target.photoId));
    }
    if (target?.commentId) {
      nextSearchParams.set("comment", String(target.commentId));
    }

    const query = nextSearchParams.toString();
    const returnTo = `${pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    router.push(
      `/sign-in?redirect_url=${encodeURIComponent(returnTo)}` as Route
    );
  }

  async function togglePhotoLike() {
    if (!currentUserId) {
      redirectToSignIn({ photoId: photo.id });
      return;
    }

    setPhotoLikePending(true);
    const nextLiked = !liked;
    try {
      const response = await fetch(`/api/photos/${photo.id}/likes`, {
        method: nextLiked ? "POST" : "DELETE",
      });

      if (response.status === 401) {
        redirectToSignIn();
        return;
      }

      if (response.ok) {
        setLiked(nextLiked);
        setLikeCount((count) => count + (nextLiked ? 1 : -1));
        router.refresh();
      }
    } finally {
      setPhotoLikePending(false);
    }
  }

  return (
    <section id={`photo-${photo.id}`} className="space-y-3">
      <div
        className="relative w-full overflow-hidden rounded-lg bg-muted"
        style={{
          aspectRatio:
            photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 3",
        }}
      >
        <Image
          src={`/api/uploads/${photo.filename}`}
          alt={species}
          fill
          sizes="(min-width: 768px) 672px, calc(100vw - 48px)"
          className="object-contain"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={togglePhotoLike}
          disabled={photoLikePending}
          aria-pressed={liked}
          aria-label={liked ? "Unlike photo" : "Like photo"}
          className={cn(liked && "text-red-600 hover:text-red-700")}
        >
          <Heart className={cn(liked && "fill-current")} />
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="text-sm text-gray-600 hover:text-gray-950 hover:underline disabled:cursor-default disabled:no-underline"
            >
              {formatCount(likeCount, "like")}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Photo Likes</DialogTitle>
            </DialogHeader>
            {likers.length > 0 ? (
              <ul className="space-y-2">
                {likers.map((liker) => (
                  <li key={liker.userId}>
                    <Link
                      href={`/user/${liker.username}`}
                      className="inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
                    >
                      <UserAvatar
                        imageUrl={liker.profileImageUrl}
                        displayName={liker.displayName}
                        username={liker.username}
                      />
                      @{liker.username}
                      <span className="sr-only"> ({liker.displayName})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No likes yet.</p>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div id={`photo-${photo.id}-comments`} className="scroll-mt-4 border-t pt-3">
        <div className="mb-3 text-sm font-medium">
          {formatCount(commentCount, "comment")}
        </div>
        <CommentList
          comments={comments}
          currentUserId={currentUserId}
          sightingId={sightingId}
          targetCommentId={highlightedCommentId}
          onAuthRequired={redirectToSignIn}
        />
        <CommentForm
          photoId={photo.id}
          onAuthRequired={redirectToSignIn}
          currentUserId={currentUserId}
        />
      </div>
    </section>
  );
}

function CommentList({
  comments,
  currentUserId,
  sightingId,
  targetCommentId,
  onAuthRequired,
}: {
  comments: PhotoBlockComment[];
  currentUserId: string | null;
  sightingId: number;
  targetCommentId: number | null;
  onAuthRequired: (target?: AuthRedirectTarget) => void;
}) {
  if (comments.length === 0) {
    return <p className="mb-3 text-sm text-gray-500">No comments yet.</p>;
  }

  return (
    <div className="mb-3 space-y-3">
      {comments.map((comment) => (
        <ThreadedComment
          key={comment.id}
          comment={comment}
          currentUserId={currentUserId}
          sightingId={sightingId}
          targetCommentId={targetCommentId}
          onAuthRequired={onAuthRequired}
        />
      ))}
    </div>
  );
}

function ThreadedComment({
  comment,
  currentUserId,
  sightingId,
  targetCommentId,
  onAuthRequired,
}: {
  comment: PhotoBlockComment;
  currentUserId: string | null;
  sightingId: number;
  targetCommentId: number | null;
  onAuthRequired: (target?: AuthRedirectTarget) => void;
}) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [liked, setLiked] = useState(comment.likedByCurrentUser);
  const [likeCount, setLikeCount] = useState(comment.likeCount);
  const [likePending, setLikePending] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDeleted = Boolean(comment.deletedAt);
  const canDelete = currentUserId === comment.userId && !isDeleted;

  async function toggleCommentLike() {
    if (isDeleted) return;

    if (!currentUserId) {
      onAuthRequired({ photoId: comment.photoId, commentId: comment.id });
      return;
    }

    setLikePending(true);
    setError(null);
    const nextLiked = !liked;
    try {
      const response = await fetch(`/api/photo-comments/${comment.id}/likes`, {
        method: nextLiked ? "POST" : "DELETE",
      });

      if (response.status === 401) {
        onAuthRequired({ photoId: comment.photoId, commentId: comment.id });
        return;
      }

      if (response.ok) {
        setLiked(nextLiked);
        setLikeCount((count) => count + (nextLiked ? 1 : -1));
        router.refresh();
      } else {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Unable to update like");
      }
    } finally {
      setLikePending(false);
    }
  }

  async function deleteComment() {
    if (!currentUserId) {
      onAuthRequired({ photoId: comment.photoId, commentId: comment.id });
      return;
    }

    setDeletePending(true);
    setError(null);
    try {
      const response = await fetch(`/api/photo-comments/${comment.id}`, {
        method: "DELETE",
      });

      if (response.status === 401) {
        onAuthRequired({ photoId: comment.photoId, commentId: comment.id });
        return;
      }

      if (response.ok) {
        setReplying(false);
        router.refresh();
      } else {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? "Unable to delete comment");
      }
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <article
      id={`comment-${comment.id}`}
      className={cn(
        "scroll-mt-6 text-sm",
        targetCommentId === comment.id &&
          "-mx-2 rounded-md bg-amber-50 px-2 py-1 ring-1 ring-amber-200"
      )}
    >
      {isDeleted ? (
        <div className="text-xs text-gray-500">
          <span className="italic">deleted comment</span>{" "}
          <Link
            href={`/sighting/${sightingId}?photo=${comment.photoId}&comment=${comment.id}`}
            className="hover:underline"
          >
            {formatCommentTime(comment.createdAt)}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Link
              href={`/user/${comment.author.username}`}
              className="mt-0.5 shrink-0"
            >
              <UserAvatar
                imageUrl={comment.author.profileImageUrl}
                displayName={comment.author.displayName}
                username={comment.author.username}
              />
              <span className="sr-only">{comment.author.displayName}</span>
            </Link>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-500">
                <Link
                  href={`/user/${comment.author.username}`}
                  className="text-gray-700 hover:underline"
                >
                  @{comment.author.username}
                </Link>{" "}
                <Link
                  href={`/sighting/${sightingId}?photo=${comment.photoId}&comment=${comment.id}`}
                  className="hover:underline"
                >
                  {formatCommentTime(comment.createdAt)}
                </Link>
              </div>
              <p className="mt-1 whitespace-pre-wrap leading-snug text-gray-900">
                {comment.body}
              </p>
              <div className="mt-1 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={toggleCommentLike}
                  disabled={likePending}
                  className={cn(
                    "text-gray-500 hover:text-gray-950 hover:underline disabled:opacity-60",
                    liked && "text-red-600"
                  )}
                >
                  {liked ? "unlike" : "like"} ({likeCount})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    currentUserId
                      ? setReplying((value) => !value)
                      : onAuthRequired({
                          photoId: comment.photoId,
                          commentId: comment.id,
                        })
                  }
                  className="text-gray-500 hover:text-gray-950 hover:underline"
                >
                  reply
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={deleteComment}
                    disabled={deletePending}
                    aria-label="Delete comment"
                    className="inline-flex items-center text-gray-500 hover:text-red-600 disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {replying && !isDeleted && (
        <div className="mt-2">
          <CommentForm
            photoId={comment.photoId}
            parentId={comment.id}
            currentUserId={currentUserId}
            onAuthRequired={onAuthRequired}
            onSubmitted={() => setReplying(false)}
          />
        </div>
      )}
      {comment.replies.length > 0 && (
        <div className="mt-3 space-y-3 border-l pl-4">
          {comment.replies.map((reply) => (
            <ThreadedComment
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              sightingId={sightingId}
              targetCommentId={targetCommentId}
              onAuthRequired={onAuthRequired}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function CommentForm({
  photoId,
  parentId = null,
  currentUserId,
  onAuthRequired,
  onSubmitted,
}: {
  photoId: number;
  parentId?: number | null;
  currentUserId: string | null;
  onAuthRequired: (target?: AuthRedirectTarget) => void;
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!currentUserId) {
      onAuthRequired({ photoId, commentId: parentId ?? undefined });
      return;
    }

    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Comment body is required");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/photos/${photoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmedBody, parentId }),
      });

      if (response.status === 401) {
        onAuthRequired({ photoId, commentId: parentId ?? undefined });
        return;
      }

      if (response.ok) {
        setBody("");
        onSubmitted?.();
        router.refresh();
      } else {
        const responseBody = await response.json().catch(() => null);
        setError(responseBody?.error ?? "Unable to post comment");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submitComment} className="space-y-2">
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onFocus={() => {
          if (!currentUserId) {
            onAuthRequired({ photoId, commentId: parentId ?? undefined });
          }
        }}
        placeholder={parentId ? "Reply" : "Add a comment"}
        maxLength={2000}
        disabled={pending}
        className="min-h-14 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {parentId ? "Reply" : "Comment"}
      </Button>
    </form>
  );
}
