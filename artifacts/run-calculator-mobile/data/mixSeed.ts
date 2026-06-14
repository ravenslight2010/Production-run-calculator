import type { RecipeRow } from "@/context/RunContext";
import { SEED_MIX_PRESET_NAMES } from "./mixPresets";

export type MixProfile = {
  brand: string;
  flavor: string;
  recipeName: string;
  recipe: RecipeRow[];
};

export const MIX_SEED: {
  brands: string[];
  brandFlavors: Record<string, string[]>;
  frontlineRecipeNames: string[];
  frontlineIngredients: string[];
  frontlineRecipePresets: Record<string, RecipeRow[]>;
  mixRecipeNames: string[];
  profiles: MixProfile[];
} = {
  brands: ["Basha","Bobo's","Corner Booth","Craft","Hannaford","Lowe's","Lucia's","Morning Melts","Nob Hill","Pinsa","Price Chopper","SMD"],

  brandFlavors: {
    "Bobo's": ["Deluxe","Breakfast"],
    "Basha": ["11' Hawaiian","12' Supreme"],
    "Corner Booth": ["Chicken Alfredo","Giardiniera","House","Pep & Jal","Spinach","Supreme"],
    "Hannaford": ["Tikka Masala","Spinach Goat Cheese","Club","4Meat"],
    "Lowe's": ["7in Red Fajita","7in White Spin","Bacon Cheeseburger","California","Caribbean","Chicken Club","Grilled Vegetable","Red Hot","Spinach","11in White Spinach"],
    "Craft": ["Alfredo Spinach","Bacon Cheeseburger","Bratwurst","Caribbean","Chicken Club","Red Hot","SOB","Tikka Masala"],
    "Morning Melts": ["Americano","Italiano","Mexicano","Parisian"],
    "Pinsa": ["Margherita","Spinach","Tikka Masala"],
    "Lucia's": ["Buffalo Chicken","Supreme"],
    "Nob Hill": ["SOB","Bacon Cheeseburger","Club","Red Hot","Caribbean"],
    "Price Chopper": ["Club"],
    "SMD": ["Supreme"],
  },

  frontlineRecipeNames: [],
  frontlineIngredients: [
    // Canonical names
    "Bacon - Cured / Tri Meats tm3514u or c&f 001anub40",
    "Bacon - Natural / Tri Meats tm3514u or c&f 061anub40",
    // Legacy / variant Bacon names used by mix presets
    "Bacon",
    "Bacon (Tri Meats tm3514u or c&fb 061anub40)",
    "Bacon - NATURAL tri meats tm3514u or c&f 061anub40",
    "Bacon Tri Meats tm3514u or c&f 001anub40",
    "Bacon Tri Meats tm3514u or c&f 061anub40",
    "Bacon tri meats tm3514u or c&f 001anub40",
    "Bacon, NATURAL c&f 001anub40 or Tri Meats",
    "Bacon, NATURAL Tri Meats tm3514u or c&f 061anub40",
    "Bacon, NATURAL tri meats tm3514u or c&f 061anub40",
    "Basil, Frozen","Black Beans, IQF","Black Olives","Buffalo Sauce, Legacy",
    "Canadian Bacon Stick / Stonie's - 2398",
    // Chicken variants
    "Chicken, Diced / c&f 001mpdc40 or House of Raeford 28501",
    "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
    "Chicken, Diced House of Raeford 28501 or c&f 001mpdc40",
    "Diced Chicken (C&F 0001mpdc40 or House of Raeford 28501)",
    "Diced Chicken c&f 001mpdc40 or House of Raeford 28501",
    "Cilantro","Corn, FR",
    // Diced Ham/Turkey variants
    "Diced Ham / patuxent-736543078",
    "Diced Ham patuxent-736543078",
    "Diced Turkey / jennie-o-119373",
    "Diced Turkey jennie-o-119373",
    "Drained Pineapples","Diced Tomatoes","Egg",
    "FR Garlic","FR Green Peppers Strip","FR Red Onion Strip","FR Red Onion Strips",
    "FR Red Pepper Strips","FR Squash","FR Tomatoes Diced","FR Zucchini",
    "Fresh Spinach (broken up)","Garlic Powder","Garlic sauce","Garlic, Granulated",
    "Goat Cheese","Green Onion","Masala Sauce","Green Pepper Diced, Blanched","Green Pepper Strips",
    "Green Pepper Strips, Blanched","Green Peppers, FR Strips","Hot Giardiniera Mix",
    "Hot Sauce, Old Vienna","Jalapenos","Mushrooms",
    // Hamburger/Sausage variants
    "Natural Hamburger / burke 40029",
    "Natural Hamburger burke 40029",
    "Natural Italian Sausage / c&f 140mrp240",
    "Natural Italian Sausage c&f 140mrp240",
    "Pineapple - Drained","Red Onion","Red Onion Diced, Blanched","Red Onion Strip",
    "Red Onion Strips","Red Onion Strips, FR","Red Onion, FR Strips","Red Onions Diced",
    "Red Pepper Diced, Blanched","Red Pepper Strips","Red Pepper Strips, Blanched",
    "Red Peppers, FR Strips","Salt","Sauerkraut **Drained**",
    // Scrambled Egg variants
    "Scrambled Egg",
    "Scrambled Egg Greand Prairie",
    "Scrambled Egg / Greand Prairie",
    "Sea Salt","Spinach","Swiss","Thyme, IQF",
    "Tomatoes","Tomatoes, Diced","Tomatoes, FR Diced","Unsalted Butter","White Onion Strips, Blanched",
    "Yellow Onion, FR Strips","Yellow Pepper Diced, Blanched","Yellow Pepper Strips",
    "Yellow Pepper Strips, Blanched",
    // Portion/fraction ingredients used by mix presets
    "1/8 Green Pepper",
    "1/8 green pepper",
    "1/8 green peppers",
    "1/8 onion",
  ],
  frontlineRecipePresets: {},

  mixRecipeNames: SEED_MIX_PRESET_NAMES,

  profiles: [],
};
