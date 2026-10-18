import { describe, expect, it, vi } from "vitest";
import { prepareImageSource } from "./inventoryImage";

describe("prepareImageSource", () => {
  it("does not load the optional converter for JPEG and PNG uploads", async () => {
    const file = new File(["image"], "stock.jpg", { type: "image/jpeg" });
    const convert = vi.fn();

    await expect(prepareImageSource(file, convert)).resolves.toBe(file);
    expect(convert).not.toHaveBeenCalled();
  });

  it("uses the first converted blob for HEIC uploads", async () => {
    const file = new File(["heic"], "stock.heic", { type: "image/heic" });
    const converted = new Blob(["jpeg"], { type: "image/jpeg" });
    const convert = vi.fn().mockResolvedValue([converted]);

    await expect(prepareImageSource(file, convert)).resolves.toBe(converted);
    expect(convert).toHaveBeenCalledWith(file);
  });

  it("keeps the original HEIC file when conversion fails so decode can show guidance", async () => {
    const file = new File(["heic"], "stock.heif", { type: "application/octet-stream" });
    const convert = vi.fn().mockRejectedValue(new Error("converter unavailable"));

    await expect(prepareImageSource(file, convert)).resolves.toBe(file);
    expect(convert).toHaveBeenCalledWith(file);
  });
});
