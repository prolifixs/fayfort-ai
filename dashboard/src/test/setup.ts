import "@testing-library/jest-dom/vitest";
// jsdom has no matchMedia: answer width queries from the window size (1024px wide, so the desktop layout).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (!min || window.innerWidth >= Number(min[1])) && (!max || window.innerWidth <= Number(max[1]));
    return {
      matches, media: query, onchange: null,
      addEventListener: () => undefined, removeEventListener: () => undefined,
      addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
    } as MediaQueryList;
  };
}
