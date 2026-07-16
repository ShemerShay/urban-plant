/**
 * POS Spot URL helpers — re-exports from the centralized routes module
 * so QR generation and landing pages share one path builder.
 */

export {
  absoluteAppUrl,
  getClientOrigin,
  posSpotCheckoutPath,
  posSpotPath,
} from "@/lib/routes";
