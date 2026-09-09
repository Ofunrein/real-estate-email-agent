export type DemoRoom = {
  slug: string;
  prospect: { firstName: string; fullName: string; businessName: string; role: string };
  listing: {
    address: string;
    status: "active";
    price: number;
    beds: number;
    baths: number;
    squareFeet: number;
    acreage: number;
    mls: string;
    propertyType: string;
    yearBuilt: number;
    lotSquareFeet: number;
    pricePerSquareFoot: number;
    listedAt: string;
    summary: string;
    highlights: string[];
    buyerNotes: string[];
    images: { src: string; alt: string }[];
  };
  sources: { label: string; url: string; checkedAt: string }[];
  qa?: {
    passed: true;
    checkedAt: string;
    images: "exact-listing-property-photos";
    responsiveViewports: number[];
  };
  safetyBoundaries?: string[];
  expiresAt: string;
  approved: boolean;
};

export const demoRooms: DemoRoom[] = [
  {
    slug: "patricia-any-old-street",
    prospect: {
      firstName: "Patricia",
      fullName: "Patricia Mack",
      businessName: "American Real Estate, ERA Powered",
      role: "REALTOR®",
    },
    listing: {
      address: "471 Any Old Street East, Buna, TX 77612",
      status: "active",
      price: 389900,
      beds: 3,
      baths: 2,
      squareFeet: 2000,
      acreage: 12.41,
      mls: "82557177",
      propertyType: "Farm · single-family home",
      yearBuilt: 1976,
      lotSquareFeet: 540797,
      pricePerSquareFoot: 195,
      listedAt: "June 1, 2026",
      summary:
        "A 3-bedroom country home on 12.41 acres with updated flooring, energy-efficient windows, and quick access to Highway 96.",
      highlights: [
        "Updated flooring throughout",
        "New energy-efficient windows",
        "Retaining wall added for flood protection",
        "Space for gardening, recreation, livestock, or additional structures",
        "Minutes from Highway 96 with access to Buna, Kirbyville, and Beaumont",
      ],
      buyerNotes: [
        "No upcoming open houses are published",
        "Property facts and measurements should be independently verified",
        "Financing, insurance, restrictions, and showing availability require human confirmation",
      ],
      images: [
        {
          src: "https://images-listings.coldwellbanker.com/HARMLS/82/55/71/77/_P/82557177_P00.jpg",
          alt: "Front exterior of 471 Any Old Street East",
        },
        {
          src: "https://images-listings.coldwellbanker.com/HARMLS/82/55/71/77/_P/82557177_P01.jpg",
          alt: "Second listing view of 471 Any Old Street East",
        },
        {
          src: "https://images-listings.coldwellbanker.com/HARMLS/82/55/71/77/_P/82557177_P02.jpg",
          alt: "Third listing view of 471 Any Old Street East",
        },
      ],
    },
    sources: [
      {
        label: "Active listing and current price",
        url: "https://www.har.com/homedetail/471-any-old-st-buna-tx-77612/4384980",
        checkedAt: "2026-09-04",
      },
      {
        label: "Listing agent and brokerage profile",
        url: "https://www.har.com/patricia-mack/agent_trishamack",
        checkedAt: "2026-09-04",
      },
      {
        label: "Property description, features, and photography",
        url: "https://www.coldwellbanker.com/tx/buna/471-any-old-st/lid-P00800000HByybC1WR98EX9G2nIyMLUBIeqCT4RP",
        checkedAt: "2026-09-04",
      },
    ],
    qa: {
      passed: true,
      checkedAt: "2026-09-04",
      images: "exact-listing-property-photos",
      responsiveViewports: [320, 390, 768, 1024, 1440],
    },
    expiresAt: "2026-09-18T23:59:59.000Z",
    approved: true,
  },
];

export function demoRoomBySlug(slug: string) {
  return demoRooms.find((room) => room.slug === slug);
}
