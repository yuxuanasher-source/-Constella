// 纯函数 Markdown → HTML 渲染（标题/表格/列表/引用/加粗/图片/段落）。
// 服务端分享页与客户端导出（PDF / Word）共用，保证呈现一致。

function escapeTextHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeTextHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const RASTER_BASE64_DATA_URL =
  /^data:image\/(?:png|jpe?g|gif|webp);base64,([a-z0-9+/]+={0,2})$/i;

function isSafeImageSource(value: string): boolean {
  const source = value.trim();
  const dataUrl = source.match(RASTER_BASE64_DATA_URL);
  if (dataUrl) {
    return dataUrl[1].length % 4 === 0;
  }

  try {
    const protocol = new URL(source).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

type InlineToken =
  | { type: "text"; value: string }
  | { type: "image"; alt: string; source: string }
  | { type: "strong-marker" };

function appendTextTokens(tokens: InlineToken[], value: string): void {
  for (const part of value.split(/(\*\*)/)) {
    if (!part) continue;
    tokens.push(
      part === "**" ? { type: "strong-marker" } : { type: "text", value: part },
    );
  }
}

function tokenizeInlineMarkdown(value: string): InlineToken[] {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const tokens: InlineToken[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = imagePattern.exec(value)) !== null) {
    appendTextTokens(tokens, value.slice(cursor, match.index));
    tokens.push({ type: "image", alt: match[1], source: match[2].trim() });
    cursor = imagePattern.lastIndex;
  }

  appendTextTokens(tokens, value.slice(cursor));
  return tokens;
}

function renderInlineToken(token: InlineToken): string {
  if (token.type === "text") return escapeTextHtml(token.value);
  if (token.type === "strong-marker") return "**";
  if (!isSafeImageSource(token.source)) return "";
  return `<img src="${escapeHtmlAttribute(token.source)}" alt="${escapeHtmlAttribute(token.alt)}" style="max-width:100%" />`;
}

function findClosingStrongMarker(
  tokens: InlineToken[],
  openingIndex: number,
): number {
  let hasContent = false;
  for (let i = openingIndex + 1; i < tokens.length; i += 1) {
    if (tokens[i].type === "strong-marker") {
      if (hasContent) return i;
      hasContent = true;
    } else {
      hasContent = true;
    }
  }
  return -1;
}

function inlineMarkdown(value: string): string {
  const tokens = tokenizeInlineMarkdown(value);
  let html = "";
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type !== "strong-marker") {
      html += renderInlineToken(token);
      i += 1;
      continue;
    }

    const closingIndex = findClosingStrongMarker(tokens, i);
    if (closingIndex === -1) {
      html += renderInlineToken(token);
      i += 1;
      continue;
    }

    html += "<strong>";
    for (
      let contentIndex = i + 1;
      contentIndex < closingIndex;
      contentIndex += 1
    ) {
      html += renderInlineToken(tokens[contentIndex]);
    }
    html += "</strong>";
    i = closingIndex + 1;
  }

  return html;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function renderMarkdownToHtml(markdown: string): string {
  const lines = String(markdown || "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const nextIsSep =
      i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]);
    if (isTableRow && nextIsSep) {
      const header = splitRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        body.push(splitRow(lines[i]));
        i += 1;
      }
      const head = header.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("");
      const rows = body
        .map(
          (r) =>
            `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`,
        )
        .join("");
      out.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 6);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(inlineMarkdown(lines[i].replace(/^\s*>\s?/, "")));
        i += 1;
      }
      out.push(`<blockquote>${buf.join("<br/>")}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(
          `<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`,
        );
        i += 1;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(
          `<li>${inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`,
        );
        i += 1;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    out.push(`<p>${inlineMarkdown(line)}</p>`);
    i += 1;
  }
  return out.join("\n");
}

// 文档/打印的整页样式，分享页与导出共用。
export const MARKDOWN_DOC_CSS = `
  body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2733; line-height: 1.7; max-width: 820px; margin: 0 auto; padding: 40px 32px; }
  h1 { font-size: 26px; margin: 0 0 18px; }
  h2 { font-size: 20px; margin: 22px 0 12px; }
  h3 { font-size: 16px; margin: 18px 0 8px; }
  h4 { font-size: 14px; margin: 14px 0 6px; }
  p { margin: 8px 0; }
  ul, ol { margin: 8px 0 8px 22px; }
  li { margin: 3px 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; background: #f5f7fb; border-left: 3px solid #1e50c8; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #d8dee9; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #f5f7fb; font-weight: 600; }
  img { max-width: 100%; border-radius: 6px; }
  strong { color: #0f172a; }
`;
