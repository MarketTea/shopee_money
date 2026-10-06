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

type AddLiveProductInfo = {
  itemId?: number;
  shopId?: number;
  catId?: number;
  productName?: string;
  shopName?: string;
  price?: number;
  sales?: number;
  imageUrl?: string;
  productLink?: string;
  originLink?: string;
  rating?: string;
  commission?: number;
  sellerComFinal?: number;
  shopeeComFinal?: number;
  sellerRatePercent?: number;
  shopeeRatePercent?: number;
  totalRatePercent?: number;
  affiliateId?: string | null;
  subId?: string | null;
  affLink?: string | null;
};

type AddLiveResponse = {
  status?: string;
  message?: string;
  productInfo?: AddLiveProductInfo;
};

const affiliateId = Deno.env.get("SHOPEE_AFFILIATE_ID") || "17305840167";
const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const addliveApiKey = Deno.env.get("ADDLIVETAG_API_KEY") || "";
const productDataApi = "https://data.addlivetag.com/product-data/product-data.php";

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
      .select("id, sub_id, affiliate_url, normalized_url, estimated_commission, commission_rate, product_name, product_image, created_at")
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
  if (!addliveApiKey) {
    throw new Error("ADDLIVETAG_API_KEY is not configured in Supabase secrets");
  }

  const targetUrl = new URL(productDataApi);
  targetUrl.searchParams.set("url", originalLink);
  targetUrl.searchParams.set("affiliateId", affiliateId);
  targetUrl.searchParams.set("subId", subId);

  const response = await fetch(targetUrl.toString(), {
    method: "GET",
    headers: {
      "X-API-Key": addliveApiKey,
    },
  });

  let payload: AddLiveResponse;
  try {
    payload = await response.json();
  } catch {
    throw new Error("AddLiveTag API returned an invalid response");
  }

  if (!response.ok || payload.status !== "success" || !payload.productInfo) {
    throw new Error(payload.message || "AddLiveTag API request failed");
  }

  const info = payload.productInfo;
  const affiliateUrl = buildVerifiedAffiliateUrl(
    info.affLink,
    info.originLink || info.productLink || originalLink,
    subId
  );

  if (!affiliateUrl) {
    throw new Error("Could not create a verified affiliate link");
  }

  return {
    affiliateUrl,
    estimatedCommission: info.commission != null ? formatVnd(info.commission) : null,
    commissionRate: info.totalRatePercent != null ? String(info.totalRatePercent) : null,
    productName: info.productName || null,
    productImage: info.imageUrl || null,
  };
}

function formatVnd(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  if (isNaN(num)) return String(value);
  return `${new Intl.NumberFormat("vi-VN").format(num)}đ`;
}

function buildVerifiedAffiliateUrl(value: string | undefined | null, originalLink: string, subId: string) {
  let candidate = sanitizeUrl(value || "");

  if (!candidate || !candidate.includes("s.shopee.vn/an_redir")) {
    const targetLink = sanitizeUrl(originalLink);
    candidate = `https://s.shopee.vn/an_redir?origin_link=${encodeURIComponent(targetLink)}&affiliate_id=${affiliateId}&sub_id=${subId}`;
  }

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    const isShopeeRedirect = hostname === "s.shopee.vn" && parsed.pathname === "/an_redir";

    if (!isShopeeRedirect) {
      throw new Error("Affiliate link cannot be verified");
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
