import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    // Use anon key for user auth, service role key for bypassing RLS to fetch profile names
    const authSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await authSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid user session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Get user profile
    const { data: profile } = await adminSupabase
      .from("profiles")
      .select("referral_code, referral_reward_count")
      .eq("id", user.id)
      .single();

    if (!profile) {
      throw new Error("Profile not found");
    }

    // 2. Get referrals
    const { data: referrals } = await adminSupabase
      .from("referrals")
      .select(`
        status, 
        created_at, 
        rewarded_at, 
        referrer_reward, 
        referred:profiles!referrals_referred_id_fkey(full_name, avatar_url)
      `)
      .eq("referrer_id", user.id)
      .order("created_at", { ascending: false });

    const refList = referrals || [];

    // 3. Calculate stats
    const totalReferred = refList.length;
    const totalRewarded = refList.filter((r) => r.status === "rewarded").length;
    const totalRewardEarned = refList
      .filter((r) => r.status === "rewarded")
      .reduce((sum, r) => sum + Number(r.referrer_reward || 0), 0);
    const pendingCount = refList.filter((r) => r.status === "pending").length;

    // Monthly limit
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyRewarded = refList.filter((r) => {
      if (r.status !== "rewarded" || !r.rewarded_at) return false;
      const d = new Date(r.rewarded_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    const stats = {
      referral_code: profile.referral_code,
      total_referred: totalReferred,
      total_rewarded: totalRewarded,
      total_reward_earned: totalRewardEarned,
      pending_count: pendingCount,
      monthly_limit: 15,
      monthly_rewarded: monthlyRewarded,
      monthly_remaining: Math.max(0, 15 - monthlyRewarded),
      referral_list: refList.map((r: any) => ({
        full_name: r.referred?.full_name || "Người dùng",
        avatar_url: r.referred?.avatar_url || null,
        status: r.status,
        joined_at: r.created_at,
        rewarded_at: r.rewarded_at,
        reward_earned: r.status === "rewarded" ? Number(r.referrer_reward) : 0,
      })),
    };

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
