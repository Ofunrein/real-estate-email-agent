# County Assessor Bulk Data Sources (Austin Metro)

Free public appraisal-roll exports used to backfill empty property fields in Neon (`beds`, `baths`, `sqft`, `year_built`, lot metadata in `features`).

## Travis County — TCAD (implemented)

- **District:** Travis Central Appraisal District
- **Public info page:** https://traviscad.org/publicinformation/
- **Certified roll used:** `2025 Certified Export (July)` — fixed-width TXT inside ZIP
- **Direct download:** https://traviscad.org/wp-content/largefiles/2025%20Certified%20Appraisal%20Export%20Supp%200_07202025.zip
- **Field layout:** https://traviscad.org/wp-content/largefiles/Website_Legacy8.0.32-AppraisalExportLayout.zip
- **Import script:** `npm run import:tcad` → `scripts/import-tcad-assessor.py`
- **Local cache:** `data/tcad/tcad-2025-certified.zip` (gitignored; ~465 MB)

TCAD exports `PROP.TXT` (situs address + lot) and `IMP_DET.TXT` (living area, year built). Bed/bath counts are **not** in the standard fixed-width export.

## Williamson County — WCAD (future)

- **Public info:** https://www.wcad.org/public-information
- **Typical format:** Certified appraisal export ZIP (same True Prodigy / fixed-width family as TCAD)
- **Coverage:** Round Rock, Cedar Park, Leander, Georgetown, etc.

## Hays County — HCAD (future)

- **Public info:** https://hayscad.com/public-information/
- **Typical format:** Appraisal roll export ZIP
- **Coverage:** Kyle, Buda, San Marcos (partial), Dripping Springs

## Bastrop / Caldwell / other Austin-metro CADs (future)

- Bastrop CAD: https://bastropcad.org/
- Caldwell CAD: https://caldwellcad.org/

When adding a county, mirror the TCAD pattern: download certified roll → parse fixed-width layout → normalize address keys like `core.property_hygiene.normalize_address_key` → coalesce into Neon only where fields are empty → `npm run sync:db-to-sheets`.
