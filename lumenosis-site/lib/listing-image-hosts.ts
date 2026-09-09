export const listingImageHosts = [
  "ap.rdcpix.com",
  "images-listings.coldwellbanker.com",
  "photos.zillowstatic.com",
  "maps.googleapis.com",
  "ssl.cdn-redfin.com",
  "cdn.photos.sparkplatform.com",
  "media-production.lp-cdn.com",
  "dvvjkgh94f2v6.cloudfront.net",
  "www.har.com",
  "photos.harstatic.com",
  "cdn.resize.sparkplatform.com",
  "images.crexi.com",
  "s3.amazonaws.com",
  "media.crmls.org",
  "img.hzcdn.com",
  "sj-feeds.cdn.backatyou.com",
] as const;

export function isAllowedListingImage(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && (listingImageHosts as readonly string[]).includes(hostname);
  } catch {
    return false;
  }
}
