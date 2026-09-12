declare namespace chrome {
  namespace runtime {
    interface TabLike {
      id?: number;
      url?: string;
    }
    interface MessageSender {
      tab?: TabLike;
      origin?: string;
      url?: string;
    }
    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: { addListener(callback: (message: unknown, port: Port) => void): void };
      onDisconnect: { addListener(callback: (port: Port) => void): void };
    }
    interface RuntimeMessageEvent {
      addListener(callback: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void): void;
    }
    interface RuntimeConnectEvent {
      addListener(callback: (port: Port) => void): void;
    }
    const onMessage: RuntimeMessageEvent;
    const onConnect: RuntimeConnectEvent;
    function sendMessage(message: unknown): Promise<unknown>;
    function connect(connectInfo?: { name?: string }): Port;
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
  namespace tabs {
    interface Tab {
      id?: number;
      autoDiscardable?: boolean;
      discarded?: boolean;
      frozen?: boolean;
      url?: string;
    }
    interface TabChangeInfo {
      autoDiscardable?: boolean;
      discarded?: boolean;
      frozen?: boolean;
      status?: string;
      url?: string;
    }
    interface TabUpdatedEvent {
      addListener(callback: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
    }
    interface TabRemovedEvent {
      addListener(callback: (tabId: number) => void): void;
    }
    const onUpdated: TabUpdatedEvent;
    const onRemoved: TabRemovedEvent;
    function update(tabId: number, updateProperties: { autoDiscardable?: boolean; active?: boolean }): Promise<Tab | undefined>;
  }
}
