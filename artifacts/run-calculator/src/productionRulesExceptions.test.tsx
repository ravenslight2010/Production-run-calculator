import { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { newRule, type ProductionRule } from "@workspace/production-rules";
import { RuleExceptionsEditor } from "./components/ProductionRulesManager";

afterEach(() => cleanup());

// Mirrors how ProductionRulesManager mounts the editor: the parent owns the
// canonical rule and re-passes it on every save. The server normalize drops
// EMPTY bypass/checklist entries, so a freshly added (empty) row would vanish
// instantly if the editor re-derived its lists from that round-trip. This
// harness simulates that round-trip — `patch` strips empties just like the
// server does and feeds the result straight back as the `rule` prop.
function EditorHarness({ initial }: { initial: ProductionRule }) {
  const [rule, setRule] = useState<ProductionRule>(initial);
  const patch = (p: Partial<ProductionRule>) => {
    const next = { ...rule, ...p };
    // Emulate server normalize: empty bypass values / blank checklist steps are
    // never persisted, so the parent's copy comes back without them.
    next.bypass = (next.bypass ?? []).filter((b) => b.value.trim() !== "");
    if (next.bypass.length === 0) delete next.bypass;
    next.checklist = (next.checklist ?? []).filter((s) => s.trim() !== "");
    if (next.checklist.length === 0) delete next.checklist;
    setRule(next);
  };
  return <RuleExceptionsEditor rule={rule} disabled={false} patch={patch} />;
}

describe("RuleExceptionsEditor add-row persistence", () => {
  it("keeps a freshly added bypass row visible despite the empty-stripping round-trip", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={newRule("rx-test-1", "required-field")} />);

    expect(screen.queryByPlaceholderText("value")).toBeNull();
    await user.click(screen.getByText(/Add bypass condition/i));

    // Without local seed-once state the parent's stripped rule would erase the
    // empty row on the very next render ("nothing happens"); it must survive.
    expect(screen.getByPlaceholderText("value")).toBeTruthy();
  });

  it("keeps a freshly added checklist step visible despite the empty-stripping round-trip", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initial={newRule("rx-test-1", "required-field")} />);

    expect(screen.queryByPlaceholderText("step description")).toBeNull();
    await user.click(screen.getByText(/Add checklist step/i));

    expect(screen.getByPlaceholderText("step description")).toBeTruthy();
  });
});
