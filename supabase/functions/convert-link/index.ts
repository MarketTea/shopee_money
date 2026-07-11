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

type ShopeeConvertResult = {
  originalLink?: string;
  shortLink?: string;
  longLink?: string;
  commission?: string;
  rate?: string;
  commission_name?: string;
  product_image?: string;
};

type ShopeeConvertResponse = {
  success?: boolean;
  results?: ShopeeConvertResult[];
  message?: string;
  error?: string;
};

const affiliateId = Deno.env.get("SHOPEE_AFFILIATE_ID") || "17305840167";
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const shopeeConvertApi = "https://shopeecd.vercel.app/api/public/shopee/convert-link";

// ── Simple in-memory rate limiter (max 10 requests/minute per user) ──────────
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;

  entry.count++;
  return false;
}

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

    // Rate limit check — after auth so only authenticated users are tracked
    if (isRateLimited(user.id)) {
      return json({ error: "Quá nhiều yêu cầu. Vui lòng thử lại sau 1 phút." }, 429);
    }

    const body = (await req.json()) as ConvertBody;
    const originalUrl = sanitizeUrl(body.original_url);
    const normalizedUrl = sanitizeUrl(body.normalized_url || body.original_url);

    if (!originalUrl || !normalizedUrl || !isShopeeLink(originalUrl) || !isShopeeLink(normalizedUrl)) {
      return json({ error: "Invalid Shopee URL" }, 400);
    }

    const linkId = crypto.randomUUID();
    const subId = buildSubId(user.id, linkId);
    const convertedLink = await convertShopeeLink(originalUrl, subId);

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
        affiliate_url: convertedLink.affiliateUrl,
        estimated_commission: convertedLink.estimatedCommission,
        commission_rate: convertedLink.commissionRate,
        product_name: convertedLink.productName,
        product_image: convertedLink.productImage,
      })
      .select("id, sub_id, affiliate_url, normalized_url, estimated_commission, commission_rate, created_at")
      .single();

    if (insertError) {
      return json({ error: insertError.message }, 500);
    }

    return json({
      ...link,
      affiliate_id: affiliateId,
      commission: link.estimated_commission,
      rate: link.commission_rate,
    }, 200);
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

async function convertShopeeLink(originalLink: string, subId: string) {
  const response = await fetch(shopeeConvertApi, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalLink,
      affiliateId,
      subId1: subId,
    }),
  });

  let payload: ShopeeConvertResponse;
  try {
    payload = await response.json();
  } catch {
    throw new Error("ShopeeCD API returned an invalid response");
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "ShopeeCD API request failed");
  }

  if (!payload.success || !payload.results?.length) {
    throw new Error(payload.error || payload.message || "ShopeeCD API did not return a converted link");
  }

  const result = payload.results[0];
  const affiliateUrl = buildVerifiedAffiliateUrl(result.longLink || result.shortLink, originalLink, subId);

  if (!affiliateUrl) {
    throw new Error("ShopeeCD API did not return a valid affiliate link");
  }

  return {
    affiliateUrl,
    estimatedCommission: result.commission || null,
    commissionRate: result.rate || null,
    productName: result.commission_name || null,
    productImage: result.product_image || null,
  };
}

function buildVerifiedAffiliateUrl(value: string | undefined, originalLink: string, subId: string) {
  const affiliateUrl = sanitizeUrl(value);
  if (!affiliateUrl) return "";

  try {
    const parsed = new URL(affiliateUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isShopeeRedirect = hostname === "s.shopee.vn" && parsed.pathname === "/an_redir";

    if (!isShopeeRedirect) {
      throw new Error("ShopeeCD API returned an affiliate link that cannot be verified");
    }

    if (!parsed.searchParams.get("origin_link")) {
      parsed.searchParams.set("origin_link", originalLink);
    }

    parsed.searchParams.set("affiliate_id", affiliateId);
    parsed.searchParams.set("sub_id", subId);

    if (parsed.searchParams.get("affiliate_id") !== affiliateId || parsed.searchParams.get("sub_id") !== subId) {
      throw new Error("Affiliate tracking verification failed");
    }

    return parsed.toString();
  } catch (error) {
    if (error instanceof Error) throw error;
    return "";
  }
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
