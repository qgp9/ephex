import { onRequest as authMiddleware } from "./middleware/auth.js";
import { onRequestPost as changePassword } from "./routes/change_password.js";
import { onRequestPost as createUser } from "./routes/create_user.js";
import { onRequestPost as deleteImage } from "./routes/delete_image.js";
import { onRequestGet as listImages } from "./routes/images.js";
import { onRequestPost as login } from "./routes/login.js";
import { onRequestPost as logout } from "./routes/logout.js";
import { onRequestGet as profile } from "./routes/profile.js";
import { onRequestGet as getRawImage } from "./routes/raw/[id].js";
import { onRequestPost as regenerateToken } from "./routes/regenerate_token.js";
import { onRequestPost as saveSettings } from "./routes/save_settings.js";
import { onRequestPost as upload } from "./routes/upload.js";
import { onRequestGet as listUsers } from "./routes/users.js";

const routes = [
  { method: "POST", pathname: "/api/login", handler: login },
  { method: "POST", pathname: "/api/logout", handler: logout },
  { method: "GET", pathname: "/api/profile", handler: profile },
  { method: "POST", pathname: "/api/save_settings", handler: saveSettings },
  { method: "POST", pathname: "/api/regenerate_token", handler: regenerateToken },
  { method: "POST", pathname: "/api/change_password", handler: changePassword },
  { method: "POST", pathname: "/api/upload", handler: upload },
  { method: "GET", pathname: "/api/images", handler: listImages },
  { method: "POST", pathname: "/api/delete_image", handler: deleteImage },
  { method: "GET", pathname: "/api/users", handler: listUsers },
  { method: "POST", pathname: "/api/create_user", handler: createUser },
  {
    method: "GET",
    match: (pathname) => {
      const rawMatch = pathname.match(/^\/img\/([^/.]+)\.([^/]+)$/);
      if (!rawMatch) {
        return null;
      }

      return { id: rawMatch[1], filename: rawMatch[0].split("/").pop() };
    },
    handler: getRawImage,
  },
  {
    method: "GET",
    match: (pathname) => {
      const rawMatch = pathname.match(/^\/api\/raw\/([^/]+)(?:\/([^/]+))?$/);
      if (!rawMatch) {
        return null;
      }

      return { id: rawMatch[1], filename: rawMatch[2] };
    },
    handler: getRawImage,
  },
];

function jsonResponse(body, status = 404) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runMiddleware(request, env, data) {
  let passed = false;
  const result = await authMiddleware({
    request,
    env,
    data,
    next: async () => {
      passed = true;
      return null;
    },
  });

  if (result instanceof Response) {
    return result;
  }

  if (!passed) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

function matchRoute(method, pathname) {
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }

    if (route.pathname === pathname) {
      return { handler: route.handler, params: {} };
    }

    if (route.match) {
      const params = route.match(pathname);
      if (params) {
        return { handler: route.handler, params };
      }
    }
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);

    if (!route) {
      return jsonResponse({ error: "Not Found" });
    }

    const data = {};
    const authResult = await runMiddleware(request, env, data);
    if (authResult) {
      return authResult;
    }

    return route.handler({
      request,
      env,
      ctx,
      data,
      params: route.params,
    });
  },
};
