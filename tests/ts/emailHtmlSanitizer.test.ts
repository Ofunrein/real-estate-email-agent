import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitizeEmailHtml } from "@/lib/mediaProxy";

test("paired dangerous elements are removed", () => {
  const clean = sanitizeEmailHtml('<p>hi</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe>');
  assert.equal(clean.includes("<script"), false);
  assert.equal(clean.includes("<iframe"), false);
  assert.equal(clean.includes("<style"), false);
  assert.equal(clean.includes("<p>hi</p>"), true);
});

test("unclosed script and iframe tags cannot survive", () => {
  // The old paired-tag regex needed a closing tag, so this executed.
  const clean = sanitizeEmailHtml('<p>ok</p><script src="https://evil.example/x.js">');
  assert.equal(/<script/i.test(clean), false);

  const frame = sanitizeEmailHtml('<iframe src="https://evil.example">');
  assert.equal(/<iframe/i.test(frame), false);
});

test("entity-encoded javascript URLs are stripped", () => {
  const clean = sanitizeEmailHtml('<a href="jav&#97;script:alert(1)">click</a>');
  assert.equal(/javascript/i.test(clean.replace(/&#\d+;/g, "")), false);
  assert.equal(clean.includes("href="), false);

  const spaced = sanitizeEmailHtml('<a href="java\tscript:alert(1)">click</a>');
  assert.equal(spaced.includes("href="), false);
});

test("inline event handlers and script-capable containers are stripped", () => {
  assert.equal(sanitizeEmailHtml('<img src="x" onerror="alert(1)">').includes("onerror"), false);
  assert.equal(/<svg/i.test(sanitizeEmailHtml('<svg><animate onbegin="alert(1)"/></svg>')), false);
  assert.equal(/<base/i.test(sanitizeEmailHtml('<base href="https://evil.example/">')), false);
});

test("non-image data URLs are stripped and image data URLs survive", () => {
  assert.equal(sanitizeEmailHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>').includes("href="), false);
  assert.equal(sanitizeEmailHtml('<img src="data:image/png;base64,iVBORw0KGgo=">').includes("src="), true);
});

test("ordinary marketing email markup is preserved", () => {
  const html = '<table><tr><td><a href="https://example.com/listing">123 Main St</a></td></tr></table>';
  assert.equal(sanitizeEmailHtml(html), html);
});
