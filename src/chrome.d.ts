declare namespace chrome {
  namespace runtime {
    interface MessageSender {}
    interface RuntimeMessageEvent {
      addListener(callback: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
    }
    const onMessage: RuntimeMessageEvent;
    function sendMessage(message: unknown): Promise<unknown>;
    function getURL(path: string): string;
    function getManifest(): { version: string };
    function openOptionsPage(): Promise<void>;
  }
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
  }
}
