import { useSyncExternalStore } from "react";

// Two screens: the list at "/", a session at "/s/<key>". History API, so the phone's back works.
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  for (const fn of listeners) fn();
}

export const sessionPath = (key: string) => `/s/${encodeURIComponent(key)}`;
export const keyFromPath = (path: string) => (path.startsWith("/s/") ? decodeURIComponent(path.slice(3)) : undefined);

/** Back to the list: pop our own history entry when there is one, so back/forward stay sane. */
export function goBack() {
  if (history.state?.fromList) history.back();
  else navigate("/", true);
}

export function openSession(key: string) {
  history.pushState({ fromList: true }, "", sessionPath(key));
  for (const fn of listeners) fn();
}
