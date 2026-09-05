import { PublicMenu } from "./pages/PublicMenu";
import { QRMenu } from "./pages/QRMenu";

export type AppRoute =
  | { page: "menu"; slug: string }
  | { page: "qr"; slug: string }
  | { page: "not-found" };

export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "") {
    return { page: "menu", slug: "restoniti-demo" };
  }

  const menuMatch = pathname.match(/^\/menu\/([^/]+)\/?$/);
  if (menuMatch?.[1]) {
    return { page: "menu", slug: decodeURIComponent(menuMatch[1]) };
  }

  const qrMatch = pathname.match(/^\/qr\/([^/]+)\/?$/);
  if (qrMatch?.[1]) {
    return { page: "qr", slug: decodeURIComponent(qrMatch[1]) };
  }

  return { page: "not-found" };
}

export function App() {
  const route = parseAppRoute(window.location.pathname);

  if (route.page === "qr") {
    return <QRMenu slug={route.slug} />;
  }

  return <PublicMenu slug={route.page === "menu" ? route.slug : null} />;
}
