type ThemeTransitionOptions = {
  nextTheme: "light" | "dark";
  reduceMotion?: boolean;
  updateTheme: (theme: "light" | "dark") => void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
    ready: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function runThemeTransition({
  nextTheme,
  reduceMotion,
  updateTheme,
}: ThemeTransitionOptions) {
  if (typeof document === "undefined") {
    updateTheme(nextTheme);
    return;
  }

  const viewTransitionDocument = document as ViewTransitionDocument;
  if (reduceMotion || prefersReducedMotion() || !viewTransitionDocument.startViewTransition) {
    updateTheme(nextTheme);
    return;
  }

  const root = document.documentElement;
  root.dataset.themeTransition = nextTheme;

  const transition = viewTransitionDocument.startViewTransition(() => {
    updateTheme(nextTheme);
  });

  transition.finished.finally(() => {
    delete root.dataset.themeTransition;
  });
}
