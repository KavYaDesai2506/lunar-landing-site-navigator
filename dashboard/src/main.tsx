import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { apiHealth } from "./lib/data";
import "./styles.css";
import "./pass4.css";

// Wake the hosted engine as soon as anyone opens the dashboard, so custom coordinates
// are warm by the time they are used. Fire-and-forget; curated sites never need it.
apiHealth().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
