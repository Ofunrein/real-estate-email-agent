"use client";

import { mediaProxyPath, usableInboxPhotoUrl } from "@/lib/mediaProxy";
import { displayValue, formatPrice, formatSqft, missingPropertyFields } from "@/lib/format";
import type { SheetRow } from "@/lib/sheetSchema";

export type PropertySortKey =
  | "source_order"
  | "address"
  | "price"
  | "beds"
  | "baths"
  | "sqft"
  | "city"
  | "neighborhood";
export type PropertySort = { key: PropertySortKey; direction: "asc" | "desc" };

function propertySubtitle(property: SheetRow) {
  const area = property.neighborhood || property.city || "";
  const location = property.city && property.neighborhood && property.city !== property.neighborhood ? property.city : "";
  return [
    area,
    location,
    property.price ? formatPrice(property.price) : "",
    property.beds ? `${property.beds} bd` : "",
    property.baths ? `${property.baths} bth` : "",
    formatSqft(property.sqft),
    property.property_type || "",
    property.status && property.status !== "sheet" ? property.status : "",
  ].filter((value) => value && value !== "Blank").join(" | ");
}

export function PropertyPhoto({ property, large = false }: { property: SheetRow; large?: boolean }) {
  // Use any available URL — Street View, Zillow, whatever; degrade on load error
  const rawUrl = (property.photo_url || "").trim();
  const photoUrl = rawUrl || null;
  const cls = large ? "property-photo large" : "property-photo";
  const missingCls = large ? "property-photo missing large" : "property-photo missing";
  if (!photoUrl) {
    return <div className={missingCls}>No photo</div>;
  }
  return (
    <img
      alt={`${property.address || "Property"} photo`}
      className={cls}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.replaceWith(
          Object.assign(document.createElement("div"), {
            className: missingCls,
            textContent: "No photo",
          }),
        );
      }}
      src={rawUrl.startsWith("http") ? rawUrl : mediaProxyPath(rawUrl)}
    />
  );
}

export function PreviewIcon() {
  return (
    <svg aria-hidden="true" className="preview-icon" fill="none" viewBox="0 0 20 20">
      <path d="M7.25 4.75h-2.5v2.5M12.75 4.75h2.5v2.5M7.25 15.25h-2.5v-2.5M12.75 15.25h2.5v-2.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M8 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function PropertyPreviewButton({ property, onOpen }: { property: SheetRow; onOpen: () => void }) {
  return (
    <button
      className="property-preview-button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      title="Open mobile preview"
      type="button"
    >
      <PropertyPhoto property={property} />
      <span><PreviewIcon /></span>
    </button>
  );
}

export function PropertyTable({
  properties,
  sort,
  onSort,
  selectedIndex,
  onSelect,
  onOpenCard,
}: {
  properties: SheetRow[];
  sort: PropertySort;
  onSort: (key: PropertySortKey) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onOpenCard: (index: number) => void;
}) {
  if (!properties.length) {
    return <div className="empty">No property rows loaded</div>;
  }

  const sortHeaders: { label: string; key: PropertySortKey }[] = [
    { label: "Address", key: "address" },
    { label: "Price", key: "price" },
    { label: "Beds", key: "beds" },
    { label: "Baths", key: "baths" },
    { label: "Sqft", key: "sqft" },
    { label: "City", key: "city" },
  ];

  return (
    <div className="property-table-wrap">
      <table className="property-table">
        <thead>
          <tr>
            {sortHeaders.slice(0, 4).map((header) => (
              <th key={header.key}>
                <button
                  className={sort.key === header.key ? "sort-header active" : "sort-header"}
                  onClick={() => onSort(header.key)}
                  type="button"
                >
                  {header.label}
                  <span>{sort.key === header.key ? (sort.direction === "asc" ? "Asc" : "Desc") : ""}</span>
                </button>
              </th>
            ))}
            <th>Photo</th>
            <th>
              <button
                className={sort.key === "sqft" ? "sort-header active" : "sort-header"}
                onClick={() => onSort("sqft")}
                type="button"
              >
                Sqft
                <span>{sort.key === "sqft" ? (sort.direction === "asc" ? "Asc" : "Desc") : ""}</span>
              </button>
            </th>
            <th>Year</th>
            <th>Status</th>
            <th>
              <button
                className={sort.key === "city" ? "sort-header active" : "sort-header"}
                onClick={() => onSort("city")}
                type="button"
              >
                City
                <span>{sort.key === "city" ? (sort.direction === "asc" ? "Asc" : "Desc") : ""}</span>
              </button>
            </th>
            <th>Zip</th>
            <th>Type</th>
            <th>Days</th>
            <th>Agent</th>
            <th>Missing</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((property, index) => {
            const missing = missingPropertyFields(property);
            return (
              <tr
                className={selectedIndex === index ? "active" : ""}
                key={`${property.address || "property"}-${index}`}
                aria-label={`Select ${property.address || "property"}. Double click to open mobile preview.`}
                onClick={() => {
                  onSelect(index);
                }}
                onDoubleClick={() => {
                  onSelect(index);
                  onOpenCard(index);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(index);
                  }
                  if (event.key === "v" || event.key === "V") {
                    onSelect(index);
                    onOpenCard(index);
                  }
                }}
                onMouseDown={() => onSelect(index)}
                tabIndex={0}
              >
                <td className="property-address">
                  <strong>{property.address || "Blank address"}</strong>
                  <span className="property-subtitle">{propertySubtitle(property)}</span>
                </td>
                <td>{formatPrice(property.price)}</td>
                <td>{displayValue(property.beds)}</td>
                <td>{displayValue(property.baths)}</td>
                <td>
                  <PropertyPreviewButton property={property} onOpen={() => onOpenCard(index)} />
                </td>
                <td>{displayValue(property.sqft)}</td>
                <td>{displayValue(property.year_built)}</td>
                <td><span className="status">{property.status || "sheet"}</span></td>
                <td>{displayValue(property.city)}</td>
                <td>{displayValue(property.zip)}</td>
                <td>{displayValue(property.property_type)}</td>
                <td>{displayValue(property.days_on_market)}</td>
                <td>{displayValue(property.agent_name)}</td>
                <td>
                  <span className={missing.length ? "missing-pill" : "complete-pill"}>
                    {missing.length ? `${missing.length} missing` : "complete"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
