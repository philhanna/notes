import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
