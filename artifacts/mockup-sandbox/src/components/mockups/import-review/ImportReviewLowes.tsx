import { useState } from "react";
import {
  CheckCircle2,
  Wand2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Egg,
  Bean,
  Layers,
} from "lucide-react";

const AMBER = "#FF9500";

type Item = {
  kind: "dough" | "sauce" | "cheese" | "topping" | "pep";
  raw: string;
  clean: string;
  oz: number | string;
  components?: { name: string; oz: number }[];
};

type Flavor = {
  name: string;
  die: string;
  allergen?: string;
  target: number;
  range: string;
  items: Item[];
};

const c = (name: string, oz: number) => ({ name, oz });

const FLAVORS: Flavor[] = [
  {
    name: "CALIFORNIAN", die: '11" Dies', target: 15.4, range: "15.15 – 15.65",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "topping", raw: "Applicator - California Mix", clean: "California Mix", oz: 4,
        components: [c("FR Tomatoes Diced", 2.15), c("FR Red Pepper Strips", 1.25), c("FR Red Onions Strips", 0.6)] },
      { kind: "cheese", raw: "Applicator - Lowe's California Cheese Mix", clean: "Lowe's California Cheese Mix", oz: 4.7,
        components: [c("Whole Mozzarella", 1.2), c("Provolone", 1.2), c("Fontina", 1.2), c("Goat", 1.01), c("Frozen Basil", 0.09)] },
    ],
  },
  {
    name: "GRILLED VEGETABLE", die: '11" Dies', target: 14.9, range: "14.65 – 15.15",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "topping", raw: "Applicator - Grilled Vegetable Mix", clean: "Grilled Vegetable Mix", oz: 4,
        components: [c("FR Tomatoes Diced", 2.02), c("Zucchini", 0.71), c("Squash", 0.71), c("Red Onion Diced", 0.4), c("Frozen FR Garlic", 0.1), c("Frozen Thyme", 0.03), c("Sea Salt", 0.03)] },
      { kind: "cheese", raw: "Applicator - Lowe's Grilled Vegetable Cheese Mix", clean: "Lowe's Grilled Vegetable Cheese Mix", oz: 4.2,
        components: [c("Whole Mozzarella", 1.4), c("Provolone", 1.4), c("Fontina", 1.4)] },
    ],
  },
  {
    name: "PEPPERONI", die: '11" Dies', target: 15.45, range: "15.2 – 15.7",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "sauce", raw: "Lucia's Sauce (Lucia's Recipe)", clean: "Lucia's Sauce", oz: 3 },
      { kind: "cheese", raw: "Applicator - Lowe's Pepperoni Cheese Mix", clean: "Lowe's Pepperoni Cheese Mix", oz: 2.5,
        components: [c("Part Skim Mozzarella", 1.56), c("Provolone", 0.94)] },
      { kind: "pep", raw: "Pepperoni Stick - NATURAL (Hormel - 24878)", clean: "Pepperoni Stick — Natural", oz: "19 pcs = 1.5 oz" },
      { kind: "cheese", raw: "Applicator - Lowe's Pepperoni/Romano Cheese Mix", clean: "Lowe's Pepperoni/Romano Cheese Mix", oz: 1.75,
        components: [c("Part Skim Mozzarella", 0.94), c("Provolone", 0.56), c("Sheep Romano", 0.25)] },
    ],
  },
  {
    name: "FIVE CHEESE", die: '11" Dies', target: 15.2, range: "14.95 – 15.45",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "sauce", raw: "Lucia's Sauce (Lucia's Recipe)", clean: "Lucia's Sauce", oz: 3.5 },
      { kind: "cheese", raw: "Applicator - Lowe's/Hannaford 5Cheese Mix (×2 stations)", clean: "Lowe's/Hannaford 5 Cheese Mix — 2 stations @ 2.5 oz", oz: 5,
        components: [c("Whole Milk Mozzarella", 1.97), c("White Cheddar", 0.49), c("Three Cheese Blend", 0.04), c("5 Cheese Spice Blend", 0.005)] },
    ],
  },
  {
    name: "BBQ CHICKEN", die: '11" Dies', target: 14.55, range: "14.30 – 14.80",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "sauce", raw: "BBQ Sauce (Legacy)", clean: "BBQ Sauce", oz: 2.25 },
      { kind: "topping", raw: "Applicator - Diced Chicken (C&F / House of Raeford)", clean: "Diced Chicken", oz: 2 },
      { kind: "topping", raw: "Applicator - Red Onion Diced", clean: "Red Onion Diced", oz: 0.5 },
      { kind: "cheese", raw: "Applicator - BBQ Chicken Cheese Mix", clean: "BBQ Chicken Cheese Mix", oz: 3.1,
        components: [c("Monterey Jack", 3.0), c("Cilantro", 0.1)] },
    ],
  },
  {
    name: "WHITE SPINACH", die: '11" Dies', target: 13.8, range: "13.55 – 14.05",
    items: [
      { kind: "dough", raw: 'Parbake Crust (11" CRB recipe - 11" Dies)', clean: "CRB", oz: 6.7 },
      { kind: "sauce", raw: "Alfredo Sauce Recipe (UFI - Made in House)", clean: "Alfredo Sauce", oz: 2 },
      { kind: "topping", raw: "Applicator - Part Skim Mozzarella", clean: "Part Skim Mozzarella", oz: 2 },
      { kind: "cheese", raw: "Applicator - Lowe's Spinach Cheese Mix", clean: "Lowe's Spinach Cheese Mix", oz: 3.1,
        components: [c("Part Skim Mozzarella", 1.0), c("Fresh Spinach", 2.0), c("Nutmeg", 0.1)] },
    ],
  },
  {
    name: "SPINACH & MUSHROOM", die: '11" Dies', allergen: "EGG", target: 26, range: "25.75 – 26.25",
    items: [
      { kind: "dough", raw: 'Parbake crust (Heavier CRB Recipe - 11" Dies)', clean: "Heavier CRB", oz: 12 },
      { kind: "sauce", raw: "Sauce (Lucia Recipe)", clean: "Lucia's Sauce", oz: 5 },
      { kind: "cheese", raw: "Applicator - Lowe's Spinach Mushroom Cheese Mix (station 1)", clean: "Lowe's Spinach Mushroom Cheese Mix — station 1", oz: 3,
        components: [c("Part Skim Milk Mozzarella", 1.5), c("White Cheddar", 1.5)] },
      { kind: "topping", raw: "Applicator - IQF Mushrooms", clean: "IQF Mushrooms", oz: 1 },
      { kind: "cheese", raw: "Applicator - Lowe's Spinach Mushroom Cheese Mix (station 2)", clean: "Lowe's Spinach Mushroom Cheese Mix — station 2", oz: 2,
        components: [c("Part Skim Milk Mozzarella", 1.0), c("White Cheddar", 1.0)] },
      { kind: "topping", raw: "Applicator - Mystic Spinach Mix", clean: "Mystic Spinach Mix", oz: 3,
        components: [c("Spinach", 2.3), c("Butter", 0.3), c("Liquid Egg", 0.3), c("Granulated Garlic", 0.1)] },
    ],
  },
  {
    name: "RED HOT CHICKEN", die: "Argus Dies", target: 24.26, range: "24.01 – 24.51",
    items: [
      { kind: "dough", raw: "Parbake crust (Thick Malted Barley recipe - Argus Dies)", clean: "Thick Malted Barley", oz: 13 },
      { kind: "sauce", raw: "Sauce (Four Hands Red Hot Recipe)", clean: "Four Hands Red Hot Sauce", oz: 3 },
      { kind: "topping", raw: "Applicator - 4hands Red Hot Chicken Mix", clean: "4 Hands Red Hot Chicken Mix", oz: 2.5,
        components: [c("Diced Chicken", 2.43), c("Vienna Red Hot Sauce", 0.07)] },
      { kind: "topping", raw: "Applicator - 4Hands Red Hot Mix", clean: "4 Hands Red Hot Mix", oz: 0.75,
        components: [c("Natural Bacon", 0.5), c("Jalapenos", 0.25)] },
      { kind: "cheese", raw: "Applicator - Red Hot Cheese Mix", clean: "Red Hot Cheese Mix", oz: 5.01,
        components: [c("Monterey Jack", 5.0), c("Riplet Seasoning", 0.01)] },
    ],
  },
  {
    name: "MARGHERITA", die: '11" Dies', target: 21.85, range: "21.6 – 22.1",
    items: [
      { kind: "dough", raw: 'Parbake crust (Margherita Dough Recipe - 11" Dies)', clean: "Margherita Dough", oz: 10 },
      { kind: "sauce", raw: "Sauce (Lucia Recipe)", clean: "Lucia's Sauce", oz: 5 },
      { kind: "cheese", raw: "Applicator - Margherita Cheese Mix (×2 stations)", clean: "Margherita Cheese Mix — 2 stations @ 2.55 oz", oz: 5.1,
        components: [c("Whole Milk Mozzarella", 2.5), c("IQF Basil", 0.05)] },
      { kind: "topping", raw: "Applicator - Fire Roasted Tomatoes", clean: "Fire Roasted Tomatoes", oz: 1.75 },
    ],
  },
  {
    name: "CARIBBEAN", die: '11" Dies', allergen: "SOY", target: 25.15, range: "24.9 – 25.4",
    items: [
      { kind: "dough", raw: 'Parbake Crust (CRB Heavy Plus recipe - 11" Dies)', clean: "CRB Heavy Plus", oz: 11 },
      { kind: "sauce", raw: "Sweet n Sour Sauce (Legacy)", clean: "Sweet n Sour Sauce", oz: 4.25 },
      { kind: "topping", raw: "Applicator - Diced Chicken", clean: "Diced Chicken", oz: 3 },
      { kind: "topping", raw: "Applicator - Pineapple", clean: "Pineapple", oz: 0.75 },
      { kind: "topping", raw: "Applicator - Carribean Mix", clean: "Caribbean Mix", oz: 1.5,
        components: [c("Red Onion Strips", 0.7), c("FR Green Pepper Strips", 0.6), c("Jalapenos", 0.2)] },
      { kind: "cheese", raw: "Applicator - Lucia's Craft Caribbean Cheese Mix", clean: "Lucia's Craft Caribbean Cheese Mix", oz: 4.65,
        components: [c("Whole Mozzarella", 2.25), c("Provolone", 2.25), c("Cilantro", 0.15)] },
    ],
  },
  {
    name: "MEAT LOVERS", die: "Argus Dies", target: 23.55, range: "23.3 – 23.8",
    items: [
      { kind: "dough", raw: "Parbake crust (Thick Malted Barley recipe - Argus Dies)", clean: "Thick Malted Barley", oz: 13 },
      { kind: "sauce", raw: "Sauce (Lucia's Recipe)", clean: "Lucia's Sauce", oz: 4 },
      { kind: "topping", raw: "Applicator - Natural Italian Sausage (C&F)", clean: "Natural Italian Sausage", oz: 1.5 },
      { kind: "topping", raw: "Applicator - Mozzarella Part Skim (station 1)", clean: "Part Skim Mozzarella — station 1", oz: 1.25 },
      { kind: "pep", raw: "Pepperoni Stick - Natural (Hormel - 24878)", clean: "Pepperoni Stick — Natural", oz: "9 pcs = 0.8 oz" },
      { kind: "topping", raw: "Applicator - Natural Bacon (Tri Meats / C&F)", clean: "Natural Bacon", oz: 1 },
      { kind: "topping", raw: "Applicator - Mozzarella Part Skim (station 2)", clean: "Part Skim Mozzarella — station 2", oz: 2 },
    ],
  },
  {
    name: "SUPREME", die: "Argus Dies", target: 23.45, range: "23.20 – 23.70",
    items: [
      { kind: "dough", raw: "Parbake crust (Thick Malted Barley recipe - Argus Dies)", clean: "Thick Malted Barley", oz: 13 },
      { kind: "sauce", raw: "Sauce (Lucia's Recipe)", clean: "Lucia's Sauce", oz: 4 },
      { kind: "topping", raw: "Applicator - Natural Italian Sausage (C&F)", clean: "Natural Italian Sausage", oz: 1 },
      { kind: "topping", raw: "Applicator - Mozzarella Part Skim (station 1)", clean: "Part Skim Mozzarella — station 1", oz: 1.25 },
      { kind: "pep", raw: "Pepperoni Stick - Natural (Hormel - 24878)", clean: "Pepperoni Stick — Natural", oz: "9 pcs = 0.80 oz" },
      { kind: "topping", raw: "Applicator - Red Fajita Blend", clean: "Red Fajita Blend", oz: 1.4,
        components: [c("Red Onion Strips", 0.35), c("Green Pepper Strips", 0.35), c("Red Pepper Strips", 0.35), c("Yellow Pepper Strips", 0.35)] },
      { kind: "topping", raw: "Applicator - Mozzarella Part Skim (station 2)", clean: "Part Skim Mozzarella — station 2", oz: 2 },
    ],
  },
  {
    name: "BUFFALO CHICKEN", die: "Argus Dies", allergen: "EGG", target: 22.7, range: "22.45 – 22.95",
    items: [
      { kind: "dough", raw: "Parbake crust (Thick Malted Barley recipe - Argus Dies)", clean: "Thick Malted Barley", oz: 13 },
      { kind: "sauce", raw: "Buffalo Ranch Sauce (Legacy)", clean: "Buffalo Ranch Sauce", oz: 3 },
      { kind: "topping", raw: "Applicator - Diced Chicken", clean: "Diced Chicken", oz: 2 },
      { kind: "topping", raw: "Applicator - Diced Celery", clean: "Diced Celery", oz: 0.7 },
      { kind: "cheese", raw: "Applicator - Monterey Jack Cheese", clean: "Monterey Jack", oz: 4 },
    ],
  },
  {
    name: "CHICKEN BACON RANCH", die: "Argus Dies", allergen: "EGG", target: 24.9, range: "24.65 – 25.15",
    items: [
      { kind: "dough", raw: "Parbake crust (Thick Malted Barley recipe - Argus Dies)", clean: "Thick Malted Barley", oz: 13 },
      { kind: "sauce", raw: "Ranch Sauce (Legacy)", clean: "Ranch Sauce", oz: 3.25 },
      { kind: "topping", raw: "Applicator - Diced Chicken", clean: "Diced Chicken", oz: 2.5 },
      { kind: "topping", raw: "Applicator - Lowe's Chicken Bacon Ranch Mix", clean: "Lowe's Chicken Bacon Ranch Mix", oz: 2.15,
        components: [c("Diced Tomatoes", 1.25), c("Natural Bacon", 0.7), c("Green Onion", 0.2)] },
      { kind: "cheese", raw: "Applicator - Lowe's Club Cheese Mix", clean: "Lowe's Club Cheese Mix", oz: 4,
        components: [c("Skim Mozzarella", 2), c("Yellow Cheddar", 2)] },
    ],
  },
  {
    name: "BACON CHEESEBURGER", die: "Argus Dies", allergen: "EGG", target: 24.8, range: "24.55 – 25.05",
    items: [
      { kind: "dough", raw: "Parbake Crust (Lowe's French Fry recipe - Argus Dies)", clean: "Lowe's French Fry", oz: 14 },
      { kind: "sauce", raw: "Cheeseburger Sauce (Legacy)", clean: "Cheeseburger Sauce", oz: 3.5 },
      { kind: "topping", raw: "Applicator - Beef Topping (Burke 40029)", clean: "Beef Topping", oz: 2 },
      { kind: "topping", raw: "Applicator - Lowe's Cheeseburger Mix", clean: "Lowe's Cheeseburger Mix", oz: 1.3,
        components: [c("Tomatoes", 0.8), c("Natural Bacon", 0.5)] },
      { kind: "cheese", raw: "Applicator - Cheeseburger Cheese Mix", clean: "Cheeseburger Cheese Mix", oz: 4,
        components: [c("Whole Mozzarella", 2), c("Yellow Cheddar", 2)] },
    ],
  },
];

