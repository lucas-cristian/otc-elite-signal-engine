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
  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    interface AlarmCreateInfo {
      delayInMinutes?: number;
      periodInMinutes?: number;
      when?: number;
    }
    interface AlarmEvent {
      addListener(callback: (alarm: Alarm) => void): void;
    }
    const onAlarm: AlarmEvent;
    function create(name: string, alarmInfo: AlarmCreateInfo): void;
  }
}
