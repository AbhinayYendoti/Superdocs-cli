type CleanupHandler = () => void | Promise<void>;

class ProcessCleanupManager {
  private readonly handlers: Set<CleanupHandler> = new Set();
  private isCleaningUp = false;
  private isRegistered = false;

  register(handler: CleanupHandler): () => void {
    this.ensureListeners();
    this.handlers.add(handler);

    return () => {
      this.handlers.delete(handler);
    };
  }

  async runCleanup(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;

    try {
      for (const handler of Array.from(this.handlers)) {
        try {
          await handler();
        } catch {
          // Suppress cleanup errors to guarantee remaining handlers run
        }
      }
    } finally {
      this.isCleaningUp = false;
    }
  }

  private ensureListeners(): void {
    if (this.isRegistered) return;
    this.isRegistered = true;

    const onExitSignal = async () => {
      await this.runCleanup();
    };

    process.once("SIGINT", () => {
      void onExitSignal();
    });

    process.once("SIGTERM", () => {
      void onExitSignal();
    });
  }
}

export const processCleanup = new ProcessCleanupManager();
