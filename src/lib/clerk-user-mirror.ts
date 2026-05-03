export type ClerkUserMirrorSource = {
  id: string;
  username: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

function firstName(data: ClerkUserMirrorSource): string | null {
  return data.firstName ?? data.first_name ?? null;
}

function lastName(data: ClerkUserMirrorSource): string | null {
  return data.lastName ?? data.last_name ?? null;
}

export function mirroredProfileImageUrl(data: ClerkUserMirrorSource): string | null {
  return data.imageUrl ?? data.image_url ?? null;
}

export function normalizeMirroredUsername(username: string | null): string | null {
  const normalized = username
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || null;
}

export function hasClerkUsername(data: ClerkUserMirrorSource): boolean {
  return normalizeMirroredUsername(data.username) !== null;
}

export function deriveMirroredUsername(data: ClerkUserMirrorSource): string {
  const username = normalizeMirroredUsername(data.username);
  if (username) {
    return username;
  }

  return `birder-${data.id.slice(-8).toLowerCase()}`;
}

export async function deriveAvailableMirroredUsername(
  data: ClerkUserMirrorSource,
  isUsernameTaken: (username: string) => boolean | Promise<boolean>
): Promise<string> {
  const base = deriveMirroredUsername(data);

  // Clerk usernames are authoritative. Only locally derived fallback usernames
  // are de-duplicated here; real username collisions should be resolved in Clerk.
  if (hasClerkUsername(data)) {
    return base;
  }

  let username = base;
  let suffix = 0;
  while (await isUsernameTaken(username)) {
    suffix++;
    username = `${base}${suffix}`;
  }

  return username;
}

export function deriveMirroredDisplayName(data: ClerkUserMirrorSource): string {
  const parts = [firstName(data), lastName(data)].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return data.username?.trim() || deriveMirroredUsername(data);
}
