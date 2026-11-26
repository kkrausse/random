// faplex as a React component for another app's page (the Walks app's Claude view):
//
//   import { FaplexEmbed } from "faplex-embed"; import "faplex-embed/faplex-embed.css";
//   <FaplexEmbed server="https://diesel2…:9447" start="/s/<key>" onClose={…} />
//
// It talks to the faplex server across origins with a token (server: embed-auth.ts). The access
// key is typed into the form here (a password field, so a password manager can fill it), swapped
// for the token, and dropped; only the token is kept (localStorage, per server). Render it inside
// an element that fills the screen; it brings its own colours (.faplex) but no page-wide styles.
import { useEffect, useLayoutEffect, useState } from "react";
import { ChevronDown, KeyRound, Loader } from "lucide-react";
import { App } from "../app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiUrl, configureEndpoint } from "../endpoint";
import { setMemoryRouting, usePath } from "../router";
import { setCloseHandler } from "../walks-panel";

const storeKey = (server: string) => `faplex-token:${server}`;

/** `onNavigate` gets every screen change (list "/" or "/s/<key>"), so a host can reopen there after a reload. */
export function FaplexEmbed({ server, start = "/", onClose, onNavigate }: { server: string; start?: string; onClose?: () => void; onNavigate?: (path: string) => void }) {
  const [token, setToken] = useState(() => localStorage.getItem(storeKey(server)));
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const forget = () => { localStorage.removeItem(storeKey(server)); setToken(null); };
    configureEndpoint({ base: server, token, onUnauthorized: forget });
    setMemoryRouting(start);
    setReady(true);
  }, [server, token]); // eslint-disable-line react-hooks/exhaustive-deps -- start is where it opens, not a live prop
  setCloseHandler(onClose ?? null);
  return (
    <div className="faplex dark min-h-full">
      {ready && onNavigate && <ReportPath onNavigate={onNavigate} />}
      {!ready ? null : token ? <App key={token} /> : <SignIn server={server} onClose={onClose} onToken={(t) => { localStorage.setItem(storeKey(server), t); setToken(t); }} />}
    </div>
  );
}

function ReportPath({ onNavigate }: { onNavigate: (path: string) => void }) {
  const path = usePath();
  useEffect(() => onNavigate(path), [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function SignIn({ server, onClose, onToken }: { server: string; onClose?: () => void; onToken: (t: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col bg-background pt-[env(safe-area-inset-top)]">
      <header className="flex h-12 items-center gap-2 border-b border-border pl-4 pr-1">
        <span className="font-semibold">faplex</span>
        {onClose && <Button className="ml-auto" variant="ghost" size="icon-lg" aria-label="Back to the map" onClick={onClose}><ChevronDown className="size-5" /></Button>}
      </header>
      <form className="mx-auto flex w-full max-w-sm flex-col gap-3 p-4 pt-8" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const key = String(new FormData(form).get("password") ?? "").trim();
        if (!key) return;
        setBusy(true); setError("");
        try {
          const r = await fetch(apiUrl("/api/embed/login"), { method: "POST", headers: { "content-type": "text/plain" }, body: key });
          if (!r.ok) throw new Error(r.status === 401 ? "That key is wrong" : `Sign-in failed (${r.status})`);
          form.reset();
          onToken(((await r.json()) as { token: string }).token);
        } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
      }}>
        <p className="text-sm text-muted-foreground">Sign in to faplex on {new URL(server).hostname.split(".")[0]} with the web terminal access key.</p>
        <input type="text" name="username" autoComplete="username" defaultValue="faplex" className="sr-only" tabIndex={-1} readOnly />
        <Input name="password" type="password" autoComplete="current-password" placeholder="Access key" className="h-11" />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button type="submit" size="lg" disabled={busy}>{busy ? <Loader className="animate-spin" /> : <KeyRound />} Sign in</Button>
      </form>
    </div>
  );
}
