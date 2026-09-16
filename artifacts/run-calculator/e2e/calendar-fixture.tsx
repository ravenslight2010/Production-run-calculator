import { useState } from "react";
import { createRoot } from "react-dom/client";

import { Calendar } from "@/components/ui/calendar";
import "@/index.css";

const JANUARY_2025 = new Date(2025, 0, 1);
const DISABLED_DATE = new Date(2025, 0, 15);

function CalendarFixture() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Date>();

  return (
    <main className="min-h-dvh bg-background p-4 text-foreground">
      <button
        type="button"
        className="rounded-md border px-4 py-2"
        aria-expanded={open}
        aria-controls="calendar-panel"
        onClick={() => setOpen((current) => !current)}
      >
        Open calendar
      </button>

      {open ? (
        <section
          id="calendar-panel"
          aria-label="Calendar date picker"
          className="mt-3 w-fit max-w-full rounded-md border"
        >
          <Calendar
            mode="single"
            defaultMonth={JANUARY_2025}
            selected={selected}
            onSelect={setSelected}
            disabled={DISABLED_DATE}
            showOutsideDays
          />
        </section>
      ) : null}

      <output className="mt-3 block" aria-live="polite">
        {selected
          ? `Selected ${selected.toLocaleDateString("en-US")}`
          : "No date selected"}
      </output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<CalendarFixture />);