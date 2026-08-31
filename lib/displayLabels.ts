import type { Locale } from "@/lib/locale";
import { t, type MessageKey } from "@/lib/messages";
import {
  PLANT_IMAGE_GIF_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_SOURCE_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_UNPROCESSABLE_MESSAGE,
  PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE,
  PLANT_IMAGE_UPLOAD_FAILED_MESSAGE,
} from "@/lib/plantImageUpload";
import type { CheckoutFieldErrors, CheckoutFieldKey } from "@/lib/checkoutValidation";
import type { InventoryStatus, OrderStatus, PlantStatus } from "@/lib/status";
import type { PosSpotStatus } from "@/lib/posSpotTypes";
import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

export function inventoryStatusLabel(locale: Locale, status: InventoryStatus): string {
  switch (status) {
    case "available":
      return t(locale, "status.inventory.available");
    case "sold":
      return t(locale, "status.inventory.sold");
    case "inactive":
      return t(locale, "status.inventory.inactive");
    case "held_for_payment":
      return t(locale, "status.inventory.held_for_payment");
  }
}

export function orderStatusLabel(locale: Locale, status: OrderStatus): string {
  switch (status) {
    case "pending_payment":
      return t(locale, "status.order.pending_payment");
    case "sold":
      return t(locale, "status.order.sold");
    case "picked_up":
      return t(locale, "status.order.picked_up");
    case "delivered":
      return t(locale, "status.order.delivered");
    case "cancelled":
      return t(locale, "status.order.cancelled");
  }
}

export function plantStatusLabel(locale: Locale, status: PlantStatus): string {
  switch (status) {
    case "available":
      return t(locale, "status.plant.available");
    case "sold":
      return t(locale, "status.plant.sold");
    case "picked_up":
      return t(locale, "status.plant.picked_up");
    case "delivered":
      return t(locale, "status.plant.delivered");
    case "cancelled":
      return t(locale, "status.plant.cancelled");
  }
}

export function adminHeldForPaymentLabel(locale: Locale): string {
  return t(locale, "status.admin.held_for_payment");
}

export function lightLabel(locale: Locale, light: LightLevel): string {
  switch (light) {
    case "Low light":
      return t(locale, "plant.light.low");
    case "Medium light":
      return t(locale, "plant.light.medium");
    case "Bright indirect light":
      return t(locale, "plant.light.brightIndirect");
    case "Direct sun":
      return t(locale, "plant.light.directSun");
  }
}

export function careLabel(locale: Locale, difficulty: CareLevel): string {
  switch (difficulty) {
    case "Easy":
      return t(locale, "plant.care.easy");
    case "Moderate":
      return t(locale, "plant.care.moderate");
    case "Advanced":
      return t(locale, "plant.care.advanced");
  }
}

export function sizeLabel(locale: Locale, averageSize: PlantProduct["averageSize"]): string {
  switch (averageSize) {
    case "small":
      return t(locale, "plant.size.small");
    case "medium":
      return t(locale, "plant.size.medium");
    case "large":
      return t(locale, "plant.size.large");
    case "x-large":
      return t(locale, "plant.size.xlarge");
    default:
      return "";
  }
}

export function fulfillmentLabel(locale: Locale, method: "delivery" | "pickup"): string {
  return method === "pickup"
    ? t(locale, "checkout.fulfillment.pickup")
    : t(locale, "checkout.fulfillment.delivery");
}

export function productPageCtaDisplay(
  locale: Locale,
  status: PosSpotStatus,
  availableCtaText: string,
): string {
  if (status === "held_for_payment") return t(locale, "plant.cta.held");
  if (status === "sold") return t(locale, "plant.cta.sold");
  return availableCtaText;
}

export function translateCheckoutFieldErrors(
  locale: Locale,
  errors: CheckoutFieldErrors,
): Partial<Record<CheckoutFieldKey, string>> {
  const out: Partial<Record<CheckoutFieldKey, string>> = {};
  for (const key of Object.keys(errors) as CheckoutFieldKey[]) {
    const msgKey = errors[key];
    if (msgKey) out[key] = t(locale, msgKey);
  }
  return out;
}

