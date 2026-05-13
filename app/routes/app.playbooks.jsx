import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = ({ request }) => {
  const url = new URL(request.url);
  return redirect(`/app/flows${url.search}`);
};

export default function LegacyPlaybooksRedirect() {
  return null;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
