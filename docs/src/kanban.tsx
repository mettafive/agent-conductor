import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BoardGuide } from "./pages/BoardGuide";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BoardGuide />
  </StrictMode>,
);
