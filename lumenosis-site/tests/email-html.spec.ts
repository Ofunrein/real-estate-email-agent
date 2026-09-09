import { expect, test } from "@playwright/test";
import { emailHtml, emailText } from "../lib/email-html";

const body = [
  "Hi Enrique,",
  "I put together a [private AI demo for Mr. Sold](https://lumenosis.com/demo/abc) for you.",
  "Best,\nIris",
].join("\n\n");

test("markdown links render as inline anchors, never bare URLs", () => {
  const html = emailHtml(body);
  expect(html).toContain('<a href="https://lumenosis.com/demo/abc"');
  expect(html).toContain(">private AI demo for Mr. Sold</a>");
  expect(html).not.toContain("[private AI demo");
  expect(html).not.toMatch(/>[^<]*https:\/\/lumenosis\.com\/demo\/abc[^<]*</);
  expect(html).toContain("border-top:1px solid #e6e2d8");
  expect(emailText(body)).toContain("private AI demo for Mr. Sold: https://lumenosis.com/demo/abc");
});

test("body text is escaped before linking", () => {
  const html = emailHtml('Hi <script>alert("x")</script> & co\n\nhttps://lumenosis.com');
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("&amp; co");
  expect(html).toContain('<a href="https://lumenosis.com"');
});
