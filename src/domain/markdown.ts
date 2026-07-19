import { Marked } from "marked";
import type { Token, Tokens } from "marked";
import DOMPurify from "dompurify";

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

const BLOCK_ALLOWED_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "strong",
  "em",
  "s",
  "a",
  "img",
  "hr",
  "br",
];

const inlineMarked = new Marked({ gfm: true });
const blockMarked = new Marked({
  gfm: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const text = this.parser.parseInline(tokens);
      if (!isAllowedUrl(href)) return text;
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<a href="${escapeAttribute(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    },
    image({ href, title, text }: Tokens.Image): string {
      if (!isAllowedUrl(href)) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeAttribute(title)}"` : "";
      return `<img src="${escapeAttribute(href)}" alt="${escapeAttribute(text)}"${titleAttr}>`;
    },
  },
});

export function renderBlock(source: string): string {
  const rawHtml = blockMarked.parse(source, { async: false });
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: BLOCK_ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "src", "alt", "title", "target", "rel"],
  });
}

export interface InlineRender {
  html: string;
  plainText: string;
}

export function renderInline(source: string): InlineRender {
  const tokens = inlineMarked.lexer(source);
  const rendered = joinParts(tokens.map(flattenBlockToken), " ");
  return {
    html: DOMPurify.sanitize(rendered.html, {
      ALLOWED_TAGS: ["strong", "em", "s", "code", "span"],
      ALLOWED_ATTR: ["class"],
    }),
    plainText: rendered.plainText,
  };
}

function flattenBlockToken(token: Token): InlineRender {
  switch (token.type) {
    case "heading": {
      const inner = renderInlineTokens((token as Tokens.Heading).tokens ?? []);
      return {
        html: `<strong>${inner.html}</strong>`,
        plainText: inner.plainText,
      };
    }
    case "paragraph":
      return renderInlineTokens((token as Tokens.Paragraph).tokens ?? []);
    case "text": {
      const textToken = token as Tokens.Text;
      return textToken.tokens
        ? renderInlineTokens(textToken.tokens)
        : { html: escapeHtml(textToken.text), plainText: textToken.text };
    }
    case "blockquote": {
      const inner = (token as Tokens.Blockquote).tokens.map(flattenBlockToken);
      return joinParts(inner, " ");
    }
    case "list": {
      const items = (token as Tokens.List).items.map((item) =>
        joinParts(item.tokens.map(flattenBlockToken), " "),
      );
      return joinParts(items, " · ");
    }
    case "code": {
      const raw = (token as Tokens.Code).text;
      const lines = raw.split("\n");
      const first = lines[0] ?? "";
      const suffix = lines.length > 1 ? "…" : "";
      const plainText = `${first}${suffix}`;
      return { html: `<code>${escapeHtml(plainText)}</code>`, plainText };
    }
    case "space":
      return { html: "", plainText: "" };
    case "html": {
      const raw = (token as Tokens.HTML).text;
      return { html: escapeHtml(raw), plainText: raw };
    }
    default: {
      const raw = "raw" in token ? String(token.raw) : "";
      const plainText = stripMarkupFallback(raw);
      return { html: escapeHtml(plainText), plainText };
    }
  }
}

function renderInlineTokens(tokens: Token[]): InlineRender {
  const parts = tokens.map(renderInlineToken);
  return {
    html: parts.map((part) => part.html).join(""),
    plainText: parts.map((part) => part.plainText).join(""),
  };
}

function renderInlineToken(token: Token): InlineRender {
  switch (token.type) {
    case "strong": {
      const inner = renderInlineTokens((token as Tokens.Strong).tokens);
      return {
        html: `<strong>${inner.html}</strong>`,
        plainText: inner.plainText,
      };
    }
    case "em": {
      const inner = renderInlineTokens((token as Tokens.Em).tokens);
      return { html: `<em>${inner.html}</em>`, plainText: inner.plainText };
    }
    case "del": {
      const inner = renderInlineTokens((token as Tokens.Del).tokens);
      return { html: `<s>${inner.html}</s>`, plainText: inner.plainText };
    }
    case "codespan": {
      const text = (token as Tokens.Codespan).text;
      return { html: `<code>${escapeHtml(text)}</code>`, plainText: text };
    }
    case "link": {
      const inner = renderInlineTokens((token as Tokens.Link).tokens);
      return {
        html: `<span class="md-inline-link">${inner.html}</span>`,
        plainText: inner.plainText,
      };
    }
    case "image": {
      const alt = (token as Tokens.Image).text;
      return { html: escapeHtml(alt), plainText: alt };
    }
    case "br":
      return { html: " ", plainText: " " };
    case "escape":
    case "text": {
      const textToken = token as Tokens.Text | Tokens.Escape;
      const text = textToken.text.replace(/\n/g, " ");
      return { html: escapeHtml(text), plainText: text };
    }
    case "html": {
      const raw = (token as Tokens.Tag).raw;
      return { html: escapeHtml(raw), plainText: raw };
    }
    default: {
      const raw = "raw" in token ? String(token.raw) : "";
      return { html: escapeHtml(raw), plainText: raw };
    }
  }
}

function joinParts(parts: InlineRender[], separator: string): InlineRender {
  const nonEmpty = parts.filter(
    (part) => part.html !== "" || part.plainText !== "",
  );
  return {
    html: nonEmpty.map((part) => part.html).join(separator),
    plainText: nonEmpty.map((part) => part.plainText).join(separator),
  };
}

function stripMarkupFallback(raw: string): string {
  return raw
    .replace(/^\|.*\|$/gm, (line) =>
      line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim())
        .join(" "),
    )
    .replace(/[|#>*_~`-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAllowedUrl(url: string): boolean {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  if (!match) return false;
  return ALLOWED_URL_SCHEMES.has(`${match[1]!.toLowerCase()}:`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
