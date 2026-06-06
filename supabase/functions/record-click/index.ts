import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ClickBody = {
  affiliate_link_id?: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing user session" }, 401);
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Supabase function is not configured" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));

    if (userError || !user) {
      return json({ error: "Invalid user session" }, 401);
    }

    const body = (await req.json()) as ClickBody;
    const affiliateLinkId = body.affiliate_link_id || "";

    const { data: link, error: linkError } = await supabase
      .from("affiliate_links")
      .select("id, user_id")
      .eq("id", affiliateLinkId)
      .eq("user_id", user.id)
      .single();

    if (linkError || !link) {
      return json({ error: "Affiliate link not found" }, 404);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      "";

    const { error: insertError } = await supabase.from("clicks").insert({
      affiliate_link_id: link.id,
      user_id: user.id,
      ip_hash: ip ? await sha256(ip) : null,
      user_agent: req.headers.get("user-agent"),
    });

    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({ ok: true }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
