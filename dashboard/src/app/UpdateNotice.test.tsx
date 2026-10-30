import { describe, expect, it } from "vitest";
import { buildIn } from "./UpdateNotice";

describe("UpdateNotice", () => {
  it("reads the main script from a fresh index.html", () => {
    const html = '<script type="module" crossorigin src="/assets/index-CsduILao.js"></script><link href="/assets/index-BKEUutzA.css">';
    expect(buildIn(html)).toBe("/assets/index-CsduILao.js");
    expect(buildIn("<html></html>")).toBe("");
  });
});
