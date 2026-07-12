// Contract lockstep guard: the spec-import alias "kind" namespace is defined in
// @workspace/spec-import (SPEC_ALIAS_KINDS) and the route trusts it via
// KIND_SET, but the request body is FIRST parsed with the generated Zod schema
// from the OpenAPI spec. If a kind is added to the lib but not to
// lib/api-spec/openapi.yaml, every save containing it 400s at parse — and the
// client swallows that best-effort, so corrections silently stop being
// remembered (this actually happened with "recipeName").
import { describe, it, expect } from "vitest";
import { SaveSpecImportAliasesBody } from "@workspace/api-zod";
import { SPEC_ALIAS_KINDS } from "@workspace/spec-import";

describe("spec-import alias kind contract lockstep", () => {
  it("accepts every SPEC_ALIAS_KINDS value in the generated request schema", () => {
    for (const kind of SPEC_ALIAS_KINDS) {
      const parsed = SaveSpecImportAliasesBody.safeParse({
        aliases: [
          {
            kind,
            externalName: "Sheet Dough",
            canonicalName: "House Dough",
            context: "dough",
          },
        ],
      });
      expect(parsed.success, `kind "${kind}" must be accepted by the OpenAPI contract`).toBe(
        true,
      );
    }
  });

  it("still rejects unknown kinds", () => {
    const parsed = SaveSpecImportAliasesBody.safeParse({
      aliases: [{ kind: "notAKind", externalName: "a", canonicalName: "b" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("includes the recipeName kind used for dough/sauce 'Use existing' picks", () => {
    expect(SPEC_ALIAS_KINDS).toContain("recipeName");
  });
});
