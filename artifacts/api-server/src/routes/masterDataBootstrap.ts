import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  cheeseRecipesTable,
  doughRecipesTable,
  ingredientsTable,
  mixesTable,
  sauceRecipesTable,
} from "@workspace/db";
import { currentScope } from "../lib/requestScope";

const router = Router();
const CACHE_TTL_MS = 5_000;
const cache = new Map<
  string,
  {
    expiresAt: number;
    serialized: string;
    gzipped: Buffer;
    etag: string;
  }
>();

export function invalidateMasterDataBootstrapCache(scope: string = currentScope()): void {
  cache.delete(scope);
}

function acceptsGzip(req: Request): boolean {
  const header = req.headers["accept-encoding"];
  if (typeof header !== "string") return false;

  let wildcard = false;
  for (const value of header.split(",")) {
    const [encoding, ...parameters] = value.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    if (!Number.isFinite(q) || q <= 0) {
      if (encoding === "gzip") return false;
      continue;
    }
    if (encoding === "gzip") return true;
    if (encoding === "*") wildcard = true;
  }
  return wildcard;
}

function matchesEtag(req: Request, etag: string): boolean {
  const header = req.headers["if-none-match"];
  if (typeof header !== "string") return false;
  const normalized = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === normalized);
}

function setRepresentationHeaders(
  res: Response,
  entry: {
    etag: string;
    serialized: string;
    gzipped: Buffer;
  },
  compressed: boolean,
): void {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("ETag", entry.etag);
  if (compressed) {
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", entry.gzipped.byteLength);
  } else {
    res.setHeader("Content-Length", Buffer.byteLength(entry.serialized));
  }
}

router.get("/master-data/bootstrap", async (req: Request, res: Response) => {
  const scope = currentScope();
  const now = Date.now();
  const cached = cache.get(scope);

  try {
    let entry = cached && cached.expiresAt > now ? cached : undefined;
    if (!entry) {
      const [ingredients, doughRecipes, sauceRecipes, cheeseRecipes, mixes] =
        await Promise.all([
          db.select().from(ingredientsTable).where(eq(ingredientsTable.scope, scope)),
          db.select().from(doughRecipesTable).where(eq(doughRecipesTable.scope, scope)),
          db.select().from(sauceRecipesTable).where(eq(sauceRecipesTable.scope, scope)),
          db.select().from(cheeseRecipesTable).where(eq(cheeseRecipesTable.scope, scope)),
          db.select().from(mixesTable).where(eq(mixesTable.scope, scope)),
        ]);
      const body = {
        ingredients,
        doughRecipes,
        sauceRecipes,
        cheeseRecipes,
        mixes,
      };
      const serialized = JSON.stringify(body);
      // Bind the validator to the authenticated data scope as well as content.
      // Browsers may retain private responses across account changes; a
      // scope-distinct ETag prevents their HTTP cache from reusing one scope's
      // body when another scope happens to serialize identically.
      const digest = createHash("sha256")
        .update(scope)
        .update("\0")
        .update(serialized)
        .digest("base64url");
      entry = {
        expiresAt: now + CACHE_TTL_MS,
        serialized,
        gzipped: gzipSync(serialized),
        // The semantic JSON is the same for gzip and identity, but the encoded
        // bytes differ. A weak validator is therefore correct across both
        // negotiated representations.
        etag: `W/"master-data-${digest}"`,
      };
      cache.set(scope, entry);
    }

    const compressed = acceptsGzip(req);
    setRepresentationHeaders(res, entry, compressed);
    res.setHeader("X-Master-Data-Cache", cached && cached.expiresAt > now ? "hit" : "miss");
    if (matchesEtag(req, entry.etag)) {
      res.status(304).end();
      return;
    }
    if (compressed) {
      res.end(entry.gzipped);
    } else {
      res.end(entry.serialized);
    }
  } catch (err) {
    req.log.error({ err }, "failed to load master-data bootstrap");
    res.status(500).json({ error: "Failed to load master data" });
  }
});

export default router;