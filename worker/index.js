/**
 * Cloudflare Worker entrypoint for the static Phase 1 validation build.
 * Sites binds the files copied into dist/ as ASSETS.
 */
export default {
  async fetch(request, env) {
    if (!env?.ASSETS) {
      return new Response("ASSETS binding is not configured", { status: 500 });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== "GET") {
      return response;
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || !url.pathname.includes(".")) {
      return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
    }

    return response;
  },
};
