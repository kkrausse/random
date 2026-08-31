import Image from "next/image";
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  imageUrl: string | null;
  displayName: string;
  username: string;
  size?: "sm" | "lg";
  className?: string;
};

const sizes = {
  sm: "size-6 text-[10px]",
  lg: "size-16 text-xl",
};

function initials(displayName: string, username: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const value =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`
      : (parts[0]?.slice(0, 2) ?? username.slice(0, 2));

  return value.toUpperCase();
}

export default function UserAvatar({
  imageUrl,
  displayName,
  username,
  size = "sm",
  className,
}: UserAvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 font-semibold text-gray-500 ring-1 ring-gray-200",
        sizes[size],
        className
      )}
      aria-hidden="true"
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={size === "lg" ? "64px" : "24px"}
          className="object-cover"
        />
      ) : (
        initials(displayName, username)
      )}
    </span>
  );
}
