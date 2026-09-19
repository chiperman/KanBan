import type { Clock } from "@/server/ports";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
