import { describe, expect, it } from "vitest";

import { renderMarkdownToHtml } from "./render-markdown";

describe("renderMarkdownToHtml", () => {
  it("escapes image attributes so quotes cannot create event handlers", () => {
    const html = renderMarkdownToHtml(
      `![avatar" onerror="alert(1)' onload='alert(2)](https://example.com/avatar.png)`,
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.getAttributeNames()).toEqual(["src", "alt", "style"]);
    expect(image?.getAttribute("alt")).toBe(
      `avatar" onerror="alert(1)' onload='alert(2)`,
    );
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    expect(html).not.toContain(`alt="avatar" onerror="`);
  });

  it("escapes accepted HTTP image sources so quotes cannot create event handlers", () => {
    const source = `https://example.com/chart.png" onload="alert`;
    const html = renderMarkdownToHtml(`![chart](${source})`);
    const container = document.createElement("div");
    container.innerHTML = html;
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.getAttributeNames()).toEqual(["src", "alt", "style"]);
    expect(image?.getAttribute("src")).toBe(source);
    expect(html).toContain(
      `src="https://example.com/chart.png&quot; onload=&quot;alert"`,
    );
  });

  it("keeps strong markers in image alt text inside the attribute", () => {
    const html = renderMarkdownToHtml(
      "![**quarterly chart**](https://example.com/chart.png)",
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    const image = container.querySelector("img");

    expect(image?.getAttribute("alt")).toBe("**quarterly chart**");
    expect(image?.querySelector("strong")).toBeNull();
  });

  it.each([
    "javascript:alert%281%29",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+",
  ])("rejects active image source %s", (source) => {
    const html = renderMarkdownToHtml(`![unsafe](${source})`);
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector("img")).toBeNull();
    expect(html).not.toContain(source);
  });

  it.each([
    "http://example.com/image.png",
    "https://example.com/image.jpeg?size=large&theme=light",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/2Q==",
    "data:image/jpg;base64,/9j/2Q==",
    "data:image/gif;base64,R0lGODlhAQ==",
    "data:image/webp;base64,UklGRg==",
  ])("retains safe image source %s", (source) => {
    const html = renderMarkdownToHtml(`![safe image](${source})`);
    const container = document.createElement("div");
    container.innerHTML = html;
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(source);
    expect(image?.getAttribute("alt")).toBe("safe image");
  });

  it("preserves headings, lists, tables, strong text, and safe images", () => {
    const markdown = [
      "# Report **summary**",
      "",
      "- Alpha",
      "- **Beta**",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| Revenue | **100** |",
      "",
      "![chart](https://example.com/chart.png)",
    ].join("\n");

    expect(renderMarkdownToHtml(markdown)).toBe(
      [
        "<h1>Report <strong>summary</strong></h1>",
        "<ul><li>Alpha</li><li><strong>Beta</strong></li></ul>",
        "<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Revenue</td><td><strong>100</strong></td></tr></tbody></table>",
        '<p><img src="https://example.com/chart.png" alt="chart" style="max-width:100%" /></p>',
      ].join("\n"),
    );
  });

  it("renders blockquotes, ordered lists, and unmatched strong markers", () => {
    const markdown = [
      "> first line",
      "> second **line**",
      "",
      "1. one",
      "2. two",
      "",
      "unfinished **marker",
    ].join("\n");

    expect(renderMarkdownToHtml(markdown)).toBe(
      [
        "<blockquote>first line<br/>second <strong>line</strong></blockquote>",
        "<ol><li>one</li><li>two</li></ol>",
        "<p>unfinished **marker</p>",
      ].join("\n"),
    );
  });

  it("rejects malformed raster data URLs", () => {
    expect(renderMarkdownToHtml("![bad](data:image/png;base64,abc)")).toBe(
      "<p></p>",
    );
  });

  it("preserves strong emphasis across an inline image", () => {
    expect(
      renderMarkdownToHtml(
        "**before ![chart](https://example.com/chart.png) after**",
      ),
    ).toBe(
      '<p><strong>before <img src="https://example.com/chart.png" alt="chart" style="max-width:100%" /> after</strong></p>',
    );
  });

  it("escapes placeholder-like text and raw HTML as text", () => {
    const html = renderMarkdownToHtml(
      '@@MARKDOWN_IMAGE_0@@ <img src="x" onerror="alert(1)">',
    );

    expect(html).toBe(
      '<p>@@MARKDOWN_IMAGE_0@@ &lt;img src="x" onerror="alert(1)"&gt;</p>',
    );
  });
});
