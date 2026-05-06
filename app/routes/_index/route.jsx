import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return {};
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Retainify — Recover lost carts on autopilot</h1>
        <p className={styles.text}>
          Automated cart recovery emails and exit-intent popups that turn abandoned checkouts into paid orders, with zero setup beyond a single toggle.
        </p>
        <a className={styles.button} href="https://apps.shopify.com/retainify">
          Install on Shopify
        </a>
        <ul className={styles.list}>
          <li>
            <strong>3-email recovery journey</strong>. Sends at 1h, 24h, and 72h after abandonment — the third email includes an automatic discount code.
          </li>
          <li>
            <strong>Exit-intent popup</strong>. Captures email addresses from leaving shoppers and immediately starts the recovery sequence.
          </li>
          <li>
            <strong>Brand-matched templates</strong>. Pick Classic, Bold, or Minimal — each one renders cleanly on every email client and uses your store's name and logo.
          </li>
        </ul>
      </div>
    </div>
  );
}
