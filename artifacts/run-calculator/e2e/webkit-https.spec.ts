import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const PUBLIC_IMAGE_URL =
  "https://www.gstatic.com/images/branding/product/1x/googleg_32dp.png";

test("loads a real public HTTPS image and records its response and dimensions", async ({
  page,
}, testInfo) => {
  // This intentionally uses a public origin without route interception or
  // response substitution so the check covers browser TLS and image decoding.
  const response = await page.goto(PUBLIC_IMAGE_URL, {
    waitUntil: "load",
    timeout: 30_000,
  });
  expect(response, "the public HTTPS image request must receive a response").not.toBeNull();

  const status = response!.status();
  const contentTypeHeader = response!.headers()["content-type"] ?? "";
  const normalizedContentType = contentTypeHeader
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const contentType =
    /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/.test(
      normalizedContentType,
    )
      ? normalizedContentType
      : null;
  const image = await page.evaluate(() => {
    const imageElement = document.querySelector("img");
    return {
      width: imageElement?.naturalWidth ?? 0,
      height: imageElement?.naturalHeight ?? 0,
    };
  });

  const evidenceDirectory = process.env.TEST_RESULTS_HTTPS_EVIDENCE_DIR;
  if (evidenceDirectory) {
    const browser = testInfo.project.name;
    if (browser !== "chromium" && browser !== "webkit") {
      throw new Error("The HTTPS report received an unexpected browser project.");
    }
    await writeFile(
      join(evidenceDirectory, `${browser}.json`),
      JSON.stringify({
        status,
        contentType,
        imageWidth: image.width,
        imageHeight: image.height,
      }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  }

  expect(status, "the public image endpoint must respond successfully").toBe(200);
  expect(contentType, "the endpoint must serve a PNG").toBe("image/png");
  expect(image.width, "the image must decode to a non-zero width").toBeGreaterThan(0);
  expect(image.height, "the image must decode to a non-zero height").toBeGreaterThan(0);

  console.log(
    `HTTPS smoke (${testInfo.project.name}): status=${status} content-type=${contentType ?? "unavailable"} image=${image.width}x${image.height}`,
  );
});
