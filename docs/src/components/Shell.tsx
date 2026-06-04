import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Nav } from "./Nav";
import { FooterNav } from "./FooterNav";

/** App shell — nav, a crossfading page outlet, footer. One clean transition. */
export function Shell() {
  const location = useLocation();

  // start each page at the top
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const active = location.pathname.split("/")[1] || undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <Nav active={active} />
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
          className="flex flex-1 flex-col"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <FooterNav />
    </div>
  );
}
