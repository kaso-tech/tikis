import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("styles sans ombre dépréciée", () => {
  it("n’utilise aucune propriété shadow dans le code applicatif", () => {
    const violations = ["app", "components", "lib"].flatMap((directory) =>
      sourceFiles(join(process.cwd(), directory)).filter((path) =>
        /shadow(?:Color|Offset|Opacity|Radius)\s*:/.test(readFileSync(path, "utf8")),
      ),
    );

    expect(violations).toEqual([]);
  });
});
