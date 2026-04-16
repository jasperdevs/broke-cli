import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";

export interface FileStatLike {
  isDirectory(): boolean;
  size: number;
  mtimeMs: number;
}

export interface ReadOperations {
  readFile(path: string): Buffer | string;
  stat(path: string): FileStatLike;
}

export interface WriteOperations {
  mkdir(path: string): void;
  writeFile(path: string, content: string): void;
}

export interface EditOperations extends ReadOperations, WriteOperations {}

export interface ListOperations {
  readdir(path: string): string[];
  stat(path: string): FileStatLike;
}

export interface SearchOperations extends ListOperations {
  readFile(path: string): Buffer | string;
}

export const localFileOperations: ReadOperations & WriteOperations & EditOperations & ListOperations & SearchOperations = {
  readFile: (path) => readFileSync(path),
  stat: (path) => statSync(path),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  writeFile: (path, content) => writeFileSync(path, content, "utf-8"),
  readdir: (path) => readdirSync(path),
};
