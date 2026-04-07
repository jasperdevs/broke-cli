import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const MAX_FILE_LINES = 500;
const MAX_CYCLOMATIC_COMPLEXITY = 100;
const ROOT = process.cwd();
const SCAN_DIRS = ["src", "bin", "test"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".omx", ".tmp", "coverage"]);

function walkTsFiles(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkTsFiles(fullPath, files);
      continue;
    }
    if (/\.(cts|mts|ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.add(fullPath);
    }
  }
}

function collectRootNames() {
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("tsconfig.json not found");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, ROOT);
  const rootNames = new Set(parsed.fileNames);
  for (const dir of SCAN_DIRS) {
    const fullDir = join(ROOT, dir);
    try {
      if (statSync(fullDir).isDirectory()) walkTsFiles(fullDir, rootNames);
    } catch {}
  }
  return { parsed, rootNames: [...rootNames] };
}

function isPossiblyNullable(type) {
  if (!type) return true;
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) return true;
  if (type.isUnion()) return type.types.some(isPossiblyNullable);
  return !!(type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void));
}

function isDefinitelyNonNullable(checker, node) {
  const type = checker.getTypeAtLocation(node);
  return !isPossiblyNullable(type);
}

function isSimpleNullishTarget(node) {
  if (ts.isIdentifier(node)) return true;
  return ts.isPropertyAccessExpression(node) && ts.isThis(node.expression);
}

function functionName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    return node.name.getText(sourceFile);
  }
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(sourceFile);
  if (parent && ts.isBinaryExpression(parent)) return parent.left.getText(sourceFile);
  return "<anonymous>";
}

function computeCyclomaticComplexity(root) {
  let complexity = 1;
  const visit = (node) => {
    if (node !== root && ts.isFunctionLike(node)) return;
    if (
      ts.isIfStatement(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isCatchClause(node)
      || ts.isConditionalExpression(node)
    ) {
      complexity += 1;
    }
    if (ts.isCaseClause(node)) complexity += 1;
    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        complexity += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return complexity;
}

function formatIssue(issue) {
  const rel = relative(ROOT, issue.file).replace(/\\/g, "/");
  return `${rel}:${issue.line}${issue.col ? `:${issue.col}` : ""} ${issue.message}`;
}

function main() {
  const { parsed, rootNames } = collectRootNames();
  const program = ts.createProgram({
    rootNames,
    options: {
      ...parsed.options,
      noEmit: true,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();
  const issues = [];

  for (const sourceFile of program.getSourceFiles()) {
    const normalized = sourceFile.fileName.replace(/\\/g, "/");
    if (normalized.includes("/node_modules/")) continue;
    if (sourceFile.isDeclarationFile) continue;
    if (!SCAN_DIRS.some((dir) => normalized.includes(`/${dir}/`) || normalized.endsWith(`/${dir}`))) continue;

    const content = readFileSync(sourceFile.fileName, "utf-8");
    const lineCount = content.split(/\r?\n/).length;
    if (lineCount > MAX_FILE_LINES) {
      issues.push({
        file: sourceFile.fileName,
        line: 1,
        message: `file has ${lineCount} lines (max ${MAX_FILE_LINES})`,
      });
    }

    const visit = (node) => {
      if (ts.isFunctionLike(node) && node.body) {
        const complexity = computeCyclomaticComplexity(node.body);
        if (complexity > MAX_CYCLOMATIC_COMPLEXITY) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          issues.push({
            file: sourceFile.fileName,
            line: pos.line + 1,
            col: pos.character + 1,
            message: `cyclomatic complexity ${complexity} exceeds ${MAX_CYCLOMATIC_COMPLEXITY} in ${functionName(node, sourceFile)}`,
          });
        }
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        if (isSimpleNullishTarget(node.left) && isDefinitelyNonNullable(checker, node.left)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(node.operatorToken.getStart(sourceFile));
          issues.push({
            file: sourceFile.fileName,
            line: pos.line + 1,
            col: pos.character + 1,
            message: "pointless ?? on a definitely non-nullable value",
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  if (issues.length > 0) {
    process.stderr.write("quality-check failed\n");
    for (const issue of issues.sort((a, b) => formatIssue(a).localeCompare(formatIssue(b)))) {
      process.stderr.write(`${formatIssue(issue)}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("quality-check passed\n");
}

main();
