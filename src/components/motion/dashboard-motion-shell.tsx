"use client";

import { motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";

export function DashboardMotionShell({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (prefersReducedMotion || !scopeRef.current) {
      return;
    }

    const scope = scopeRef.current;
    const panels = Array.from(
      scope.querySelectorAll<HTMLElement>(
        "[data-page-section], [data-dashboard-card], [data-dashboard-panel], [data-dashboard-row], [data-surface='card']",
      ),
    );

    if (!panels.length) {
      return;
    }

    const uniquePanels = panels.filter((panel, index) => panels.indexOf(panel) === index);

    const context = gsap.context(() => {
      gsap.set(uniquePanels, {
        autoAlpha: 0,
        y: 22,
        scale: 0.985,
      });

      gsap.to(uniquePanels, {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: 0.58,
        ease: "power3.out",
        stagger: 0.06,
        clearProps: "opacity,visibility,transform",
      });

      const floats = scope.querySelectorAll<HTMLElement>("[data-dashboard-float='soft']");
      if (floats.length) {
        gsap.to(floats, {
          y: -5,
          duration: 2.8,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          stagger: 0.16,
        });
      }
    }, scope);

    return () => context.revert();
  }, [pathname, prefersReducedMotion]);

  return (
    <motion.div
      animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
      /* No min-height/grow here: the page must end where its content ends, so
         anything rendered after it (task monitor) sits right below the content
         instead of being pushed under a viewport-tall spacer. */
      initial={prefersReducedMotion ? undefined : { opacity: 0, y: 18 }}
      key={pathname}
      ref={scopeRef}
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
