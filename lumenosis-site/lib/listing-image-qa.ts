export type ImageQaAssessment = {
  url: string;
  isRealPropertyPhoto: boolean;
  matchesExactListing: boolean;
  isLogoOrGraphic: boolean;
  reason: string;
};

export function demoImagesPassQa(
  qa: { passed: boolean } | undefined,
  images: { src: string }[],
) {
  if (!qa) return images.length > 0;
  return qa.passed && images.length === 3;
}

export function listingImagesPassQa(
  imageUrls: string[],
  assessments: ImageQaAssessment[],
) {
  if (imageUrls.length !== 3 || assessments.length !== imageUrls.length) return false;
  const byUrl = new Map(assessments.map((item) => [item.url, item]));
  return imageUrls.every((url) => {
    const item = byUrl.get(url);
    return Boolean(
      item &&
        item.isRealPropertyPhoto &&
        item.matchesExactListing &&
        !item.isLogoOrGraphic,
    );
  });
}

export async function verifyListingImages(
  address: string,
  listingUrl: string,
  imageUrls: string[],
  openaiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (imageUrls.length !== 3) return { passed: false, assessments: [] };

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict real-estate demo image QA gate. Reject logos, brokerage graphics, maps, screenshots, placeholders, text-heavy images, unrelated stock photos, and photos not clearly attributable to the exact listing. A real exterior or interior listing photograph is required. Return JSON only: {assessments:[{url,isRealPropertyPhoto,matchesExactListing,isLogoOrGraphic,reason}]}. Preserve each supplied URL exactly and return one assessment per image.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Exact listing: ${address}\nPrimary source: ${listingUrl}\nCheck every image. Matching means the source context identifies it as this exact address, not merely that it looks like a house.`,
            },
            ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        },
      ],
    }),
  });
  if (!response.ok) return { passed: false, assessments: [] };
  const payload = await response.json();
  try {
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "null") as {
      assessments?: ImageQaAssessment[];
    };
    const assessments = Array.isArray(parsed?.assessments) ? parsed.assessments : [];
    return { passed: listingImagesPassQa(imageUrls, assessments), assessments };
  } catch {
    return { passed: false, assessments: [] };
  }
}
