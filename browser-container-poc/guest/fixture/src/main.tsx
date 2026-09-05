import { createRoot } from "react-dom/client";
import "./styles.css";
import { WelcomeCard } from "./WelcomeCard";

createRoot(document.getElementById("root")!).render(<WelcomeCard />);
