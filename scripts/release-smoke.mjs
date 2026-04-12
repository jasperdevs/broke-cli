import { execFileSync } from "child_process";
import { existsSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
let tarballPath = null;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runNpm(args, options = {}) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    return run(comspec, ["/d", "/s", "/c", "npm.cmd", ...args], options);
  }
  return run("npm", args, options);
}

function quoteCmdArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function runInstalledBinary(binary, args, options = {}) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    const command = [quoteCmdArg(binary), ...args.map(quoteCmdArg)].join(" ");
    return run(comspec, ["/d", "/s", "/c", command], options);
  }
  return run(binary, args, options);
}

function parsePackOutput(stdout) {
  const match = stdout.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
  if (!match) {
    throw new Error(`npm pack did not emit JSON output:\n${stdout}`);
  }
  const payload = JSON.parse(match[1]);
  if (!Array.isArray(payload) || payload.length === 0 || typeof payload[0]?.filename !== "string") {
    throw new Error("npm pack did not return a tarball filename");
  }
  return payload[0].filename;
}

const tempRoot = join(tmpdir(), `brokecli-release-smoke-${process.pid}-${Date.now()}`);

try {
  const packStdout = runNpm(["pack", "--json"]);
  const tarballName = parsePackOutput(packStdout);
  tarballPath = join(ROOT, tarballName);
  const installRoot = join(tempRoot, "install-root");
  runNpm(["install", "--prefix", installRoot, tarballPath]);

  const packageRoot = join(installRoot, "node_modules", "@jasperdevs", "brokecli");
  if (!existsSync(packageRoot)) {
    throw new Error(`Installed package not found at ${packageRoot}`);
  }

  const binShim = join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "brokecli.cmd" : "brokecli");
  if (!existsSync(binShim)) {
    throw new Error(`Installed CLI shim not found at ${binShim}`);
  }

  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf-8"));
  const help = runInstalledBinary(binShim, ["--help"], { cwd: installRoot });
  const version = runInstalledBinary(binShim, ["--version"], { cwd: installRoot }).trim();

  if (!help.includes("Usage: brokecli")) {
    throw new Error("Installed CLI help output did not include expected usage text");
  }
  if (version !== packageJson.version) {
    throw new Error(`Installed CLI version mismatch: expected ${packageJson.version}, got ${version}`);
  }

  process.stdout.write(`release-smoke passed (${tarballName})\n`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  if (tarballPath && existsSync(tarballPath)) rmSync(tarballPath, { force: true });
}
