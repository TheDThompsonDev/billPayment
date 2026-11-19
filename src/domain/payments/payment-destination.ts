export function demoOrigin() {
  return process.env.PAYMENT_DEMO_ORIGIN || "http://127.0.0.1:3002";
}
export function destinationURL(raw: string) {
  const url = new URL(raw.trim());
  if (url.username || url.password || url.hash)
    throw new Error("Use a payment URL without credentials or a fragment");
  const demo = new URL(demoOrigin());
  const isDemo =
    url.origin === demo.origin &&
    /^\/payment-demo\/(classic|compact)$/.test(url.pathname) &&
    !url.search;
  if (
    !isDemo &&
    (url.protocol !== "https:" ||
      (url.port && url.port !== "443") ||
      /^(localhost|.*\.localhost|.*\.local|.*\.internal)$|^\[|^\d+\.\d+\.\d+\.\d+$/.test(
        url.hostname,
      ))
  )
    throw new Error(
      "Use a public HTTPS vendor website or the local payment simulator",
    );
  // Hosted simulations are explicit origins, never inferred from a "demo" name.
  // Keep isDemo reserved for the local portal's token and receipt-ledger protocol.
  const isHostedDemo =
    !isDemo &&
    (process.env.PAYMENT_BROWSER_DEMO_ORIGINS || "")
      .split(",")
      .some((entry) => entry.trim() === url.origin);
  return { url: url.href, isDemo, isHostedDemo };
}
export function chooseDestination(links: string[], remembered: string | null) {
  const urls = [
    ...new Set(
      links
        .map((link) => {
          try {
            return destinationURL(link).url;
          } catch {
            return null;
          }
        })
        .filter((url): url is string => !!url),
    ),
  ];
  if (
    remembered &&
    (links.length === 0 ||
      (urls.length === 1 &&
        urls.length === new Set(links).size &&
        urls[0] === remembered))
  )
    return {
      destination: remembered,
      status: "READY",
      source: "Previously verified vendor website",
      verifiedBy: "Saved vendor destination",
    };
  return {
    destination: urls.length === 1 ? urls[0] : null,
    status: "NEEDS_DESTINATION",
    source:
      urls.length > 1
        ? "Multiple payment links found; choose the vendor's payment site"
        : urls.length === 1
          ? "Payment link printed on the invoice"
          : "No payment link found; confirm the vendor's payment website",
    verifiedBy: null,
  };
}
