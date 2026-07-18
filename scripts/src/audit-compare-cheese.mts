// Pair sheet cheese blends to prod pool rows using the app's own loose key +
// near-dup matcher, then diff components/shredder/cellulose/flavors.
import fs from "node:fs";
import { cheeseLinkKey } from "@workspace/cheese-import";
import { buildNearDupNameMatcher } from "@workspace/name-match";

type Comp = { ingredient: string; lbs: number };
const J = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
const prod: any[] = J("/tmp/audit_cheese.json");
const parsed: any = J("/tmp/audit_parsed_cheese.json");

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const numish = (s: unknown) => { const m = String(s ?? "").match(/[\d.]+/); return m ? parseFloat(m[0]) : null; };
const compList = (c: Comp[] | null) => (c ?? []).map(x => [norm(x.ingredient), Math.round(+x.lbs * 1000) / 1000] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
const compKey = (c: Comp[] | null) => JSON.stringify(compList(c));

const prodNames = prod.map(p => p.name);
const prodByNk = new Map(prod.map(p => [norm(p.name), p]));
const prodByLk = new Map<string, any[]>();
for (const p of prod) {
  const k = cheeseLinkKey(p.name);
  if (!prodByLk.has(k)) prodByLk.set(k, []);
  prodByLk.get(k)!.push(p);
}
const matcher = buildNearDupNameMatcher(prodNames, { keyOf: cheeseLinkKey, allowExtraToken: true });

function findProd(sheetBrand: string, name: string): any | undefined {
  if (prodByNk.has(norm(name))) return prodByNk.get(norm(name));
  // brand-prefixed variant: "<brand> <name>"
  for (const cand of [`${sheetBrand} ${name}`, name.replace(/\bcheese mix\b/i, "Mix"), `${sheetBrand.replace(/'s$/,'')} ${name}`]) {
    if (prodByNk.has(norm(cand))) return prodByNk.get(norm(cand));
  }
  const lk = cheeseLinkKey(name);
  const byLk = prodByLk.get(lk);
  if (byLk?.length === 1) return byLk[0];
  const m = matcher(name) ?? matcher(`${sheetBrand} ${name}`);
  if (m) return prodByNk.get(norm(m));
  return undefined;
}

const findings: any[] = [];
const matchedProd = new Set<string>();
// group sheet recipes by resolved prod row (or by name if unmatched)
type Pair = { prodRow?: any; variants: any[] };
const pairs = new Map<string, Pair>();
for (const r of parsed.recipes) {
  const p = findProd(r.brand, r.name);
  const key = p ? `P:${p.name}` : `S:${norm(r.name)}`;
  if (!pairs.has(key)) pairs.set(key, { prodRow: p, variants: [] });
  pairs.get(key)!.variants.push(r);
  if (p) matchedProd.add(p.name);
}
for (const [, { prodRow: p, variants }] of pairs) {
  if (!p) {
    findings.push({ type: "MISSING_IN_APP", name: variants[0].name, sheets: variants.map((v: any) => v.brand) });
    continue;
  }
  const pk = compKey(p.components);
  const match = variants.find((v: any) => compKey(v.components) === pk);
  if (!match) {
    findings.push({
      type: "COMPONENTS_DIFF", name: p.name, appBrand: p.brand,
      app: (p.components ?? []).map((c: Comp) => `${c.ingredient}: ${c.lbs}`),
      sheetVariants: variants.map((v: any) => ({ tab: v.brand, sheetName: v.name, comps: (v.components ?? []).map((c: Comp) => `${c.ingredient}: ${c.lbs}`) })),
    });
  } else {
    const shredOk = variants.some((v: any) => numish(v.shredderSetting) === numish(p.shredder_setting) || norm(v.shredderSetting) === norm(p.shredder_setting));
    if (!shredOk) findings.push({ type: "SHREDDER_DIFF", name: p.name, app: p.shredder_setting, sheets: variants.map((v: any) => `${v.brand}: ${v.shredderSetting}`) });
    const cellOk = variants.some((v: any) => numish(v.cellulose) === numish(p.cellulose) || (numish(v.cellulose) == null && numish(p.cellulose) == null));
    if (!cellOk) findings.push({ type: "CELLULOSE_DIFF", name: p.name, app: p.cellulose, sheets: variants.map((v: any) => `${v.brand}: ${v.cellulose}`) });
    // flavors: app row should carry SOME sheet's flavor set (or empty = catch-all)
    const appF = (p.flavors ?? []).map(norm).sort();
    if (appF.length > 0) {
      const union = new Set<string>();
      for (const v of variants) for (const f of v.flavors ?? []) union.add(norm(f));
      const extra = appF.filter((f: string) => !union.has(f));
      const missing = [...union].filter(f => !appF.includes(f));
      if (extra.length || missing.length) findings.push({ type: "FLAVORS_DIFF", name: p.name, appOnly: extra, sheetOnly: missing });
    }
  }
}
for (const p of prod) if (!matchedProd.has(p.name)) findings.push({ type: "EXTRA_IN_APP", name: p.name, brand: p.brand });
fs.writeFileSync("/tmp/findings_cheese.json", JSON.stringify(findings, null, 1));
console.log("findings", findings.length);
for (const f of findings) console.log(f.type, "::", f.name, f.brand ?? "", f.sheets ? JSON.stringify(f.sheets) : "");
