import type { ISuperDocsClient } from "../sdk/index.js";
import type { EditableFile } from "../utils/files.js";
import type { ILogger } from "../utils/logger.js";

export interface PluginContext {
  logger: ILogger;
  client: ISuperDocsClient;
}

export interface SuperDocsPlugin {
  name: string;
  version: string;
  onInit?: (context: PluginContext) => void | Promise<void>;
  onBeforeEdit?: (input: EditableFile, context: PluginContext) => void | Promise<void>;
  onAfterEdit?: (
    input: EditableFile,
    output: Uint8Array,
    context: PluginContext
  ) => void | Promise<void>;
}

export class PluginRegistry {
  private readonly plugins: SuperDocsPlugin[] = [];

  register(plugin: SuperDocsPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered.`);
    }
    this.plugins.push(plugin);
  }

  getPlugins(): readonly SuperDocsPlugin[] {
    return this.plugins;
  }

  async notifyInit(context: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onInit) {
        await plugin.onInit(context);
      }
    }
  }

  async notifyBeforeEdit(input: EditableFile, context: PluginContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onBeforeEdit) {
        await plugin.onBeforeEdit(input, context);
      }
    }
  }

  async notifyAfterEdit(
    input: EditableFile,
    output: Uint8Array,
    context: PluginContext
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onAfterEdit) {
        await plugin.onAfterEdit(input, output, context);
      }
    }
  }
}

export const defaultPluginRegistry = new PluginRegistry();
