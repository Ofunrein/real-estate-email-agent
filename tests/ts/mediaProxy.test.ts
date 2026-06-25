import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractPropertyAddressFromEmailHtml,
  inboxImagePreviewUrl,
  isGoogleStreetViewUrl,
  mediaProxyPath,
  mediaProxyUrl,
  resolvePropertyPhotoFromSheet,
  rewriteEmailHtmlForInbox,
  usableInboxPhotoUrl,
} from "@/lib/mediaProxy";

const STREET_VIEW =
  "https://maps.googleapis.com/maps/api/streetview?location=4309+Fairway+Path&size=600x400&key=test";
const ZILLOW = "https://photos.zillowstatic.com/fp/abc123-p_e.jpg";

test("isGoogleStreetViewUrl detects Google Street View URLs", () => {
  assert.equal(isGoogleStreetViewUrl(STREET_VIEW), true);
  assert.equal(isGoogleStreetViewUrl(ZILLOW), false);
});

test("mediaProxyPath returns Zillow URLs directly (no proxy)", () => {
  assert.equal(mediaProxyPath(ZILLOW), ZILLOW);
  assert.equal(mediaProxyPath(STREET_VIEW), STREET_VIEW);
});

test("mediaProxyUrl returns direct URL (no proxy)", () => {
  const result = mediaProxyUrl(ZILLOW, "https://app.example.com");
  assert.equal(result, ZILLOW);
});

test("rewriteEmailHtmlForInbox replaces Street View with sheet photo and serves directly", () => {
  const html = `<div><img src="${STREET_VIEW}" alt="Property photo" /><h2>4309 Fairway Path</h2></div>`;
  const properties = [{ address: "4309 Fairway Path", photo_url: ZILLOW }];
  const rewritten = rewriteEmailHtmlForInbox(html, properties);
  assert.doesNotMatch(rewritten, /maps\.googleapis\.com/);
  assert.match(rewritten, /zillowstatic\.com/);
  assert.match(rewritten, /4309 Fairway Path/);
});

test("rewriteEmailHtmlForInbox shows placeholder when only Street View is available", () => {
  const html = `<div><img src="${STREET_VIEW}" alt="Property photo" /><h2>4309 Fairway Path</h2></div>`;
  const rewritten = rewriteEmailHtmlForInbox(html, [
    { address: "4309 Fairway Path", photo_url: STREET_VIEW },
  ]);
  assert.match(rewritten, /email-photo-placeholder/);
  assert.doesNotMatch(rewritten, /<img[^>]+streetview/i);
});

test("rewriteEmailHtmlForInbox serves Zillow images directly", () => {
  const html = `<img src="${ZILLOW}" alt="Property photo" />`;
  const rewritten = rewriteEmailHtmlForInbox(html);
  assert.match(rewritten, /zillowstatic\.com/);
  assert.doesNotMatch(rewritten, /\/api\/media\/proxy/);
});

test("extractPropertyAddressFromEmailHtml reads h2 address headings", () => {
  const html = `<div><h2 style="margin-top:0">4309 Fairway Path</h2><p>$407,800</p></div>`;
  assert.equal(extractPropertyAddressFromEmailHtml(html), "4309 Fairway Path");
});

test("resolvePropertyPhotoFromSheet ignores Street View sheet photos", () => {
  assert.equal(
    resolvePropertyPhotoFromSheet("4309 Fairway Path", [
      { address: "4309 Fairway Path", photo_url: STREET_VIEW },
    ]),
    "",
  );
  assert.equal(
    resolvePropertyPhotoFromSheet("4309 Fairway Path", [
      { address: "4309 Fairway Path", photo_url: ZILLOW },
    ]),
    ZILLOW,
  );
});

test("usableInboxPhotoUrl and inboxImagePreviewUrl skip Street View", () => {
  assert.equal(usableInboxPhotoUrl(STREET_VIEW), "");
  assert.equal(inboxImagePreviewUrl(STREET_VIEW), "");
  assert.equal(inboxImagePreviewUrl(ZILLOW), ZILLOW);
});
