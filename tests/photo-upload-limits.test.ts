import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, OPEN_SUBMISSION_STATUSES } from "@/lib/photos";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\s+/g, " ");

const r2 = read("src/lib/r2.ts");
const presign = read("src/app/api/photos/presign/route.ts");
const complete = read("src/app/api/photos/complete/route.ts");
const queue = read("src/lib/offline-queue.ts");

describe("photo upload limits", () => {
  it("keeps the ceiling in one shared place", () => {
    expect(MAX_PHOTO_BYTES).toBe(10 * 1024 * 1024);
    expect(presign).toContain("MAX_PHOTO_BYTES");
    expect(complete).toContain("MAX_PHOTO_BYTES");
  });

  it("treats only awaiting-review and returned submissions as open", () => {
    expect([...OPEN_SUBMISSION_STATUSES].sort()).toEqual(["changes_requested", "submitted"]);
  });
});

describe("presigned uploads bind the byte count", () => {
  // A bare presigned PUT authorises any number of bytes. Signing ContentLength
  // means R2 itself rejects an upload larger than the server approved.
  it("signs ContentLength as part of the upload signature", () => {
    expect(r2).toContain("ContentLength: contentLength");
  });

  it("requires a declared size for both the photo and its thumbnail", () => {
    expect(presign).toContain("thumbnailSize");
    expect(queue).toContain("thumbnailSize: photo.thumbnail.size");
  });
});

describe("completion trusts storage over the client", () => {
  it("reads the stored object back instead of accepting a reported size", () => {
    expect(complete).toContain("statObject(body.storageKey)");
    expect(complete).toContain("statObject(body.thumbnailKey)");
    expect(complete).toContain("size_bytes: stored.size");
  });

  it("no longer accepts a client-supplied size at all", () => {
    expect(complete).not.toContain("size_bytes: body.size");
    // The completion schema deliberately has no size field to trust.
    expect(complete).not.toMatch(/size: z\./);
  });

  it("rejects a key outside the caller's own submission prefix", () => {
    expect(complete).toContain("startsWith(prefix)");
  });

  it("refuses to record a photo that is not in storage", () => {
    expect(complete).toContain("!stored || !storedThumbnail");
  });
});

describe("closed submissions stop accepting evidence", () => {
  it.each([presign, complete])("checks the submission status (%#)", (source) => {
    expect(source).toContain("OPEN_SUBMISSION_STATUSES.includes(submission.status)");
  });
});
