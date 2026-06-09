import type { RecipeRow } from "./types";

  export type MixPreset = {
    name: string;
    ingredients: RecipeRow[];
  };

  export const MIX_PRESETS: Record<string, MixPreset[]> = {
  "Bobos Deluxe": [
    {
      "name": "Bobo's Deluxe Veggie Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion, FR Strips",
          "lbs": 0.4
        },
        {
          "ingredient": "Red Peppers, FR Strips",
          "lbs": 0.82
        },
        {
          "ingredient": "Green Peppers, FR Strips",
          "lbs": 0.82
        },
        {
          "ingredient": "1/8 Green Pepper",
          "lbs": 0
        },
        {
          "ingredient": "Basil, Frozen",
          "lbs": 0.06
        },
        {
          "ingredient": "Bacon",
          "lbs": 0.75
        }
      ]
    }
  ],
  "Bobos Breakfast": [
    {
      "name": "Bobo's Breakfast Mix",
      "ingredients": [
        {
          "ingredient": "Scrambled Egg",
          "lbs": 1.75
        },
        {
          "ingredient": "Bacon (Tri Meats tm3514u or c&fb 061anub40)",
          "lbs": 0.7
        }
      ]
    }
  ],
  "Basha 11' Hawaiian": [
    {
      "name": "Corner Booth Hawaiian",
      "ingredients": [
        {
          "ingredient": "Pineapple - Drained",
          "lbs": 2
        }
      ]
    }
  ],
  "Basha 12' Supreme": [
    {
      "name": "Bashas Red Fajita Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion",
          "lbs": 0.75
        },
        {
          "ingredient": "Green Pepper Strips",
          "lbs": 0.75
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips",
          "lbs": 0.75
        },
        {
          "ingredient": "Yellow Pepper Strips",
          "lbs": 0.75
        }
      ]
    }
  ],
  "Corner Booth Chicken Alfredo": [
    {
      "name": "Corner Both Garlic Chicken",
      "ingredients": [
        {
          "ingredient": "Diced Chicken (C&F 0001mpdc40 or House of Raeford 28501)",
          "lbs": 2.98
        },
        {
          "ingredient": "Garlic Powder",
          "lbs": 0.02
        }
      ]
    }
  ],
  "Corner Booth Giardiniera": [
    {
      "name": "Corner Booth Hot Giardiniera Mix",
      "ingredients": [
        {
          "ingredient": "Hot Giardiniera Mix",
          "lbs": 1.75
        }
      ]
    }
  ],
  "Corner Booth House": [
    {
      "name": "Corner Booth House Mix",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 1
        },
        {
          "ingredient": "Mushrooms",
          "lbs": 1
        }
      ]
    }
  ],
  "Corner Booth Spinach": [
    {
      "name": "Corner Booth Spinach Mix",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 1.75
        }
      ]
    }
  ],
  "Corner Booth Supreme": [
    {
      "name": "Corner Booth White Fajita Mix",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.563
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.563
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.563
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.563
        }
      ]
    }
  ],
  "Hannaford Tikka Masala Mix": [
    {
      "name": "Hannaford White Fajita Mix",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.375
        },
        {
          "ingredient": "1/8 onion",
          "lbs": 0
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.375
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.375
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.375
        }
      ]
    },
    {
      "name": "Hannaford Chicken Masala Mix",
      "ingredients": [
        {
          "ingredient": "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
          "lbs": 2
        },
        {
          "ingredient": "Masala Sauce",
          "lbs": 0.07
        }
      ]
    }
  ],
  "Hannaford Spinach Goat Cheese": [
    {
      "name": "Hannaford Spinach",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 0.6
        }
      ]
    }
  ],
  "Hannaford Club": [
    {
      "name": "Hannaford Club Mix",
      "ingredients": [
        {
          "ingredient": "Bacon, NATURAL Tri Meats tm3514u or c&f 061anub40",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Onion",
          "lbs": 0.15
        }
      ]
    }
  ],
  "Hannaford 4Meat": [
    {
      "name": "Hannaford 4 Meat Mix",
      "ingredients": [
        {
          "ingredient": "Natural Italian Sausage c&f 140mrp240",
          "lbs": 1.5
        },
        {
          "ingredient": "Natural Hamburger burke 40029",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Lowes 7in Red Fajita": [
    {
      "name": "Lowes 7in Red Fajita",
      "ingredients": [
        {
          "ingredient": "Red Onion Diced, Blanched",
          "lbs": 0.125
        },
        {
          "ingredient": "Green Pepper Diced, Blanched",
          "lbs": 0.125
        },
        {
          "ingredient": "Red Pepper Diced, Blanched",
          "lbs": 0.125
        },
        {
          "ingredient": "Yellow Pepper Diced, Blanched",
          "lbs": 0.125
        }
      ]
    }
  ],
  "Lowes 7in White Spin": [
    {
      "name": "Lowes 7in White Spinach",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 0.8
        }
      ]
    }
  ],
  "Lowes Bacon Cheeseburger": [
    {
      "name": "Lowe's Bacon Cheeseburger Mix",
      "ingredients": [
        {
          "ingredient": "Tomatoes",
          "lbs": 0.8
        },
        {
          "ingredient": "Bacon - NATURAL tri meats tm3514u or c&f 061anub40",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Lowes California": [
    {
      "name": "Lowe's California Mix",
      "ingredients": [
        {
          "ingredient": "FR Tomatoes Diced",
          "lbs": 2.15
        },
        {
          "ingredient": "FR Red Pepper Strips",
          "lbs": 1.25
        },
        {
          "ingredient": "FR Red Onion Strips",
          "lbs": 0.6
        }
      ]
    }
  ],
  "Lowes Carribbean": [
    {
      "name": "Lowes Caribbean Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion Strip",
          "lbs": 0.7
        },
        {
          "ingredient": "FR Green Peppers Strip",
          "lbs": 0.6
        },
        {
          "ingredient": "1/8 green peppers",
          "lbs": 0
        },
        {
          "ingredient": "Jalapenos",
          "lbs": 0.2
        }
      ]
    }
  ],
  "Lowes Chicken Club": [
    {
      "name": "Lowes Chicken Club",
      "ingredients": [
        {
          "ingredient": "Tomatoes, Diced",
          "lbs": 1.25
        },
        {
          "ingredient": "Bacon, NATURAL tri meats tm3514u or c&f 061anub40",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Onion",
          "lbs": 0.2
        }
      ]
    }
  ],
  "Lowes Grilled Vegetable": [
    {
      "name": "Lowes Grilled Vegetable Mix",
      "ingredients": [
        {
          "ingredient": "FR Tomatoes Diced",
          "lbs": 2.02
        },
        {
          "ingredient": "FR Squash",
          "lbs": 0.71
        },
        {
          "ingredient": "FR Zucchini",
          "lbs": 0.71
        },
        {
          "ingredient": "Red Onions Diced",
          "lbs": 0.4
        },
        {
          "ingredient": "FR Garlic",
          "lbs": 0.1
        },
        {
          "ingredient": "Sea Salt",
          "lbs": 0.03
        },
        {
          "ingredient": "Thyme, IQF",
          "lbs": 0.03
        }
      ]
    }
  ],
  "Lowes Red Hot": [
    {
      "name": "Red Hot Chicken Mix",
      "ingredients": [
        {
          "ingredient": "Hot Sauce, Old Vienna",
          "lbs": 0.07
        },
        {
          "ingredient": "Chicken, Diced House of Raeford 28501 or c&f 001mpdc40",
          "lbs": 2.43
        }
      ]
    },
    {
      "name": "Red Hot Bacon Jalapeno Mix",
      "ingredients": [
        {
          "ingredient": "Jalapenos",
          "lbs": 0.25
        },
        {
          "ingredient": "Bacon, NATURAL c&f 001anub40 or Tri Meats",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Lowes Supreme": [
    {
      "name": "Lowes Red Fajita Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion Strips",
          "lbs": 0.35
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.35
        }
      ]
    }
  ],
  "Lowes Spinach": [
    {
      "name": "Lowes Spinach Mix",
      "ingredients": [
        {
          "ingredient": "Spinach",
          "lbs": 2.3
        },
        {
          "ingredient": "Unsalted Butter",
          "lbs": 0.24
        },
        {
          "ingredient": "Salt",
          "lbs": 0.06
        },
        {
          "ingredient": "Egg",
          "lbs": 0.3
        },
        {
          "ingredient": "Garlic, Granulated",
          "lbs": 0.1
        }
      ]
    }
  ],
  "Lowes 11in White Spinach": [
    {
      "name": "Lowes 11in White Spinach",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 2
        }
      ]
    }
  ],
  "Lucias Morming Melts Americano": [
    {
      "name": "Lucias Morning Mealts Americano",
      "ingredients": [
        {
          "ingredient": "Diced Ham patuxent-736543078",
          "lbs": 0.4
        },
        {
          "ingredient": "Scrambled Egg Greand Prairie",
          "lbs": 0.6
        }
      ]
    }
  ],
  "Lucias Morming Mealts Italiano": [
    {
      "name": "Lucia's Morning Melt Italiano Spinach",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 2
        }
      ]
    }
  ],
  "Lucias Morming Melts Mexicano": [
    {
      "name": "Lucias Morning Mealts Mexicano",
      "ingredients": [
        {
          "ingredient": "Scrambled Egg Greand Prairie",
          "lbs": 0.6
        }
      ]
    }
  ],
  "Lucias Morming Melts Parisian": [
    {
      "name": "Lucia's Morning Melt Parisian Mix",
      "ingredients": [
        {
          "ingredient": "Diced Turkey jennie-o-119373",
          "lbs": 0.2
        },
        {
          "ingredient": "Diced Ham patuxent-736543078",
          "lbs": 0.2
        }
      ]
    }
  ],
  "Lucias Craft Alfredo Spinach": [
    {
      "name": "Lucias Craft Alfredo Spinach",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 0.98
        }
      ]
    }
  ],
  "Lucias Craft Bacon Cheeseburger": [
    {
      "name": "Craft Bacon Cheeseburger Mix",
      "ingredients": [
        {
          "ingredient": "Diced Tomatoes",
          "lbs": 1.25
        },
        {
          "ingredient": "Bacon Tri Meats tm3514u or c&f 001anub40",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Lucias Craft Bratwurst": [
    {
      "name": "Lucia's Craft Bratwurst Veggie Mix",
      "ingredients": [
        {
          "ingredient": "Sauerkraut **Drained**",
          "lbs": 1.3
        },
        {
          "ingredient": "Yellow Onion, FR Strips",
          "lbs": 0.75
        },
        {
          "ingredient": "1/8 onion",
          "lbs": 0
        }
      ]
    }
  ],
  "Lucias Craft Carribbean Mix": [
    {
      "name": "Lucias Craft Caribbean Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion Strip",
          "lbs": 0.7
        },
        {
          "ingredient": "FR Green Peppers Strip",
          "lbs": 0.6
        },
        {
          "ingredient": "1/8 green peppers",
          "lbs": 0
        },
        {
          "ingredient": "Jalapenos",
          "lbs": 0.2
        }
      ]
    }
  ],
  "Lucias Craft Chicken Club": [
    {
      "name": "Craft Club Mix",
      "ingredients": [
        {
          "ingredient": "Tomatoes, FR Diced",
          "lbs": 1
        },
        {
          "ingredient": "Bacon Tri Meats tm3514u or c&f 001anub40",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Onion",
          "lbs": 0.15
        }
      ]
    }
  ],
  "Lucias Craft Red Hot": [
    {
      "name": "Red Hot Chicken Mix",
      "ingredients": [
        {
          "ingredient": "Hot Sauce, Old Vienna",
          "lbs": 0.07
        },
        {
          "ingredient": "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
          "lbs": 2.43
        }
      ]
    },
    {
      "name": "Red Hot Bacon Jalapeno Mix",
      "ingredients": [
        {
          "ingredient": "Jalapenos",
          "lbs": 0.25
        },
        {
          "ingredient": "Bacon tri meats tm3514u or c&f 001anub40",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Lucias Craft SOB": [
    {
      "name": "South of the Border Mix",
      "ingredients": [
        {
          "ingredient": "Black Beans, IQF",
          "lbs": 0.74
        },
        {
          "ingredient": "Tomatoes, Diced",
          "lbs": 0.71
        },
        {
          "ingredient": "Red Onion, FR Strips",
          "lbs": 0.71
        },
        {
          "ingredient": "Corn, FR",
          "lbs": 0.63
        },
        {
          "ingredient": "Yellow Pepper Strips",
          "lbs": 0.46
        },
        {
          "ingredient": "Cilantro",
          "lbs": 0.11
        }
      ]
    }
  ],
  "Lucias Craft Tikka Masala": [
    {
      "name": "Lucias Craft White Fajita Mix",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.37
        },
        {
          "ingredient": "1/8 onion",
          "lbs": 0
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.37
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.39
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.37
        }
      ]
    },
    {
      "name": "Lucias Craft Chicken Masala Mix",
      "ingredients": [
        {
          "ingredient": "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
          "lbs": 2
        },
        {
          "ingredient": "Masala Sauce",
          "lbs": 0.07
        }
      ]
    }
  ],
  "Lucias Buffalo Chicken": [
    {
      "name": "Lucia's Buffalo Chicken Mix",
      "ingredients": [
        {
          "ingredient": "Diced Chicken c&f 001mpdc40 or House of Raeford 28501",
          "lbs": 2.4
        },
        {
          "ingredient": "Buffalo Sauce, Legacy",
          "lbs": 0.1
        }
      ]
    }
  ],
  "Lucias Supreme": [
    {
      "name": "Lucias Red Fajita Mix",
      "ingredients": [
        {
          "ingredient": "Red Onion Strips, FR",
          "lbs": 0.75
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.75
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.75
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.75
        }
      ]
    }
  ],
  "Lucias Pinsa Tikka Masala": [
    {
      "name": "Lucias Pinsa White Fajita Mix",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.525
        },
        {
          "ingredient": "1/8 onion",
          "lbs": 0
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.525
        },
        {
          "ingredient": "1/8 green pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.525
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.525
        }
      ]
    },
    {
      "name": "Lucias Pinsa Chicken Masala Mix",
      "ingredients": [
        {
          "ingredient": "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
          "lbs": 1.93
        },
        {
          "ingredient": "Masala Sauce",
          "lbs": 0.07
        }
      ]
    }
  ],
  "Lucias Pinsa Spinach": [
    {
      "name": "Lucias Pinsa Spinach Mix",
      "ingredients": [
        {
          "ingredient": "Fresh Spinach (broken up)",
          "lbs": 1
        }
      ]
    }
  ],
  "Nob Hill SOB": [
    {
      "name": "South of the Border Mix",
      "ingredients": [
        {
          "ingredient": "Black Beans, IQF",
          "lbs": 0.74
        },
        {
          "ingredient": "Tomatoes, Diced",
          "lbs": 0.71
        },
        {
          "ingredient": "Red Onion, FR Strips",
          "lbs": 0.71
        },
        {
          "ingredient": "Corn, FR",
          "lbs": 0.63
        },
        {
          "ingredient": "Yellow Pepper Strips",
          "lbs": 0.46
        },
        {
          "ingredient": "Cilantro",
          "lbs": 0.11
        }
      ]
    }
  ],
  "Nob Hill Bacon Cheeseburger": [
    {
      "name": "Nob Hill Bacon Cheeseburger Mix",
      "ingredients": [
        {
          "ingredient": "Diced Tomatoes",
          "lbs": 1.25
        },
        {
          "ingredient": "Bacon Tri Meats tm3514u or c&f 001anub40",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Nob Hill Club": [
    {
      "name": "Craft Club Mix",
      "ingredients": [
        {
          "ingredient": "Tomatoes, Diced",
          "lbs": 1
        },
        {
          "ingredient": "Bacon Tri Meats tm3514u or c&f 001anub40",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Onion",
          "lbs": 0.15
        }
      ]
    }
  ],
  "Nob Hill Red Hot": [
    {
      "name": "Red Hot Chicken Mix",
      "ingredients": [
        {
          "ingredient": "Hot Sauce, Old Vienna",
          "lbs": 0.07
        },
        {
          "ingredient": "Chicken, Diced c&f - 001mpdc40 or House of Raeford - 28501",
          "lbs": 2.43
        }
      ]
    },
    {
      "name": "Red Hot Bacon Jalapeno Mix",
      "ingredients": [
        {
          "ingredient": "Jalapenos",
          "lbs": 0.25
        },
        {
          "ingredient": "Bacon tri meats tm3514u or c&f 001anub40",
          "lbs": 0.5
        }
      ]
    }
  ],
  "Nob Hill Caribbean": [
    {
      "name": "Nob Hill Caribbean Mix",
      "ingredients": [
        {
          "ingredient": "FR Red Onion Strip",
          "lbs": 0.7
        },
        {
          "ingredient": "FR Green Peppers Strip",
          "lbs": 0.6
        },
        {
          "ingredient": "1/8 green peppers",
          "lbs": 0
        },
        {
          "ingredient": "Jalapenos",
          "lbs": 0.2
        }
      ]
    }
  ],
  "Price Chopper Club": [
    {
      "name": "Price Chopper Club Mix",
      "ingredients": [
        {
          "ingredient": "Bacon Tri Meats tm3514u or c&f 061anub40",
          "lbs": 0.7
        },
        {
          "ingredient": "Green Onion",
          "lbs": 0.15
        }
      ]
    }
  ],
  "SMD Supreme": [
    {
      "name": "SMD Supreme",
      "ingredients": [
        {
          "ingredient": "White Onion Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "1/8 onion",
          "lbs": 0
        },
        {
          "ingredient": "Green Pepper Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "1/8 Green Pepper",
          "lbs": 0
        },
        {
          "ingredient": "Red Pepper Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "Yellow Pepper Strips, Blanched",
          "lbs": 0.35
        },
        {
          "ingredient": "Black Olives",
          "lbs": 0.5
        }
      ]
    }
  ]
};

  export const SEED_MIX_PRESET_NAMES: string[] = [
  "Bashas Red Fajita Mix",
  "Bobo's Breakfast Mix",
  "Bobo's Deluxe Veggie Mix",
  "Corner Booth Hawaiian",
  "Corner Booth Hot Giardiniera Mix",
  "Corner Booth House Mix",
  "Corner Booth Spinach Mix",
  "Corner Booth White Fajita Mix",
  "Corner Both Garlic Chicken",
  "Craft Bacon Cheeseburger Mix",
  "Craft Club Mix",
  "Hannaford 4 Meat Mix",
  "Hannaford Chicken Masala Mix",
  "Hannaford Club Mix",
  "Hannaford Spinach",
  "Hannaford White Fajita Mix",
  "Lowe's Bacon Cheeseburger Mix",
  "Lowe's California Mix",
  "Lowes 11in White Spinach",
  "Lowes 7in Red Fajita",
  "Lowes 7in White Spinach",
  "Lowes Caribbean Mix",
  "Lowes Chicken Club",
  "Lowes Grilled Vegetable Mix",
  "Lowes Red Fajita Mix",
  "Lowes Spinach Mix",
  "Lucia's Buffalo Chicken Mix",
  "Lucia's Craft Bratwurst Veggie Mix",
  "Lucia's Morning Melt Italiano Spinach",
  "Lucia's Morning Melt Parisian Mix",
  "Lucias Craft Alfredo Spinach",
  "Lucias Craft Caribbean Mix",
  "Lucias Craft Chicken Masala Mix",
  "Lucias Craft White Fajita Mix",
  "Lucias Morning Mealts Americano",
  "Lucias Morning Mealts Mexicano",
  "Lucias Pinsa Chicken Masala Mix",
  "Lucias Pinsa Spinach Mix",
  "Lucias Pinsa White Fajita Mix",
  "Lucias Red Fajita Mix",
  "Nob Hill Bacon Cheeseburger Mix",
  "Nob Hill Caribbean Mix",
  "Price Chopper Club Mix",
  "Red Hot Bacon Jalapeno Mix",
  "Red Hot Chicken Mix",
  "SMD Supreme",
  "South of the Border Mix"
];

  // Normalize helper: strip apostrophes/special chars, lowercase, collapse spaces
  function norm(s: string): string {
    return s.toLowerCase().replace(/[\u2019'&]/g, "").replace(/\s+/g, " ").trim();
  }

  // Some brands in the app are sub-brands that appear as "Lucias X" in the xlsx
  const BRAND_ALIAS: Record<string, string> = {
    craft: "lucias craft",
    "morning melts": "lucias morming melts",
    pinsa: "lucias pinsa",
  };

  // Fix typos in tab names so normalization can match them
  const TAB_NORM_FIXES: Record<string, string> = {
    "lucias morming mealts italiano": "lucias morming melts italiano",
    "lowes carribbean": "lowes caribbean",
    "lucias craft carribbean mix": "lucias craft caribbean mix",
  };

  /** Return the mix presets for the given brand+flavor, or [] if no match. */
  export function findMixPresets(brand: string, flavor: string): MixPreset[] {
    if (!brand && !flavor) return [];
    const resolvedBrand = BRAND_ALIAS[norm(brand)] ?? norm(brand);
    const query = norm(resolvedBrand + " " + flavor);
    if (!query.trim()) return [];
    for (const [tabName, presets] of Object.entries(MIX_PRESETS)) {
      const raw = norm(tabName);
      const tabNorm = TAB_NORM_FIXES[raw] ?? raw;
      if (tabNorm === query || tabNorm.startsWith(query + " ")) {
        return presets;
      }
    }
    return [];
  }
  