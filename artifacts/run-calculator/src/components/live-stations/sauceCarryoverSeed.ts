type SauceCarryoverSeedInput = {
  currentRunId: string | null | undefined;
  seededRunId: string | null;
  runStatus: string;
  prepCarriedOver: boolean;
  prepBatchesSauce: number;
  sauceBarrelsMade: number | string | null | undefined;
};

export function shouldSeedCarriedOverSauce({
  currentRunId,
  seededRunId,
  runStatus,
  prepCarriedOver,
  prepBatchesSauce,
  sauceBarrelsMade,
}: SauceCarryoverSeedInput): boolean {
  return Boolean(
    currentRunId &&
    seededRunId !== currentRunId &&
    runStatus === "running" &&
    prepCarriedOver &&
    prepBatchesSauce > 0 &&
    (Number(sauceBarrelsMade) || 0) === 0,
  );
}