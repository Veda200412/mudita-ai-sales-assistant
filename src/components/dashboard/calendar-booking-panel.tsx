"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

interface CalendarStatus {
  configured: boolean;
  connected: boolean;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nextLocalDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const date = new Date(
    `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}T12:00:00Z`,
  );
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function CalendarBookingPanel({
  accessToken,
  lead,
}: {
  accessToken: string;
  lead: { id: string; fullName: string | null } | null;
}) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [date, setDate] = useState(nextLocalDate);
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [customerConfirmed, setCustomerConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/calendar/status", {
        headers: { Authorization: "Bearer " + accessToken },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.configured === "boolean" && typeof body.connected === "boolean") {
        setStatus({
          configured: body.configured,
          connected: body.connected,
          error: typeof body.error === "string" ? body.error : null,
        });
      }
    } catch {
      setError("Calendar status could not be loaded.");
    }
  }, [accessToken]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/calendar/connect", {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken },
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(body) ||
        typeof body.authorizationUrl !== "string"
      ) {
        setError(isRecord(body) && typeof body.error === "string" ? body.error : "Calendar connection could not be started.");
        return;
      }
      window.location.assign(body.authorizationUrl);
    } catch {
      setError("Calendar connection could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function loadAvailability() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setSelectedSlot(null);
    setBookingId(null);
    setCustomerConfirmed(false);
    try {
      const response = await fetch(
        `/api/calendar/availability?date=${encodeURIComponent(date)}`,
        {
          headers: { Authorization: "Bearer " + accessToken },
          cache: "no-store",
        },
      );
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(body) ||
        !Array.isArray(body.slots) ||
        !body.slots.every((slot) => typeof slot === "string")
      ) {
        setError(isRecord(body) && typeof body.error === "string" ? body.error : "Availability could not be checked.");
        return;
      }
      setSlots(body.slots);
    } catch {
      setError("Calendar availability could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  async function requestSlot() {
    if (!lead || !selectedSlot) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/calendar/bookings", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ leadId: lead.id, slotStart: selectedSlot }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.bookingId !== "string") {
        setError(isRecord(body) && typeof body.error === "string" ? body.error : "Booking request could not be created.");
        return;
      }
      setBookingId(body.bookingId);
      setNotice("Booking request staged pending customer confirmation. The slot is not held and will be rechecked before the event is created.");
    } catch {
      setError("Booking request could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBooking() {
    if (!bookingId || !customerConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/calendar/bookings/confirm", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingId, customerConfirmed: true }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body)) {
        setError(isRecord(body) && typeof body.error === "string" ? body.error : "Google Calendar booking failed.");
        return;
      }
      setNotice(
        body.duplicate === true
          ? "This meeting was already booked; no duplicate event was created."
          : "Customer-confirmed meeting was booked in Google Calendar.",
      );
      setBookingId(null);
      setSelectedSlot(null);
      await loadAvailability();
    } catch {
      setError("Google Calendar booking could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("calendar");
    if (result) {
      setNotice(result === "connected" ? "Google Calendar connected." : "Google Calendar connection failed.");
      window.history.replaceState({}, "", window.location.pathname);
      void loadStatus();
    }
  }, [accessToken, loadStatus]);

  return (
    <section className="calendar-booking-card" aria-labelledby="calendar-booking-title">
      <div className="calendar-booking-heading">
        <CalendarDays aria-hidden="true" size={17} />
        <div>
          <h3 id="calendar-booking-title">Google Calendar</h3>
          <p>Availability is checked against the connected calendar in real time.</p>
        </div>
      </div>
      {status?.connected ? (
        <>
          <label className="calendar-date-label">
            Date (India Standard Time)
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={busy}
            />
          </label>
          <button className="quiet-button" type="button" onClick={() => void loadAvailability()} disabled={busy}>
            {busy ? "Checking…" : "Check available times"}
          </button>
          {slots.length ? (
            <div className="calendar-slots" aria-label="Available 30-minute slots">
              {slots.map((slot) => (
                <button
                  type="button"
                  key={slot}
                  className={selectedSlot === slot ? "selected" : ""}
                  onClick={() => setSelectedSlot(slot)}
                  disabled={busy || Boolean(bookingId)}
                >
                  {new Intl.DateTimeFormat("en-IN", {
                    timeZone: "Asia/Kolkata",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(slot))}
                </button>
              ))}
            </div>
          ) : null}
          {slots.length === 0 ? <p className="calendar-helper">Check a weekday to see live available slots.</p> : null}
          {selectedSlot && !bookingId ? (
            <button className="primary-button" type="button" onClick={() => void requestSlot()} disabled={busy || !lead}>
              {busy ? "Requesting slot…" : "Request meeting pending confirmation"}
            </button>
          ) : null}
          {bookingId ? (
            <div className="calendar-confirmation">
              <label>
                <input
                  type="checkbox"
                  checked={customerConfirmed}
                  onChange={(event) => setCustomerConfirmed(event.target.checked)}
                  disabled={busy}
                />
                The customer explicitly confirmed this exact time.
              </label>
              <button className="primary-button" type="button" onClick={() => void confirmBooking()} disabled={busy || !customerConfirmed}>
                {busy ? "Rechecking and booking…" : "Recheck availability and book"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <button className="quiet-button" type="button" onClick={() => void connect()} disabled={busy || !status?.configured}>
          {busy ? "Connecting…" : "Connect Google Calendar"}
        </button>
      )}
      {status?.error ? <p className="calendar-helper">{status.error}</p> : null}
      {error ? <p className="gmail-message error" role="alert">{error}</p> : null}
      {notice ? <p className="gmail-message" role="status">{notice}</p> : null}
    </section>
  );
}
