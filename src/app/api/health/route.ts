import { NextResponse } from "next/server";
import {
  getMissingEnvironmentVariables,
  getSupabasePublicConfig,
  SupabaseConfigurationError,
} from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SupabaseCheck = {
  configured: boolean;
  reachable: boolean | null;
  queryStatus:
    | "not_configured"
    | "invalid_configuration"
    | "rows_visible"
    | "no_rows_visible"
    | "permission_denied"
    | "table_missing"
    | "column_mismatch"
    | "query_failed"
    | "connection_failed";
  message: string;
  errorCode?: string;
};

type SupabaseQueryError = {
  code?: string;
};

function classifySupabaseQueryError(code: string | undefined): {
  queryStatus: SupabaseCheck["queryStatus"];
  diagnostic: string;
  message: string;
} {
  switch (code) {
    case "PGRST125":
      return {
        queryStatus: "invalid_configuration",
        diagnostic: "invalid_supabase_request_path",
        message:
          "Supabase was reached, but the request URL path is invalid. Set NEXT_PUBLIC_SUPABASE_URL to the project root URL without /rest/v1.",
      };
    case "42501":
    case "PGRST301":
    case "PGRST302":
      return {
        queryStatus: "permission_denied",
        diagnostic: "permission_or_authentication_rejected",
        message:
          "Supabase is reachable, but the anon key is not authorized to query leads. Check API key validity, table grants, and RLS policies.",
      };
    case "42P01":
    case "PGRST205":
      return {
        queryStatus: "table_missing",
        diagnostic: "public_leads_table_not_found",
        message:
          "Supabase is reachable, but public.leads was not found in the API schema. Verify that the migration was applied to this project and that the schema cache is refreshed.",
      };
    case "42703":
    case "PGRST204":
      return {
        queryStatus: "column_mismatch",
        diagnostic: "requested_column_not_found",
        message:
          "Supabase is reachable, but the leads table does not expose the requested id column. Verify the deployed schema and API schema cache.",
      };
    default:
      return {
        queryStatus: "query_failed",
        diagnostic: "unclassified_database_query_error",
        message:
          "Supabase is reachable, but the read-only leads query failed. Check the server logs for its sanitized error code.",
      };
  }
}

function safeSupabaseErrorCode(error: SupabaseQueryError): string {
  const code = error.code;
  return code && /^[A-Za-z0-9]{3,10}$/.test(code) ? code : "unknown";
}

async function checkSupabase(): Promise<SupabaseCheck> {
  const missing = getMissingEnvironmentVariables([
    "supabaseUrl",
    "supabaseAnonKey",
  ]);

  if (missing.length > 0) {
    return {
      configured: false,
      reachable: null,
      queryStatus: "not_configured",
      message: `Missing required environment variables: ${missing.join(", ")}.`,
    };
  }

  try {
    getSupabasePublicConfig();
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("leads")
      .select("id")
      .limit(1);

    if (error) {
      const errorCode = safeSupabaseErrorCode(error);
      const classification = classifySupabaseQueryError(
        errorCode === "unknown" ? undefined : errorCode,
      );
      console.error("[health] Supabase leads query failed", {
        code: errorCode,
        diagnostic: classification.diagnostic,
      });

      return {
        configured: true,
        reachable: true,
        queryStatus: classification.queryStatus,
        message: classification.message,
        errorCode,
      };
    }

    if (!data || data.length === 0) {
      return {
        configured: true,
        reachable: true,
        queryStatus: "no_rows_visible",
        message:
          "Supabase is reachable, but no lead rows are visible. The table may be empty or RLS may be filtering rows.",
      };
    }

    return {
      configured: true,
      reachable: true,
      queryStatus: "rows_visible",
      message: "Supabase is reachable and the leads query returned a visible row.",
    };
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return {
        configured: false,
        reachable: null,
        queryStatus: "invalid_configuration",
        message:
          "Supabase URL configuration is invalid. Set NEXT_PUBLIC_SUPABASE_URL to a valid HTTP or HTTPS project URL.",
      };
    }

    return {
      configured: true,
      reachable: false,
      queryStatus: "connection_failed",
      message:
        "Supabase credentials are present, but the server could not connect. Check the project URL, network access, and key configuration.",
    };
  }
}

export async function GET() {
  const missing = {
    gemini: getMissingEnvironmentVariables(["geminiApiKey"]),
    googleCalendar: getMissingEnvironmentVariables([
      "googleClientId",
      "googleClientSecret",
      "googleRedirectUri",
    ]),
    meta: getMissingEnvironmentVariables([
      "metaAppId",
      "metaAppSecret",
      "metaVerifyToken",
    ]),
    gmail: getMissingEnvironmentVariables([
      "gmailClientId",
      "gmailClientSecret",
      "gmailRedirectUri",
      "gmailTokenEncryptionKey",
    ]),
  };
  const supabase = await checkSupabase();

  return NextResponse.json({
    status: "ok",
    integrations: {
      supabase,
      geminiCredentialsPresent: missing.gemini.length === 0,
      googleCalendarCredentialsPresent: missing.googleCalendar.length === 0,
      metaCredentialsPresent: missing.meta.length === 0,
      gmailCredentialsPresent: missing.gmail.length === 0,
    },
  });
}
