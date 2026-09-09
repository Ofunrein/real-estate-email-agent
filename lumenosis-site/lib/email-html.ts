const LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function anchor(label: string, href: string) {
  return `<a href="${escapeHtml(href)}" style="color:#8a682c;font-weight:600;text-decoration:underline">${escapeHtml(label)}</a>`;
}

/** Plain-text alternative: [label](url) becomes "label: url". */
export function emailText(body: string) {
  return body.replace(LINK, "$1: $2");
}

function inline(part: string) {
  // Escape first, then link, so no user text can inject markup.
  return escapeHtml(part)
    .replace(LINK, (_m, label: string, href: string) => anchor(label, href))
    .replace(BARE, (_m, lead: string, url: string) => `${lead}${anchor(url, url)}`)
    .replaceAll("\n", "<br>");
}

/** Paragraph markup only, for embedding in an existing shell (in-app previews). */
export function emailBodyHtml(body: string) {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const style = /^(best|thanks|regards|sincerely)\b/i.test(part)
        ? "margin:28px 0 0;padding-top:18px;border-top:1px solid #e6e2d8;font-size:15px;line-height:1.6;color:#4b5563"
        : "margin:0 0 18px;font-size:16px;line-height:1.65;color:#1f2937";
      return `<p style="${style}">${inline(part)}</p>`;
    })
    .join("\n");
}

/** Rendered HTML email. Markdown links stay inline; bare URLs are linked as a fallback. */
export function emailHtml(body: string) {
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f2ec">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e6e2d8;border-radius:14px">
<tr><td style="padding:32px 32px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
${emailBodyHtml(body)}
</td></tr></table></body></html>`;
}
