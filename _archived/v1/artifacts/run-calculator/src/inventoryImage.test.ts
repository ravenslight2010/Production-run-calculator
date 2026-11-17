import { describe, expect, it, vi } from "vitest";
import { decodeImageWithHeicFallback, prepareImageSource } from "./inventoryImage";
import { HEIC_UNSUPPORTED_MESSAGE } from "./inventoryShared";

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

describe("decodeImageWithHeicFallback", () => {
  it("uses native HEIC decoding without loading the converter", async () => {
    const file = new File(["heic"], "stock.heic", { type: "image/heic" });
    const decoded = { width: 800, height: 600 };
    const decode = vi.fn().mockResolvedValue(decoded);
    const convert = vi.fn();

    await expect(decodeImageWithHeicFallback(file, decode, convert)).resolves.toEqual({
      source: file,
      decoded,
    });
    expect(decode).toHaveBeenCalledOnce();
    expect(decode).toHaveBeenCalledWith(file);
    expect(convert).not.toHaveBeenCalled();
  });

  it("loads the converter only after native HEIC decoding fails", async () => {
    const file = new File(["heic"], "stock.heif", { type: "application/octet-stream" });
    const converted = new Blob(["jpeg"], { type: "image/jpeg" });
    const decoded = { width: 800, height: 600 };
    const decode = vi.fn()
      .mockRejectedValueOnce(new Error("native HEIC decoding is unsupported"))
      .mockResolvedValueOnce(decoded);
    const convert = vi.fn().mockResolvedValue(converted);

    await expect(decodeImageWithHeicFallback(file, decode, convert)).resolves.toEqual({
      source: converted,
      decoded,
    });
    expect(convert).toHaveBeenCalledOnce();
    expect(convert).toHaveBeenCalledWith(file);
    expect(decode).toHaveBeenNthCalledWith(2, converted);
  });

  it("retains actionable guidance when native decoding and conversion both fail", async () => {
    const file = new File(["heic"], "stock.heic", { type: "image/heic" });
    const decode = vi.fn().mockRejectedValue(new Error("unsupported image"));
    const convert = vi.fn().mockRejectedValue(new Error("converter unavailable"));

    await expect(decodeImageWithHeicFallback(file, decode, convert))
      .rejects.toThrow(HEIC_UNSUPPORTED_MESSAGE);
    expect(convert).toHaveBeenCalledOnce();
  });

  it("does not convert an unsupported non-HEIC image", async () => {
    const file = new File(["image"], "stock.png", { type: "image/png" });
    const decode = vi.fn().mockRejectedValue(new Error("image is invalid"));
    const convert = vi.fn();

    await expect(decodeImageWithHeicFallback(file, decode, convert))
      .rejects.toThrow("image is invalid");
    expect(convert).not.toHaveBeenCalled();
  });
});
