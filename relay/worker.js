// Minimal secretless CORS relay for the two github.com device-flow
// endpoints that do not send CORS headers. Holds no secret and no state —
// it only forwards the request body verbatim and adds a CORS header to the
// response. See docs/design.md section 3.4 for why this exists. Deployed as
// the Cloudflare Worker at https://notes-auth-relay-spike.ph1204.workers.dev
// (name predates promotion out of spikes/; see docs/impl.md Phase 0/2).
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function relay(request, targetUrl, origin) {
  const body = await request.text();
  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname === "/device/code" && request.method === "POST") {
      return relay(request, "https://github.com/login/device/code", origin);
    }
    if (url.pathname === "/oauth/token" && request.method === "POST") {
      return relay(
        request,
        "https://github.com/login/oauth/access_token",
        origin,
      );
    }
    return new Response("Not found", { status: 404 });
  },
};
