import type { ISuperDocsClient } from "../sdk/index.js";
import type { EditableFile } from "../utils/files.js";

const PRESIGNED_UPLOAD_THRESHOLD_BYTES = 100 * 1024;

export interface DocumentUploaderOptions {
  thresholdBytes?: number;
  onProgress?: (message: string) => void;
}

export class DocumentUploader {
  private readonly thresholdBytes: number;

  constructor(
    private readonly client: ISuperDocsClient,
    options: DocumentUploaderOptions = {}
  ) {
    this.thresholdBytes = options.thresholdBytes ?? PRESIGNED_UPLOAD_THRESHOLD_BYTES;
  }

  async upload(
    input: EditableFile,
    sessionId: string,
    onProgress?: (message: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    checkAborted(signal);
    if (input.sizeBytes > this.thresholdBytes) {
      onProgress?.(`Requesting upload URL for ${input.filename}`);
      const upload = await this.client.requestUploadUrl({
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: "document"
      });

      checkAborted(signal);
      onProgress?.(`Uploading ${input.filename}`);
      await this.client.uploadToSignedUrl(
        upload.upload_url,
        input.bytes,
        input.contentType,
        signal
      );

      checkAborted(signal);
      onProgress?.("Processing uploaded document");
      await this.client.processUploadedDocument({
        uploadId: upload.upload_id,
        filename: input.filename,
        sessionId,
        parseMode: "document",
        returnHtml: false
      });
    } else {
      checkAborted(signal);
      onProgress?.(`Uploading ${input.filename}`);
      await this.client.uploadDocumentBase64({
        filename: input.filename,
        file: input.bytes,
        sessionId,
        returnHtml: false
      });
    }
  }
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Edit operation cancelled by user.");
  }
}
