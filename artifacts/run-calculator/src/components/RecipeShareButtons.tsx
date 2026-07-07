import { useEffect, useRef, useState } from "react";
import { Printer, Share2 } from "lucide-react";
import {
  printRecipe,
  shareRecipe,
  type ShareableRecipe,
} from "../recipeShare";

/**
 * Small Print + Share icon pair for a recipe card header. Shows a transient
 * note ("Copied", "Pop-up blocked") next to the icons when needed.
 */
export function RecipeShareButtons({ recipe }: { recipe: ShareableRecipe }) {
  const [note, setNote] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const flash = (msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNote(msg);
    if (msg) timerRef.current = setTimeout(() => setNote(""), 2500);
  };
  return (
    <span className="flex items-center gap-0.5 shrink-0">
      {note && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap mr-1">
          {note}
        </span>
      )}
      <button
        type="button"
        title="Print recipe"
        aria-label="Print recipe"
        onClick={() => {
          if (!printRecipe(recipe)) flash("Pop-up blocked");
        }}
        className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Printer className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        title="Share recipe"
        aria-label="Share recipe"
        onClick={() => {
          void shareRecipe(recipe).then((res) => {
            if (res === "copied") flash("Copied");
            else if (res === "failed") flash("Couldn't share");
          });
        }}
        className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Share2 className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}
