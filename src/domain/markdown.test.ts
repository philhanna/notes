import { describe, expect, it } from "vitest";
import { renderBlock, renderInline } from "./markdown.ts";

describe("renderInline", () => {
  it("preserves emphasis, strikethrough, and inline code", () => {
    const result = renderInline("**bold** *italic* ~~strike~~ `code`");
    expect(result.html).toBe(
      "<strong>bold</strong> <em>italic</em> <s>strike</s> <code>code</code>",
    );
    expect(result.plainText).toBe("bold italic strike code");
  });

  it("strips heading markers and renders heading text as bold", () => {
    const result = renderInline("# Heading text");
    expect(result.html).toBe("<strong>Heading text</strong>");
    expect(result.plainText).toBe("Heading text");
  });

  it("collapses paragraph breaks and line breaks to a single space", () => {
    const result = renderInline("first line\nsecond line\n\nthird paragraph");
    expect(result.plainText).toBe("first line second line third paragraph");
  });

  it("flattens list items joined by a middle dot", () => {
    const result = renderInline("- item one\n- item two");
    expect(result.plainText).toBe("item one · item two");
  });

  it("strips blockquote markers, leaving quoted text inline", () => {
    const result = renderInline("> quoted text");
    expect(result.plainText).toBe("quoted text");
  });

  it("shows the first line of a code block with an ellipsis when truncated", () => {
    const result = renderInline("```\nline one\nline two\n```");
    expect(result.plainText).toBe("line one…");
    expect(result.html).toBe("<code>line one…</code>");
  });

  it("shows a single-line code block without an ellipsis", () => {
    const result = renderInline("```\nonly line\n```");
    expect(result.plainText).toBe("only line");
  });

  it("replaces images with their alt text", () => {
    const result = renderInline("![a photo](http://example.com/x.png)");
    expect(result.plainText).toBe("a photo");
    expect(result.html).not.toContain("<img");
  });

  it("shows link text styled but not as a clickable anchor", () => {
    const result = renderInline("[click here](http://example.com)");
    expect(result.html).toBe('<span class="md-inline-link">click here</span>');
    expect(result.html).not.toContain("<a ");
    expect(result.plainText).toBe("click here");
  });

  it("degrades an uncommon construct (a rule) to plain text", () => {
    const result = renderInline("---");
    expect(result.html).not.toContain("<hr");
  });

  it("neutralizes a script injection attempt embedded in the string", () => {
    const result = renderInline('<script>alert("x")</script>');
    expect(result.html).not.toMatch(/<script[ >]/);
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("neutralizes an inline event-handler injection attempt", () => {
    const result = renderInline('<b onclick="alert(1)">text</b>');
    expect(result.html).not.toMatch(/<b\b[^>]*onclick/);
    expect(result.html).toContain("&lt;b onclick");
  });

  it("plain-text extraction strips all markup", () => {
    const result = renderInline(
      "# Title\n\n- **one** *two*\n- `three` [link](http://example.com)",
    );
    expect(result.plainText).not.toMatch(/[*_`#[\]]/);
  });
});

describe("renderBlock", () => {
  it("renders CommonMark constructs as expected HTML", () => {
    const html = renderBlock(
      "# Title\n\nA paragraph with **bold** and *italic*.\n\n- one\n- two\n\n> a quote\n\n```\ncode here\n```",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<pre><code>code here");
  });

  it("renders allowed link schemes as real anchors", () => {
    const html = renderBlock("[site](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders a mailto link as a real anchor", () => {
    const html = renderBlock("[email](mailto:a@example.com)");
    expect(html).toContain('<a href="mailto:a@example.com"');
  });

  it("neutralizes a javascript: link scheme", () => {
    const html = renderBlock("[bad](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("bad");
  });

  it("neutralizes a data: link scheme", () => {
    const html = renderBlock("[bad](data:text/html,evil)");
    expect(html).not.toContain("<a ");
  });

  it("neutralizes a bare-fragment link", () => {
    const html = renderBlock("[bad](#frag)");
    expect(html).not.toContain("<a ");
  });

  it("neutralizes a relative-path link", () => {
    const html = renderBlock("[bad](/relative/path)");
    expect(html).not.toContain("<a ");
  });

  it("renders an image with an allowed scheme", () => {
    const html = renderBlock("![alt text](https://example.com/x.png)");
    expect(html).toContain(
      '<img src="https://example.com/x.png" alt="alt text">',
    );
  });

  it("neutralizes an image with a disallowed scheme", () => {
    const html = renderBlock("![alt text](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).toContain("alt text");
  });

  it("does not render GFM tables (plain CommonMark only)", () => {
    const html = renderBlock("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).not.toContain("<table>");
  });

  it("does not render GFM strikethrough (plain CommonMark only)", () => {
    const html = renderBlock("~~struck~~");
    expect(html).not.toContain("<s>");
  });

  it("treats raw HTML in the source as literal text, never executed", () => {
    const html = renderBlock('<script>alert("x")</script>');
    expect(html).not.toContain("<script");
  });

  it("neutralizes an inline event-handler injection attempt", () => {
    const html = renderBlock('Some <b onclick="alert(1)">text</b> here.');
    expect(html).not.toMatch(/<b\b[^>]*onclick/);
    expect(html).toContain("&lt;b onclick");
  });
});
