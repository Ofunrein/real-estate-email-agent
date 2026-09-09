import { expect, test } from "@playwright/test";
import { demoImagesPassQa, listingImagesPassQa } from "../lib/listing-image-qa";

const urls = [
  "https://photos.zillowstatic.com/a.jpg",
  "https://photos.zillowstatic.com/b.jpg",
  "https://photos.zillowstatic.com/c.jpg",
];

function assessment(url: string) {
  return {
    url,
    isRealPropertyPhoto: true,
    matchesExactListing: true,
    isLogoOrGraphic: false,
    reason: "Verified listing photo",
  };
}

test("image QA accepts exactly three matched property photos", () => {
  expect(listingImagesPassQa(urls, urls.map(assessment))).toBe(true);
});

test("image QA rejects logos, unmatched photos, missing photos, and extra photos", () => {
  expect(
    listingImagesPassQa(urls, [
      assessment(urls[0]),
      { ...assessment(urls[1]), isLogoOrGraphic: true },
      assessment(urls[2]),
    ]),
  ).toBe(false);
  expect(
    listingImagesPassQa(urls, [
      assessment(urls[0]),
      { ...assessment(urls[1]), matchesExactListing: false },
      assessment(urls[2]),
    ]),
  ).toBe(false);
  expect(listingImagesPassQa(urls.slice(0, 2), urls.slice(0, 2).map(assessment))).toBe(false);
  expect(listingImagesPassQa([...urls, "https://photos.zillowstatic.com/d.jpg"], urls.map(assessment))).toBe(false);
});

test("approved legacy demos remain readable without QA metadata", () => {
  expect(demoImagesPassQa(undefined, [{ src: "https://example.com/legacy.jpg" }])).toBe(true);
});

test("explicit failed QA remains blocked", () => {
  expect(demoImagesPassQa({ passed: false }, urls.map((src) => ({ src })))).toBe(false);
});