const API_ERROR_KEYS: Record<string, MessageKey> = {
  "Could not start payment. Try again.": "checkout.error.startPayment",
  "Could not restart payment. Try again.": "checkout.error.restartPayment",
  "Could not retry payment. Try again.": "checkout.error.retryPayment",
  "Payment is temporarily unavailable. Try again later.": "checkout.error.unavailable",
  "Payment session is not available to retry.": "checkout.error.retrySession",
  "This plant is no longer held for your payment.": "checkout.error.noLongerHeld",
  "Payment is already being prepared. Please wait.": "checkout.error.alreadyPreparing",
  "This POS Spot is not available for purchase.": "checkout.error.spotUnavailable",
  "This POS Spot is no longer available for purchase.": "checkout.error.spotNoLonger",
  "Offer is not available": "checkout.error.offerUnavailable",
  "Pickup is not available at this location.": "checkout.error.pickupUnavailable",
  "Please enter a valid 10-digit Israeli phone number.": "validation.phone",
  "fullName is required": "validation.required",
  "Incorrect password.": "admin.login.badPassword",
  "Network error. Try again.": "common.networkError",
  "Could not load partners": "admin.partners.loadFailed",
  "Could not load POS spots": "admin.pos.loadFailed",
  "Could not save partner": "admin.partners.saveFailed",
  "Could not create partner": "admin.partners.createFailed",
  "Could not save POS Spot": "admin.qr.saveFailed",
  [PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE]: "admin.image.unsupportedType",
  [PLANT_IMAGE_SOURCE_TOO_LARGE_MESSAGE]: "admin.image.sourceTooLarge",
  [PLANT_IMAGE_GIF_TOO_LARGE_MESSAGE]: "admin.image.gifTooLarge",
  [PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE]: "admin.image.preprocessFailed",
  [PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE]: "admin.image.processedTooLarge",
  [PLANT_IMAGE_UPLOAD_FAILED_MESSAGE]: "admin.image.uploadFailed",
  [PLANT_IMAGE_UNPROCESSABLE_MESSAGE]: "admin.image.unprocessable",
  "Could not load library": "admin.image.loadLibraryFailed",
  "Network error while loading library": "admin.image.loadLibraryNetwork",
  "Could not save plant": "admin.plants.saveFailed",
  "Could not delete plant": "admin.plants.deleteFailed",
  "Could not load plants": "admin.plants.loadFailed",
  "Network error while loading plants": "admin.plants.loadNetworkError",
  "Could not create plant": "admin.plants.createFailed",
  "Could not save offer": "admin.offers.saveFailed",
  "Could not load offers": "admin.offers.loadFailed",
  "Network error while loading offers": "admin.offers.loadNetworkError",
  "Could not create offer": "admin.offers.createFailed",
};

export function offerStatusLabel(locale: Locale, status: string): string {
  return status === "active"
    ? t(locale, "admin.offer.active")
    : t(locale, "admin.offer.inactive");
}

export function posSpotAdminAvailabilityLabel(locale: Locale, status: PosSpotStatus): string {
  if (status === "held_for_payment") return t(locale, "status.admin.held_for_payment");
  if (status === "sold") return t(locale, "admin.pos.unavailable");
  if (status === "inactive") return t(locale, "status.inventory.inactive");
  return t(locale, "status.inventory.available");
}

export function yesNoLabel(locale: Locale, value: boolean): string {
  return t(locale, value ? "admin.common.yes" : "admin.common.no");
}

export function displayApiError(
  locale: Locale,
  error: string | undefined,
  fallbackKey: MessageKey,
): string {
  if (!error) return t(locale, fallbackKey);
  const key = API_ERROR_KEYS[error];
  return key ? t(locale, key) : t(locale, fallbackKey);
}
