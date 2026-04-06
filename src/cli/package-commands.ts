import type { Command } from "commander";
import {
  describePackageResources,
  getPackageConfigPaths,
  guessPackageLabel,
  installPackage,
  listInstalledPackages,
  listPackageSources,
  removePackage,
  resolvePackageRoots,
  setPackageResourceConfig,
  updatePackages,
} from "../core/package-manager.js";

function renderConfigOverview(): string {
  const lines: string[] = [];
  for (const pkg of resolvePackageRoots()) {
    const source = typeof pkg.source === "string" ? pkg.source : pkg.source.source;
    const resources = describePackageResources(pkg.root);
    lines.push(`${guessPackageLabel(source)} (${pkg.scope})`);
    lines.push(`  source: ${source}`);
    lines.push(`  root:   ${pkg.root}`);
    lines.push(`  ext:    ${resources.extensions.length > 0 ? resources.extensions.join(", ") : "-"}`);
    lines.push(`  skills: ${resources.skills.length > 0 ? resources.skills.join(", ") : "-"}`);
    lines.push(`  prompts:${resources.prompts.length > 0 ? ` ${resources.prompts.join(", ")}` : " -"}`);
    lines.push(`  themes: ${resources.themes.length > 0 ? resources.themes.join(", ") : "-"}`);
    lines.push("");
  }
  return lines.length > 0 ? lines.join("\n").trimEnd() : "No installed packages.";
}

export function registerPackageCommands(program: Command): void {
  program
    .command("install")
    .argument("<source>")
    .option("-l, --local", "install into project settings")
    .description("Install a package source")
    .action(async (source: string, opts: { local?: boolean }) => {
      await installPackage(source, { local: !!opts.local });
      process.stdout.write(`Installed ${source}${opts.local ? " (project)" : ""}\n`);
    });

  program
    .command("remove")
    .argument("<source>")
    .option("-l, --local", "remove from project settings")
    .description("Remove a package source")
    .action(async (source: string, opts: { local?: boolean }) => {
      await removePackage(source, { local: !!opts.local });
      process.stdout.write(`Removed ${source}${opts.local ? " (project)" : ""}\n`);
    });

  program
    .command("uninstall")
    .argument("<source>")
    .option("-l, --local", "remove from project settings")
    .description("Alias for remove")
    .action(async (source: string, opts: { local?: boolean }) => {
      await removePackage(source, { local: !!opts.local });
      process.stdout.write(`Removed ${source}${opts.local ? " (project)" : ""}\n`);
    });

  program
    .command("list")
    .description("List configured packages")
    .action(() => {
      const packages = listInstalledPackages();
      if (packages.length === 0) {
        process.stdout.write("No packages installed.\n");
        return;
      }
      for (const entry of packages) {
        process.stdout.write(`${entry.scope}\t${entry.installed ? "installed" : "missing"}\t${entry.source}\t${entry.root}\n`);
      }
    });

  program
    .command("update")
    .argument("[source]")
    .description("Update unpinned installed packages")
    .action(async (source?: string) => {
      await updatePackages(source);
      process.stdout.write(source ? `Updated ${source}\n` : "Updated packages\n");
    });

  program
    .command("config")
    .argument("[source]")
    .option("-l, --local", "edit project package settings")
    .option("--type <type>", "resource type: extensions, skills, prompts, themes")
    .option("--patterns <patterns>", "comma-separated filter patterns")
    .description("Inspect or configure package resources")
    .action((source: string | undefined, opts: { local?: boolean; type?: string; patterns?: string }) => {
      if (!source || !opts.type || !opts.patterns) {
        const paths = getPackageConfigPaths();
        process.stdout.write(`${renderConfigOverview()}\n\nconfig files:\n  global: ${paths.global}\n  project: ${paths.project}\n`);
        return;
      }
      if (!["extensions", "skills", "prompts", "themes"].includes(opts.type)) {
        throw new Error("type must be extensions, skills, prompts, or themes");
      }
      const patterns = opts.patterns.split(",").map((entry) => entry.trim()).filter(Boolean);
      setPackageResourceConfig(source, opts.type as "extensions" | "skills" | "prompts" | "themes", patterns, opts.local ? "project" : "global");
      process.stdout.write(`Updated ${opts.type} filters for ${source}\n`);
    });
}

export function describeConfiguredPackageSources(): string[] {
  return listPackageSources().map((entry) => `${entry.scope}:${typeof entry.source === "string" ? entry.source : entry.source.source}`);
}
