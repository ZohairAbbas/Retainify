import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import tokenStyles from "./styles/tokens.css?url";
import retainifyStyles from "./styles/retainify.css?url";
import segmentsStyles from "./styles/segments.css?url";

export const loader = async () => {
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Archivo+Black&family=Caveat:wght@500;700&family=DM+Serif+Display:ital@0;1&display=swap",
  },
  { rel: "stylesheet", href: tokenStyles },
  { rel: "stylesheet", href: retainifyStyles },
  { rel: "stylesheet", href: segmentsStyles },
];

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <script
          src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
          data-api-key={apiKey}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
