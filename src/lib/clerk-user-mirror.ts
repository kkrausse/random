export type ClerkUserMirrorSource = {
  id: string;
  username: string | null;
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

export function deriveMirroredUsername(data: ClerkUserMirrorSource): string {
  if (data.username) {
    return data.username;
  }

  return `birder-${data.id.slice(-8).toLowerCase()}`;
}

export function deriveMirroredDisplayName(data: ClerkUserMirrorSource): string {
  const parts = [firstName(data), lastName(data)].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return data.username ?? deriveMirroredUsername(data);
}
