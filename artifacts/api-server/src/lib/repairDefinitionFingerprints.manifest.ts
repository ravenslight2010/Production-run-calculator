/**
 * Reviewed fingerprints for released automatic repair definitions.
 *
 * A mismatch requires either a new versioned repair id or an explicit review
 * and update of this manifest. The source-library plan payload is intentionally
 * absent because its independent immutable digest is verified separately.
 *
 * Preview: pnpm --filter @workspace/api-server run repair-fingerprints
 * Rewrite after approval: pnpm --filter @workspace/api-server run repair-fingerprints:write
 */
export const RELEASED_AUTOMATIC_REPAIR_FINGERPRINTS: Readonly<Record<string, string>> = Object.freeze({
  "data-heal-result-backfill-v1": "31d76e56dc6815fa7a7295eb6c8f8b08c08e78c32267c8b8d12d5b2677422760",
  "ingredient-active-name-dedupe-v1": "439f39212423c092e1191c68c60ba68b9365cbb41f9fdabcb9ff66af370d95ed",
  "live-profile-recipe-link-repair-v1": "29e5d53b5908bf9c01fedf34b7f00c02a0040678993670a48c8c1951a193fae0",
  "crb-ingredient-conversion-v1": "6945e2f6d6fc768a49811886d43b602fd3fc0ec0184c67d886306ba046785d53",
  "crb-dough-family-consolidation-v1": "473ff746f3679b28f4b9b6da4b880450f033b099eb03897b4d398160d43b5df1",
  "cheese-import-poison-cleanup-v1": "7b3e8525f4ea343bdf4549b5ba7fdeccb9da2913a84023c319f4b138c6cb6a24",
  "spec-alias-hygiene-purge-v1": "49ebe339e9959179e30e2b73d66642d2e28e6707b3b5f58b24a8d46b3b29bf56",
  "cheese-recipe-name-dedupe-v1": "3633c81b25d3b682dfe64dec90fcd4c8fba1784ec125b8c30e9e4cd46f659daf",
  "generic-mix-poison-purge-v2": "1f47fa5c13e8c3ed928bfaa5411ae47bd585825bd765438c45101afcdd477261",
  "cheese-named-mix-crossover-purge-v1": "9f6e06bebe3d777fa9d8279fb8e1d4f2ae0ec053ee5294ca9726ce1ac78187fd",
  "cheese-share-backfill-v1": "9598c0669803f5ae5d2ab39f12c5e2eb2b2c91af7a9c5c0c958a6413627cdce0",
  "cheese-oz-depoison-v1": "745996d6568bafc6a9e00b3b92e3ff8c2e0271a5ed1499a3171c237100fb8aec",
  "named-recipe-name-cleanup-v1": "706033944c987079a9182581b281ae47d1235de3b183a60e8c0d19ffb31c1de9",
  "dough-batch-yield-depoison-v1": "0370dcb50650d761a6b758127dfa43a878bbb4bf6f1650e38a250e41990976d7",
  "dough-family-weight-depoison-v1": "5deadbb93258e6f4b8253eae2eb37bc749571aa617e5780b0eb47d22798bb7e7",
  "smd-pep-cheese-mix-restore-v1": "55025e63452350379a55b3d867b6ad1eb42c3154853180398377717243a92f9a",
  "sea-salt-alias-undo-v1": "353b13d6c73f324847a0bfc2107a2147eeebe1b43202590f0b4cff4bd72490f6",
  "mix-duplicate-name-purge-v1": "cc35c1d724d4dbd59649a2689e673d86cf32d4626886e729680cf9f5443972bf",
  "purchased-crust-die-heal-v1": "757add5e62084fc93975df8d64ed10a9c288987c20529afc3dc5caa6990011fd",
  "dough-variant-suffix-dedupe-v1": "c58fbdaf51e910cb75800357ea4f1b696d684b3911d536c84c67746938b19869",
  "dough-merge-vanish-restore-v1": "496bb5a34b1abc45c2ac984c2865c0306a51b95425c237c6c59f3151d78cc18c",
  "bogus-merge-alias-purge-v1": "334257e555750b1d9ea49cb0402ee9fb6bee064f4f25f06536b614796a220370",
  "basha-hannaford-crosslink-parse-purge-v1": "8f41a531f17517aace4177206a14c170d093391426f9debdc40cd11210c13fea",
  "aldo-cheese-tolerance-oz-v1": "baa40815294c2906ab1b7c9c8345df09a2122914a00e2c8a2b1bb9dc26faabdd",
  "bobo-cross-family-alias-undo-v1": "1c9dfc15951568e3eae23a30bfba15b434b862ea903bbe32a7f3a2f536386efe",
  "lowes-natural-pep-name-v1": "23e38b06ea364dc31c8025cfb87f3479defa67eccfe2356623b58b02fb57d6d2",
  "brand-fan-dough-depoison-v1": "17440bad5ddd059a346e6f08ba1b6f7ff9deaab75710c2f1296631aa2eef9830",
  "brand-drift-rename-v1": "fe17f08707bcc4ba12f4631e9e108f775287ca7e6dbe3d030de6d03123514200",
  "crb-dough-lucia-variant-customers-v2": "52d7fe579549586f629799cb8ad9275b0925ea6a807a064c560ac6eb5de44bd1",
  "july-2026-profile-corrections-v1": "19828e052a119672ef233af521ea6c2b26ebe9d70584e25af4de9bbd727622f3",
  "july-2026-audit-corrections-v2": "7cf06fcc098b499551fa5949c179538d131cf7871a0ad4e67c9452737d46c40d",
  "july-2026-audit-corrections-v3": "7da89a8f692da6ad37172ea539f1318ea5c126e75c8145c43cd73a7feec1f374",
  "applicator-contamination-depoison-v1": "5f3e4dc3e32736e60e413b34d6a00cf0545d34a52b607e1bb1a6d80757e39e61",
  "sync-row-name-registry-restore-v1": "105e50ef7b7beb091998dbff3adeb4afaf1b90ba3258257ccd00648f4848ee0e",
  "brand-duplicate-purge-v1": "4385a8e241627ffd3650152efcef59f7498c1ca215f7be19244fa19d01730bdc",
  "tunnel-pre-post-default-v1": "12bce4d934767c305f966757e616fd06877f31c168b3b15b4ab9734dd2bf5d34",
  "aug2026-import-fix-cheese-recipes-v1": "1e920cdfbbc5ae5d72352fffc3543f42d16cc8f64edd84671afe472b34b32ff1",
  "aug2026-import-fix-mixes-v1": "93490e5dc601c670e8e3060c0de2676ca4b2fd119dfe57d653362b0bb9387194",
  "aug2026-import-fix-profiles-v1": "81f430c9c8675a91913ae15b0649350b2df48cac6bc125d691194ef8b029f2d5",
  "aug2026-import-fix-sauce-recipes-v1": "a6fbb357d29029916b854c219741eda5119aadc2240bb515212638914cfbfe9e",
  "aug2026-cheese-recipe-lbs-v1": "0cc6ca208b067af90d523db798c7cdfc3a502f32c8efeb9b78e3b85478a50f27",
  "aug2026-lowes-mix-stray-component-v1": "b9834e471f6da9f795593817da5cfa0654be2d2f6dbb66641ded2ca0c3b07449",
  "cheese-component-oz-strip-v1": "68faf9d930a8892938fe148fba7e78a188e19323b96d01afa80f13af6a00c487",
  "cheese-component-oz-strip-v2": "2b8cac48b5847b33e0a3b1acd860f10e37c354e24cd77ca21263b12ca537d5be",
  "hannaford-tikka-masala-fix-v1": "bb36f841f992c5b9993ab00ff6d4bd2f3d82e0f2e2057737ad6b9978a55925b2",
  "profile-name-link-stub-purge-v1": "5a987482129537f487db0b7f4f8f67abc11ee34d946a23146572f7751c1f4683",
  "workbook-import-stub-purge-v1": "a59ab226943e8d38f5f49925ab86af19e0276c371c43348a088cb68acf1e969f",
  "aug19-saved-spec-profile-repair-v1": "72c673010046717e5e2dad8849a1b503b00b158d02137f8ee8900dae233d01b0",
  "aug19-saved-spec-profile-repair-v2": "31f5e068d9cf838f8465921b9292a0c6c3fa1807df5dc94cfba9587c8b55c621",
  "fresh-device-run-contamination-v1": "9d9b8ab9f247c4fa36d66716426a9e48ef7a4835b7200782c0780700e815833c",
  "incident-resolved-workflow-reconciliation-v1": "7029d74ba987dee8a579dcfd70a56cf246085fec11eea77542721e4a665d5676",
  "source-library-reconciliation-2026-08-26-v1": "c50e15136b8b5a42733ff9761c00d189887ccfd54aa4568352cafe0cd4a7fc13",
});
