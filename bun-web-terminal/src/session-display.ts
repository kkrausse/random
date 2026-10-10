export type DisplaySession = {
  id: string;
  name: string;
  command: string;
};

// A session nobody renamed is called by its id.
export function hasAutomaticSessionName(session: Pick<DisplaySession, "id" | "name">) {
  return session.name === session.id;
}

export function sessionLabel(session: DisplaySession) {
  return hasAutomaticSessionName(session) ? session.command || "Shell" : session.name;
}
