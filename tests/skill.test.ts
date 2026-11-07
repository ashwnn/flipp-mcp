import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { SKILL_FILES } from "../src/skills.inline.js";

describe("flipp-deals skill", () => {
  it("inline copy matches skills/ on disk", async () => {
    const md = await readFile("skills/flipp-deals/SKILL.md", "utf8");
    expect(SKILL_FILES["flipp-deals/SKILL.md"]).toBe(md);
  });

  it("frontmatter has name + description", () => {
    const md = SKILL_FILES["flipp-deals/SKILL.md"] ?? "";
    const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    expect(m?.[1]).toMatch(/name:\s*flipp-deals/);
    expect(m?.[1]).toMatch(/description:\s*\S/);
  });
});
