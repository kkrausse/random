export type DisplaySession = {
  name: string;
  command: string;
};

export function hasAutomaticSessionName(name: string) {
  return /^\d+$/.test(name) || /^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);
}

export function sessionLabel(session: DisplaySession) {
  return hasAutomaticSessionName(session.name) ? session.command || "Shell" : session.name;
}
