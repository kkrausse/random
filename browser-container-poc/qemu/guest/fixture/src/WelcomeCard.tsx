import { Sparkles } from "lucide-react";
import mark from "./mark.svg";

export function WelcomeCard() {
  return (
    <main>
      <img src={mark} alt="Workspace mark" />
      <p>Browser-hosted fixture</p>
      <h1>Ready for an agent edit</h1>
      <span><Sparkles size={16} />Vite + React + TypeScript</span>
    </main>
  );
}
