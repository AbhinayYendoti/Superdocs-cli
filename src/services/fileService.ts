import type { EditableFile } from "../utils/files.js";
import {
  readEditableFile as defaultReadEditableFile,
  writeFileAtomically as defaultWriteFileAtomically,
  readStdin as defaultReadStdin
} from "../utils/files.js";

export interface IFileService {
  readEditableFile(filePath: string): Promise<EditableFile>;
  writeFileAtomically(filePath: string, bytes: Uint8Array): Promise<void>;
  readStdin(): Promise<Buffer>;
}

export class NodeFileService implements IFileService {
  async readEditableFile(filePath: string): Promise<EditableFile> {
    return defaultReadEditableFile(filePath);
  }

  async writeFileAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
    return defaultWriteFileAtomically(filePath, bytes);
  }

  async readStdin(): Promise<Buffer> {
    return defaultReadStdin();
  }
}

export const defaultFileService: IFileService = new NodeFileService();
