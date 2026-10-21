import "server-only";

export interface CalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const eventScope = "https://www.googleapis.com/auth/calendar.events";
const freeBusyScope = "https://www.googleapis.com/auth/calendar.freebusy";

export class CalendarApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

function configuration() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new CalendarApiError(
      "Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function createCalendarAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = configuration();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `${eventScope} ${freeBusyScope}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  }).toString();
  return url.toString();
}

async function requestTokens(
  values: Record<string, string>,
): Promise<Record<string, unknown>> {
  const { clientId, clientSecret } = configuration();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...values,
    }),
    cache: "no-store",
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || typeof result !== "object" || result === null) {
    throw new CalendarApiError(
      "Google Calendar OAuth failed. Check the Google Cloud configuration.",
      response.status,
      response.status === 400 ? "invalid_grant" : "oauth_failure",
    );
  }
  return result as Record<string, unknown>;
}

function tokenFields(
  response: Record<string, unknown>,
  refreshToken: string,
): CalendarTokens {
  if (
    typeof response.access_token !== "string" ||
    typeof response.expires_in !== "number"
  ) {
    throw new CalendarApiError("Google did not return usable Calendar credentials.");
  }
  return {
    accessToken: response.access_token,
    refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
}

export async function exchangeCalendarCode(code: string): Promise<CalendarTokens> {
  const { redirectUri } = configuration();
  const result = await requestTokens({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  const granted = typeof result.scope === "string"
    ? result.scope.split(/\s+/)
    : [];
  if (
    typeof result.refresh_token !== "string" ||
    !granted.includes(eventScope) ||
    !granted.includes(freeBusyScope)
  ) {
    throw new CalendarApiError(
      "Google did not grant both Calendar event and availability permissions.",
    );
  }
  return tokenFields(result, result.refresh_token);
}

export async function refreshCalendarTokens(
  refreshToken: string,
): Promise<CalendarTokens> {
  const result = await requestTokens({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return tokenFields(result, refreshToken);
}

async function calendarRequest<T>(
  tokens: CalendarTokens,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new CalendarApiError(
      response.status === 401
        ? "Google Calendar authorization expired. Reconnect the calendar."
        : response.status === 409
          ? "The calendar event conflicts with an existing booking."
          : `Google Calendar request failed (HTTP ${response.status}).`,
      response.status,
      response.status === 401 ? "unauthorized" : "calendar_api_failure",
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface CalendarBusyRange {
  start: string;
  end: string;
}

export async function getBusyRanges(
  tokens: CalendarTokens,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarBusyRange[]> {
  const result = await calendarRequest<{
    calendars?: Record<string, { busy?: CalendarBusyRange[]; errors?: unknown[] }>;
  }>(tokens, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: "Asia/Kolkata",
      items: [{ id: calendarId }],
    }),
  });
  const calendar = result.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length) {
    throw new CalendarApiError("Google Calendar availability could not be verified.");
  }
  return calendar.busy ?? [];
}

export interface CalendarEventInput {
  id: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}

export async function createCalendarEvent(
  tokens: CalendarTokens,
  calendarId: string,
  event: CalendarEventInput,
): Promise<{ id: string }> {
  const payload = {
    id: event.id,
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start, timeZone: event.timeZone },
    end: { dateTime: event.end, timeZone: event.timeZone },
  };
  try {
    return await calendarRequest<{ id: string }>(
      tokens,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: "POST", body: JSON.stringify(payload) },
    );
  } catch (error) {
    if (!(error instanceof CalendarApiError) || error.status !== 409) throw error;
    const existing = await calendarRequest<{ id: string }>(
      tokens,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.id)}`,
    );
    return existing;
  }
}

export async function getCalendarEvent(
  tokens: CalendarTokens,
  calendarId: string,
  eventId: string,
): Promise<{ id: string } | null> {
  try {
    return await calendarRequest<{ id: string }>(
      tokens,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  } catch (error) {
    if (error instanceof CalendarApiError && error.status === 404) return null;
    throw error;
  }
}
