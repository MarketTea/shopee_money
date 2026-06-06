import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ConvertBody = {
  original_url?: string;
  normalized_url?: string;
};

const affiliateId = Deno.env.get("SHOPEE_AFFILIATE_ID") || "17305840167";
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

    const body = (await req.json()) as ConvertBody;
    const originalUrl = sanitizeUrl(body.original_url);
    const normalizedUrl = sanitizeUrl(body.normalized_url || body.original_url);

    if (!originalUrl || !normalizedUrl || !isShopeeLink(originalUrl) || !isShopeeLink(normalizedUrl)) {
      return json({ error: "Invalid Shopee URL" }, 400);
    }

    const linkId = crypto.randomUUID();
    const subId = buildSubId(user.id, linkId);
    const affiliateUrl = buildAffiliateUrl(normalizedUrl, subId);

    await supabase.from("profiles").upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || null,
      avatar_url: user.user_metadata?.avatar_url || null,
    });

    const { data: link, error: insertError } = await supabase
      .from("affiliate_links")
      .insert({
        id: linkId,
        user_id: user.id,
        original_url: originalUrl,
        normalized_url: normalizedUrl,
        sub_id: subId,
        affiliate_url: affiliateUrl,
      })
      .select("id, sub_id, affiliate_url, normalized_url, created_at")
      .single();

    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json(link, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function sanitizeUrl(value?: string) {
  if (!value) return "";

  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isShopeeLink(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "shopee.vn" ||
      hostname.endsWith(".shopee.vn") ||
      hostname === "s.shopee.vn" ||
      hostname === "shope.ee" ||
      hostname.endsWith(".shope.ee") ||
      hostname === "shp.ee" ||
      hostname.endsWith(".shp.ee");
  } catch {
    return false;
  }
}

function buildSubId(userId: string, linkId: string) {
  return `u_${compact(userId).slice(0, 8)}_l_${compact(linkId).slice(0, 8)}`;
}

function compact(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function buildAffiliateUrl(originLink: string, subId: string) {
  const url = new URL("https://s.shopee.vn/an_redir");
  url.searchParams.set("origin_link", originLink);
  url.searchParams.set("affiliate_id", affiliateId);
  url.searchParams.set("sub_id", subId);
  return url.toString();
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
