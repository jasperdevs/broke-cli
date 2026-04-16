import { execFileSync } from "child_process";

try {
  execFileSync("git", ["diff", "--quiet", "--", "src/ai/model-catalog.generated.json"], { stdio: "inherit" });
} catch {
  console.error("Generated model catalog is stale. Run npm run generate-models and commit src/ai/model-catalog.generated.json.");
  process.exit(1);
}
