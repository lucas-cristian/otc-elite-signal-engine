export interface Clock {
  now(): number;
}

export class LiveClock implements Clock {
  now(): number {
    return Date.now();
  }
}
