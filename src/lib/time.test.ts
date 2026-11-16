import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { formatAgo, formatRelative } from "./time";

const NOW = new Date("2026-06-15T12:00:00Z");

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

describe("formatRelative", () => {
  test.each([
    ["now for under a minute", "2026-06-15T11:59:40Z", "now"],
    ["minutes", "2026-06-15T11:55:00Z", "5m"],
    ["hours", "2026-06-15T09:00:00Z", "3h"],
    ["days", "2026-06-13T12:00:00Z", "2d"],
    ["weeks", "2026-06-01T12:00:00Z", "2w"],
  ])("formats %s", (_label, iso, expected) => {
    expect(formatRelative(iso)).toBe(expected);
  });

  test("falls back to a calendar date beyond five weeks", () => {
    expect(formatRelative("2026-04-01T12:00:00Z")).toMatch(/Apr/);
  });

  test("returns an empty string for an invalid timestamp", () => {
    expect(formatRelative("not-a-date")).toBe("");
  });
});

describe("formatAgo", () => {
  test("reads as prose instead of a bare duration", () => {
    expect(formatAgo("2026-06-15T11:55:00Z")).toBe("5m ago");
    expect(formatAgo("2026-06-15T11:59:40Z")).toBe("just now");
  });

  test("uses 'on' for calendar dates", () => {
    expect(formatAgo("2026-04-01T12:00:00Z")).toMatch(/^on Apr/);
  });

  test("returns an empty string when there is no timestamp", () => {
    expect(formatAgo("")).toBe("");
  });
});
