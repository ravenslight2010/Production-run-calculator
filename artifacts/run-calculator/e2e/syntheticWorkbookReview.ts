import * as XLSX from "xlsx";

// Deliberately not a deterministic export layout: these in-memory, invented
// values exercise the browser's fallback/review contract, not provider quality.
export const SYNTHETIC_REVIEW_BRAND = "Local Fixture Bakery";
export const SYNTHETIC_REVIEW_FLAVORS = ["Garden", "Smoky", "Harvest"] as const;

export function syntheticReviewWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["SYNTHETIC LOCAL PIZZA RECIPE SPECS — NOT A CUSTOMER WORKBOOK"],
    [SYNTHETIC_REVIEW_BRAND],
    ["Product options"],
    [...SYNTHETIC_REVIEW_FLAVORS],
    ["Fixture Tomato Blend", 1.25],
    ["TARGET WEIGHT", 10],
  ]), "OZ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function syntheticReviewParse() {
  return {
    profiles: SYNTHETIC_REVIEW_FLAVORS.map((flavor, index) => ({
      brand: SYNTHETIC_REVIEW_BRAND,
      flavor,
      applicators: [],
      pepperonis: [],
      sourceLocations: {
        brand: [{ sheet: "OZ", cell: "A2" }],
        flavor: [{ sheet: "OZ", cell: `${String.fromCharCode(65 + index)}4` }],
      },
    })),
    recipes: [],
    generatedAt: Date.now(),
  };
}

export function blockUnapprovedRealSourceAudit(): void {
  throw new Error(
    "BLOCKED: the real-customer/provider workbook audit requires separate source-use, retention, privacy and provider authorization. Local approval covers only synthetic fixtures; no source was read or provider request sent.",
  );
}
