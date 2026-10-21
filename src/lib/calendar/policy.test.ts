import assert from "node:assert/strict";
import test from "node:test";
import {
  dailySlotStarts,
  filterAvailableSlotStarts,
  localDateRange,
} from "@/lib/calendar/policy";

test("calendar policy exposes only future weekday slots in the configured local window", () => {
  assert.deepEqual(localDateRange("2026-10-21"), {
    start: "2026-10-21T10:00:00+05:30",
    end: "2026-10-21T18:00:00+05:30",
  });
  const slots = dailySlotStarts(
    "2026-10-21",
    Date.parse("2026-10-20T00:00:00Z"),
  );
  assert.equal(slots.length, 16);
  assert.equal(slots[0], "2026-10-21T04:30:00.000Z");
  assert.equal(slots.at(-1), "2026-10-21T12:00:00.000Z");
  assert.ok(slots.every((slot) => Date.parse(slot) > Date.parse("2026-10-20T00:15:00Z")));
});

test("calendar policy rejects weekends and invalid dates", () => {
  assert.throws(
    () => localDateRange("2026-10-24"),
    /Monday through Friday/,
  );
  assert.throws(() => localDateRange("2026-02-30"), /valid date/);
  assert.throws(() => localDateRange("not-a-date"), /valid date/);
});

test("busy calendar intervals remove overlapping slots but allow adjacent times", () => {
  const slots = [
    "2026-10-21T04:30:00.000Z",
    "2026-10-21T05:00:00.000Z",
    "2026-10-21T05:30:00.000Z",
  ];
  assert.deepEqual(
    filterAvailableSlotStarts(slots, [{
      start: "2026-10-21T04:45:00.000Z",
      end: "2026-10-21T05:30:00.000Z",
    }]),
    ["2026-10-21T05:30:00.000Z"],
  );
});
