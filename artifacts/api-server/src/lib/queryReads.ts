type ReadQueryFactory = () => PromiseLike<unknown>;

type ReadQueryResults<T extends readonly ReadQueryFactory[]> = {
  [K in keyof T]: T[K] extends () => PromiseLike<infer Result> ? Result : never;
};

/**
 * Run lazy Drizzle reads in the requested order. Transaction executors share
 * one PostgreSQL client, so their reads must be awaited sequentially.
 */
export async function executeReadQueries<T extends readonly ReadQueryFactory[]>(
  factories: T,
  mode: "parallel" | "sequential" = "parallel",
): Promise<ReadQueryResults<T>> {
  if (mode === "parallel") {
    return await Promise.all(factories.map((factory) => factory())) as ReadQueryResults<T>;
  }
  const results: unknown[] = [];
  for (const factory of factories) results.push(await factory());
  return results as ReadQueryResults<T>;
}
