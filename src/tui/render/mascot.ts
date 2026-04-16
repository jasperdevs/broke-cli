import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export function resolveMascotPath(cwd: string, appDir: string): string | null {
  const svgCandidates = [
    join(cwd, "logos", "brokecli-face.svg"),
    join(appDir, "..", "..", "logos", "brokecli-face.svg"),
    join(cwd, "logos", "brokecli-square.svg"),
    join(appDir, "..", "..", "logos", "brokecli-square.svg"),
  ];
  return svgCandidates.find((candidate) => existsSync(candidate)) ?? null;
}

function parseSvgColor(fill: string | undefined, opacity: string | undefined): RgbColor | null {
  if (!fill || fill === "none") return null;
  const match = fill.match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const alpha = opacity ? Math.max(0, Math.min(1, Number(opacity))) : 1;
  if (alpha <= 0) return null;
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16),
    a: alpha,
  };
}

export function parseMascotSvgGrid(path: string): Array<Array<RgbColor | null>> {
  try {
    const svg = readFileSync(path, "utf-8");
    const viewBoxMatch = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/i);
    const widthAttrMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/i);
    const heightAttrMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)"/i);
    const spriteWidth = Math.max(1, Math.round(Number(viewBoxMatch?.[1] ?? widthAttrMatch?.[1] ?? "20")));
    const spriteHeight = Math.max(1, Math.round(Number(viewBoxMatch?.[2] ?? heightAttrMatch?.[1] ?? "20")));
    const cells: Array<Array<RgbColor | null>> = Array.from(
      { length: spriteHeight },
      () => Array.from({ length: spriteWidth }, () => null),
    );
    const rects = [...svg.matchAll(/<rect\s+([^>]+?)\s*\/?>/g)];
    for (const rect of rects) {
      const attrs = Object.fromEntries(
        [...rect[1].matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
      ) as Record<string, string>;
      const color = parseSvgColor(attrs.fill, attrs.opacity);
      if (!color) continue;
      const x = Number(attrs.x ?? "0");
      const y = Number(attrs.y ?? "0");
      const width = Number(attrs.width ?? "0");
      const height = Number(attrs.height ?? "0");
      for (let row = y; row < y + height; row++) {
        for (let col = x; col < x + width; col++) {
          if (row >= 0 && row < spriteHeight && col >= 0 && col < spriteWidth) cells[row][col] = color;
        }
      }
    }
    return cells;
  } catch {
    return [];
  }
}

export function renderAnsiColorGrid(grid: Array<Array<RgbColor | null>>, reset: string): string[] {
  const lines: string[] = [];
  const fg = (color: RgbColor): string => `\x1b[38;2;${color.r};${color.g};${color.b}m`;
  for (let row = 0; row < grid.length; row += 2) {
    let line = "";
    for (let col = 0; col < (grid[row]?.length ?? 0); col++) {
      const top = grid[row][col];
      const bottom = grid[row + 1]?.[col] ?? null;
      if (top && bottom) {
        if (top.r === bottom.r && top.g === bottom.g && top.b === bottom.b) {
          line += `${fg(top)}█${reset}`;
        } else {
          line += `${fg(top)}▀${reset}`;
        }
      } else if (top) {
        line += `${fg(top)}▀${reset}`;
      } else if (bottom) {
        line += `${fg(bottom)}▄${reset}`;
      } else {
        line += " ";
      }
    }
    lines.push(line);
  }
  return lines;
}