const KIND_LABEL: Record<Item["kind"], { label: string; cls: string }> = {
  dough: { label: "DOUGH", cls: "bg-yellow-100 text-yellow-800" },
  sauce: { label: "SAUCE", cls: "bg-red-100 text-red-700" },
  cheese: { label: "CHEESE MIX", cls: "bg-amber-100 text-amber-800" },
  topping: { label: "TOPPING", cls: "bg-green-100 text-green-700" },
  pep: { label: "PEP STICK", cls: "bg-rose-100 text-rose-700" },
};

export function ImportReviewLowes() {
  const [open, setOpen] = useState<string | null>("CALIFORNIAN");

  const cheeseMixes = new Set<string>();
  FLAVORS.forEach((f) =>
    f.items.forEach((i) => {
      if (i.kind === "cheese" && i.components) cheeseMixes.add(i.clean.split(" — ")[0]);
    }),
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6" style={{ color: AMBER }} />
              <h1 className="text-2xl font-bold text-gray-900">
                Review Import — Lowe's Pizza Recipe Specs
              </h1>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Rev 28 · 03/02/26 · 11&Prime; Lowe's Pizzas · Nothing is saved until you confirm.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
              15 flavors found
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {cheeseMixes.size} cheese mixes detected
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Wand2 className="h-4 w-4" style={{ color: AMBER }} />
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Name cleanup applied
            </span>
          </div>
          <ul className="space-y-1 text-sm text-gray-700">
            <li>
              <span className="font-mono text-gray-400 line-through">Parbake Crust (11&Prime; CRB recipe - 11&Prime; Dies)</span>{" "}
              → <b>CRB</b> <span className="text-gray-500">(size dropped; die kept separately: 11&Prime; Dies)</span>
            </li>
            <li>
              Each dough links to your existing dough recipe — <b>doughball weight and trays come from
              the recipe</b>, not the spec sheet.
            </li>
            <li>
              <span className="font-mono text-gray-400 line-through">Lucia's Sauce (Lucia's Recipe)</span> → <b>Lucia's Sauce</b>
              <span className="text-gray-500"> · "(Legacy)" and "(Made in House)" suffixes dropped from all sauces</span>
            </li>
            <li>
              Vendor codes like <span className="font-mono text-gray-400">(Hormel - 24878)</span>,{" "}
              <span className="font-mono text-gray-400">(C&amp;F - 001MPDC40)</span> removed from item names.
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5" style={{ color: AMBER }} />
              <h2 className="text-lg font-semibold text-gray-900">Flavors ({FLAVORS.length})</h2>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Cheese mixes are stored as blends — each ingredient's oz/pizza comes from this flavor's
              applicator target, so every flavor gets its own numbers.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            {FLAVORS.map((f) => {
              const isOpen = open === f.name;
              const sum = f.items.reduce((s, i) => s + (typeof i.oz === "number" ? i.oz : parseFloat(String(i.oz).split("= ")[1]) || 0), 0);
              return (
                <div key={f.name}>
                  <button
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    onClick={() => setOpen(isOpen ? null : f.name)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="font-semibold text-gray-900">{f.name}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">{f.die}</span>
                      {f.allergen && (
                        <span className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-semibold text-purple-700">
                          {f.allergen === "EGG" ? <Egg className="h-3 w-3" /> : <Bean className="h-3 w-3" />}
                          {f.allergen} ALLERGEN
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500">
                        target <span className="font-mono font-semibold text-gray-900">{f.target} oz</span>
                        <span className="ml-2 text-xs text-gray-400">spec {f.range}</span>
                      </span>
                      {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 bg-gray-50/70 px-4 pb-4 pt-1">
                      {f.items.map((it, idx) => (
                        <div key={idx} className="rounded-md border border-gray-200 bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${KIND_LABEL[it.kind].cls}`}>
                                {KIND_LABEL[it.kind].label}
                              </span>
                              <span className="font-medium text-gray-900">{it.clean}</span>
                            </div>
                            <span className="font-mono text-sm font-semibold" style={{ color: AMBER }}>
                              {typeof it.oz === "number" ? `${it.oz} oz` : it.oz}
                            </span>
                          </div>
                          {it.raw !== it.clean && (
                            <div className="mt-1 text-xs text-gray-400">
                              from: <span className="font-mono line-through">{it.raw}</span>
                            </div>
                          )}
                          {it.kind === "dough" && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-blue-100 bg-blue-50/70 px-2 py-1.5 text-xs text-blue-800">
                              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                LINKED TO DOUGH RECIPE
                              </span>
                              <span>
                                Lowe's on <b>{it.clean}</b> → doughball weight &amp; trays pulled from that recipe
                              </span>
                            </div>
                          )}
                          {it.components && (
                            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 border-t border-dashed border-gray-200 pt-2 md:grid-cols-3">
                              {it.components.map((cm) => (
                                <div key={cm.name} className="flex justify-between text-xs text-gray-600">
                                  <span>{cm.name}</span>
                                  <span className="font-mono">{cm.oz}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex justify-end pr-1 text-xs text-gray-500">
                        components sum ≈ <span className="ml-1 font-mono font-semibold text-gray-800">{sum.toFixed(2)} oz</span>
                        <span className="ml-2">vs target <span className="font-mono font-semibold text-gray-800">{f.target} oz</span></span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pb-4">
          <button className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white shadow-sm" style={{ backgroundColor: AMBER }}>
            Confirm Import — 15 flavors
          </button>
        </div>
      </div>
    </div>
  );
}
