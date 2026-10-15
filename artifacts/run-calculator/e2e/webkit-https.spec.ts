import { expect, test } from "@playwright/test";

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
  const contentType = response!.headers()["content-type"] ?? "";
  expect(status, "the public image endpoint must respond successfully").toBe(200);
  expect(contentType, "the endpoint must serve a PNG").toMatch(/^image\/png\b/i);

  const image = await page.locator("img").evaluate((element) => {
    const imageElement = element as HTMLImageElement;
    return {
      width: imageElement.naturalWidth,
      height: imageElement.naturalHeight,
    };
  });
  expect(image.width, "the image must decode to a non-zero width").toBeGreaterThan(0);
  expect(image.height, "the image must decode to a non-zero height").toBeGreaterThan(0);

  console.log(
    `HTTPS smoke (${testInfo.project.name}): status=${status} content-type=${contentType} image=${image.width}x${image.height}`,
  );
});
