import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { Shell } from "./components/Shell";
import { Home } from "./pages/Home";
import { BoardPage } from "./pages/BoardPage";
import { SpecPage } from "./pages/SpecPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";
import { ExamplesPage } from "./pages/ExamplesPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Home />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/spec" element={<SpecPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
);
