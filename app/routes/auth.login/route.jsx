import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { login } from "../../shopify.server";

export const loader = async ({ request }) => {
  await login(request);
  return {};
};

export const action = async ({ request }) => {
  await login(request);
  return {};
};

export default function Auth() {
  useLoaderData();

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Install Retainify">
          <s-paragraph>
            To use Retainify, install the app from the Shopify App Store. The app will be added to your store automatically.
          </s-paragraph>
          <s-button
            href="https://apps.shopify.com/retainify"
            target="_blank"
          >
            Open Shopify App Store
          </s-button>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
