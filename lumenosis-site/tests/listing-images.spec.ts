import { expect, test } from "@playwright/test";
import { isAllowedListingImage } from "../lib/listing-image-hosts";

test("listing image hosts cover the CDNs demo listings actually use", () => {
  const live = [
    "https://photos.zillowstatic.com/fp/abc-cc_ft_960.jpg",
    "https://ssl.cdn-redfin.com/photo/86/mbpaddedwide/337/genMid.7020337_2.jpg",
    "https://cdn.photos.sparkplatform.com/az/20260527054156559341000000-o.jpg",
    "https://media-production.lp-cdn.com/media/fc5e6906",
    "https://dvvjkgh94f2v6.cloudfront.net/7b68097c/778584771/83dcefb7.jpeg",
    "https://www.har.com/ogimage/v3/listing-detail--10527341--f4f3.jpg",
  ];
  for (const url of live) expect(isAllowedListingImage(url), url).toBe(true);
  expect(isAllowedListingImage("https://evil.example.com/a.jpg")).toBe(false);
  expect(isAllowedListingImage("http://photos.zillowstatic.com/a.jpg")).toBe(false);
});
