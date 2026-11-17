import { useMasterDataSlice } from "../masterData";
import type { Mix } from "@workspace/mixes";

// Factory-wide mixes, shared by the Mixes make-day plan and the manager
// management UI. Polls in the background so a mix a manager adds on one device
// shows up for the floor without a manual refresh. Open to everyone signed in
// (the GET endpoint is requireAuth, not manager-gated) because every app needs
// the mixes to build the plan.
//
export function useMixes(): {
  items: Mix[];
  isLoading: boolean;
} {
  const { data, isLoading } = useMasterDataSlice("mixes");
  return { items: data ?? [], isLoading };
}
