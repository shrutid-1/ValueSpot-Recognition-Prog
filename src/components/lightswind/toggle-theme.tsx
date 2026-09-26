import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  ToggleTheme — a light/dark switch that animates the whole page.

  It owns exactly one thing: the `dark` class on <html>. It reads it on mount,
  flips it on click, and follows it if anything else changes it (a second
  toggle elsewhere on the page stays in step). Remembering the choice is the
  host app's business; see useThemeScope in lib/theme.ts.

  The animation is the View Transition API: the browser snapshots the page,
  the class flips, and the old and new snapshots are animated against each
  other with the keyframes below. Where the API is missing, or the viewer has
  asked for reduced motion, the theme simply switches.
*/

export type AnimationType =
  | "none"
  | "circle-spread"
  | "round-morph"
  | "swipe-left"
  | "swipe-up"
  | "diag-down-right"
  | "fade-in-out"
  | "shrink-grow"
  | "flip-x-in"
  | "split-vertical"
  | "swipe-right"
  | "swipe-down"
  | "wave-ripple";

export interface ToggleThemeProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children"> {
  /** Length of the page transition, in milliseconds. */
  duration?: number;
  /** Which full-page transition to run. */
  animationType?: AnimationType;
}

/* lib.dom in this TypeScript version predates the API; declare what is used. */
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

const STYLE_ID = "lw-toggle-theme-transition";

/** The keyframes for one run, positioned on the button that was pressed. */
function transitionCss(type: AnimationType, ms: number, x: number, y: number, r: number): string {
  const d = `${ms}ms`;
  const ease = "cubic-bezier(0.4, 0, 0.2, 1)";
  const reset =
    "::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal;}";
  const reveal = (from: string, to: string, curve = ease) =>
    `${reset}::view-transition-new(root){animation:lw-tt-reveal ${d} ${curve} both;}` +
    `@keyframes lw-tt-reveal{from{clip-path:${from};}to{clip-path:${to};}}`;
  const circleFrom = `circle(0px at ${x}px ${y}px)`;
  const circleTo = `circle(${r}px at ${x}px ${y}px)`;

  switch (type) {
    case "fade-in-out":
      return (
        `${reset}` +
        `::view-transition-old(root){animation:lw-tt-fade-out ${d} ${ease} both;}` +
        `::view-transition-new(root){animation:lw-tt-fade-in ${d} ${ease} both;}` +
        "@keyframes lw-tt-fade-out{from{opacity:1;}to{opacity:0;}}" +
        "@keyframes lw-tt-fade-in{from{opacity:0;}to{opacity:1;}}"
      );
    case "circle-spread":
      return reveal(circleFrom, circleTo);
    case "wave-ripple":
      return (
        reveal(circleFrom, circleTo, "cubic-bezier(0.34, 1.2, 0.64, 1)") +
        `::view-transition-old(root){animation:lw-tt-settle ${d} ${ease} both;}` +
        "@keyframes lw-tt-settle{to{transform:scale(0.985);}}"
      );
    case "round-morph":
      return (
        `${reset}::view-transition-new(root){animation:lw-tt-morph ${d} ${ease} both;}` +
        "@keyframes lw-tt-morph{from{clip-path:inset(35% round 50%);opacity:0;}" +
        "to{clip-path:inset(0 round 0);opacity:1;}}"
      );
    case "swipe-left":
      return reveal("inset(0 0 0 100%)", "inset(0 0 0 0)");
    case "swipe-right":
      return reveal("inset(0 100% 0 0)", "inset(0 0 0 0)");
    case "swipe-up":
      return reveal("inset(100% 0 0 0)", "inset(0 0 0 0)");
    case "swipe-down":
      return reveal("inset(0 0 100% 0)", "inset(0 0 0 0)");
    case "split-vertical":
      return reveal("inset(0 50% 0 50%)", "inset(0 0 0 0)");
    case "diag-down-right":
      return reveal("polygon(0 0, 0 0, 0 0)", "polygon(0 0, 200% 0, 0 200%)");
    case "shrink-grow":
      return (
        `${reset}` +
        `::view-transition-old(root){animation:lw-tt-shrink ${d} ${ease} both;}` +
        `::view-transition-new(root){animation:lw-tt-grow ${d} ${ease} both;}` +
        "@keyframes lw-tt-shrink{to{transform:scale(0.92);opacity:0;}}" +
        "@keyframes lw-tt-grow{from{transform:scale(1.08);opacity:0;}}"
      );
    case "flip-x-in":
      return (
        `${reset}` +
        `::view-transition-old(root){animation:lw-tt-fade-out ${d} ${ease} both;}` +
        `::view-transition-new(root){transform-origin:50% 0;animation:lw-tt-flip ${d} ${ease} both;}` +
        "@keyframes lw-tt-fade-out{to{opacity:0;}}" +
        "@keyframes lw-tt-flip{from{transform:perspective(1400px) rotateX(-70deg);opacity:0;}}"
      );
    case "none":
    default:
      return "";
  }
}

const readDark = () =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark");

export const ToggleTheme: React.FC<ToggleThemeProps> = ({
  duration = 400,
  animationType = "circle-spread",
  className,
  ...buttonProps
}) => {
  const [isDark, setIsDark] = useState(readDark);
  const ref = useRef<HTMLButtonElement>(null);

  // Follow the class, whoever changes it.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    const next = !readDark();
    const apply = () => {
      document.documentElement.classList.toggle("dark", next);
      setIsDark(next);
    };

    const doc = document as ViewTransitionDocument;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (animationType === "none" || !doc.startViewTransition || reduceMotion) {
      apply();
      return;
    }

    const rect = ref.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : 0;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = transitionCss(animationType, duration, x, y, r);
    document.head.appendChild(style);

    // flushSync: the new snapshot is taken when this callback returns, so the
    // icon has to have re-rendered by then or it would swap after the fade.
    const transition = doc.startViewTransition(() => flushSync(apply));
    transition.finished.finally(() => style.remove());
  }, [animationType, duration]);

  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      {...buttonProps}
      onClick={toggle}
      className={cn("relative inline-flex items-center justify-center overflow-hidden", className)}
    >
      <Sun
        aria-hidden="true"
        size={18}
        strokeWidth={1.9}
        className="absolute motion-safe:transition-all motion-safe:duration-300"
        style={{
          opacity: isDark ? 1 : 0,
          transform: isDark ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.5)",
        }}
      />
      <Moon
        aria-hidden="true"
        size={18}
        strokeWidth={1.9}
        className="absolute motion-safe:transition-all motion-safe:duration-300"
        style={{
          opacity: isDark ? 0 : 1,
          transform: isDark ? "rotate(90deg) scale(0.5)" : "rotate(0deg) scale(1)",
        }}
      />
    </button>
  );
};

export default ToggleTheme;
