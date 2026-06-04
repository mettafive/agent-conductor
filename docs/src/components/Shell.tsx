import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Nav } from "./Nav";

const BASE = import.meta.env.BASE_URL;

/** App shell — nav, a crossfading page outlet, footer. One clean transition. */
export function Shell() {
  const location = useLocation();

  // start each page at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: "easeOut" }}
          className="flex-1"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src={`${BASE}conductor.svg`} alt="" className="h-6 w-6 opacity-90" />
            <span className="font-mono text-sm text-mist">agent-conductor</span>
          </div>
          <p className="font-mono text-xs text-mist">MIT © mettafive · built to be conducted</p>
        </div>
      </footer>
    </div>
  );
}
