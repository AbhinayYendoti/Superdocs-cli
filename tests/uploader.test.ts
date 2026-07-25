import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DocumentUploader } from "../src/services/documentUploader.js";
import type { ISuperDocsClient } from "../src/sdk/interfaces.js";
import type { EditableFile } from "../src/utils/files.js";

class MockSuperDocsClient implements Partial<ISuperDocsClient> {
  base64Called = false;
  presignedCalled = false;
  signedUploadCalled = false;

  async uploadDocumentBase64(): Promise<any> {
    this.base64Called = true;
    return { upload_id: "u_1", status: "ready" };
  }

  async requestUploadUrl(): Promise<any> {
    this.presignedCalled = true;
    return { upload_id: "u_2", upload_url: "https://upload.example.com" };
  }

  async uploadToSignedUrl(): Promise<void> {
    this.signedUploadCalled = true;
  }

  async processUploadedDocument(): Promise<any> {
    return { session_id: "s_1" };
  }
}

describe("DocumentUploader", () => {
  it("uses base64 upload for small files", async () => {
    const mock = new MockSuperDocsClient();
    const uploader = new DocumentUploader(mock as unknown as ISuperDocsClient, {
      thresholdBytes: 1024
    });

    const smallFile: EditableFile = {
      absolutePath: "/test/file.md",
      filename: "file.md",
      extension: ".md",
      contentType: "text/markdown",
      exportFormat: "markdown",
      bytes: Buffer.from("small content"),
      sizeBytes: 100
    };

    await uploader.upload(smallFile, "session_1");
    assert.equal(mock.base64Called, true);
    assert.equal(mock.presignedCalled, false);
  });

  it("uses presigned URL upload for files above threshold", async () => {
    const mock = new MockSuperDocsClient();
    const uploader = new DocumentUploader(mock as unknown as ISuperDocsClient, {
      thresholdBytes: 1024
    });

    const largeFile: EditableFile = {
      absolutePath: "/test/large.md",
      filename: "large.md",
      extension: ".md",
      contentType: "text/markdown",
      exportFormat: "markdown",
      bytes: Buffer.alloc(2048),
      sizeBytes: 2048
    };

    await uploader.upload(largeFile, "session_2");
    assert.equal(mock.base64Called, false);
    assert.equal(mock.presignedCalled, true);
  });

  it("stops before upload when aborted after requesting a URL", async () => {
    const mock = new MockSuperDocsClient();
    const uploader = new DocumentUploader(mock as unknown as ISuperDocsClient, {
      thresholdBytes: 1024
    });
    const controller = new AbortController();

    const largeFile: EditableFile = {
      absolutePath: "/test/large.md",
      filename: "large.md",
      extension: ".md",
      contentType: "text/markdown",
      exportFormat: "markdown",
      bytes: Buffer.alloc(2048, "a"),
      sizeBytes: 2048
    };

    await assert.rejects(
      () =>
        uploader.upload(
          largeFile,
          "session_2",
          (message) => {
            if (message.startsWith("Requesting upload URL")) {
              controller.abort();
            }
          },
          controller.signal
        ),
      /cancelled/u
    );
    assert.equal(mock.presignedCalled, true);
    assert.equal(mock.signedUploadCalled, false);
  });
});
