import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = ({ request, params }) => {
  const url = new URL(request.url);
  return redirect(`/app/automations/${params.id}${url.search}`);
};

export default function LegacyPlaybookRedirect() {
  return null;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
