import stripAnsi from "strip-ansi";

export function renderHomeBox(options: {
  width: number;
  title: string;
  body: string[];
  box: { tl: string; tr: string; bl: string; br: string; h: string; v: string };
  frameColor: string;
  reset: string;
  padLine: (line: string, width: number) => string;
}): string[] {
  const { width, title, body, box, frameColor, reset, padLine } = options;
  const innerWidth = Math.max(1, width - 2);
  const titleText = title ? ` ${title} ` : "";
  const titleFill = Math.max(0, innerWidth - stripAnsi(titleText).length);
  const lines = [`${frameColor}${box.tl}${titleText}${box.h.repeat(titleFill)}${box.tr}${reset}`];
  for (const row of body) {
    lines.push(`${frameColor}${box.v}${reset}${padLine(row, innerWidth)}${frameColor}${box.v}${reset}`);
  }
  lines.push(`${frameColor}${box.bl}${box.h.repeat(innerWidth)}${box.br}${reset}`);
  return lines;
}

export function renderHomeView(options: {
  mainW: number;
  topHeight: number;
  fullMascot: string[];
  modelLabel: string;
  appVersion: string;
  homeTip: string;
  formatShortCwd: (maxWidth: number) => string;
  wrapHomeDetail: (label: string, value: string, width: number) => string[];
  renderHomeBox: (width: number, title: string, body: string[]) => string[];
  titleColor: string;
  textColor: string;
  bold: string;
  reset: string;
}): string[] {
  const { mainW, topHeight, fullMascot, modelLabel, appVersion, homeTip, formatShortCwd, wrapHomeDetail, renderHomeBox: buildHomeBox, titleColor, textColor, bold, reset } = options;
  if (topHeight < 8 || mainW < 24) {
    return Array.from({ length: Math.max(0, topHeight) }, () => "");
  }
  const versionText = `v${appVersion}`;
  const boxWidth = Math.max(12, mainW);
  const innerWidth = Math.max(1, boxWidth - 2);
  const contentWidth = Math.max(8, innerWidth - 4);
  const fullMascotWidth = stripAnsi(fullMascot[0] ?? "").length;
  const canShowMascot = fullMascot.length > 0 && contentWidth >= fullMascotWidth + 24 && topHeight >= 8;
  const mascotInline = canShowMascot ? fullMascot : [];
  const mascotWidth = stripAnsi(mascotInline[0] ?? "").length;
  const gap = mascotWidth > 0 ? 2 : 0;
  const headerCandidates = ["Welcome to BrokeCLI", "Welcome"];
  const headerText = headerCandidates.find((candidate) => mascotWidth + gap + candidate.length <= contentWidth) ?? headerCandidates[headerCandidates.length - 1];
  const rightWidth = mascotWidth > 0 ? Math.max(18, contentWidth - mascotWidth - gap) : contentWidth;
  const locationBase = formatShortCwd(Math.max(10, rightWidth - 1));
  const titleWithVersion = `${headerText}  ${versionText}`;
  const titleText = titleWithVersion.length <= rightWidth ? titleWithVersion : headerText;
  const locationText = titleWithVersion.length <= rightWidth ? locationBase : `${locationBase}  ${versionText}`;
  const heroText = [
    `${titleColor}${bold}${titleText}${reset}`,
    `${textColor}${locationText}${reset}`,
    "",
    ...wrapHomeDetail("Model", modelLabel, rightWidth),
    ...wrapHomeDetail("Tip", homeTip, rightWidth),
  ];
  const heroHeight = Math.max(mascotInline.length, heroText.length);
  const heroLines = Array.from({ length: heroHeight }, (_, index) => {
    const sprite = mascotInline[index] ?? " ".repeat(mascotWidth);
    const text = heroText[index] ?? "";
    return text ? `${sprite}${" ".repeat(gap)}${text}` : sprite;
  });
  const body = [" ", ...heroLines].map((line) => `  ${line}`);
  const clippedBody = body.slice(0, Math.max(7, topHeight - 2));
  const box = buildHomeBox(boxWidth, "", clippedBody);
  const lines: string[] = [...box.slice(0, topHeight)];
  while (lines.length < topHeight) lines.push("");
  return lines;
}
