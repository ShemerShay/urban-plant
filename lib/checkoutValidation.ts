import { isValidEmail, isValidIsraeliMobilePhone } from "@/lib/formValidation";
import type { MessageKey } from "@/lib/messages";

export type CheckoutFulfillmentMethod = "delivery" | "pickup";

export type CheckoutFieldKey =
  | "fullName"
  | "email"
  | "phone"
  | "deliveryStreet"
  | "deliveryHouseNumber";

export interface CheckoutFormValues {
  fullName: string;
  email: string;
  phone: string;
  deliveryStreet: string;
  deliveryHouseNumber: string;
  apartmentOrNotes: string;
}

export type CheckoutFieldErrorKey = Extract<
  MessageKey,
  "validation.required" | "validation.email" | "validation.phone"
>;

export type CheckoutFieldErrors = Partial<Record<CheckoutFieldKey, CheckoutFieldErrorKey>>;

export function getCheckoutFieldErrors(
  fields: CheckoutFormValues,
  fulfillmentMethod: CheckoutFulfillmentMethod,
): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};

  if (!fields.fullName.trim()) {
    errors.fullName = "validation.required";
  }

  const emailTrim = fields.email.trim();
  if (!emailTrim) {
    errors.email = "validation.required";
  } else if (!isValidEmail(emailTrim)) {
    errors.email = "validation.email";
  }

  if (!isValidIsraeliMobilePhone(fields.phone)) {
    errors.phone = "validation.phone";
  }

  if (fulfillmentMethod === "delivery") {
    if (!fields.deliveryStreet.trim()) {
      errors.deliveryStreet = "validation.required";
    }
    if (!fields.deliveryHouseNumber.trim()) {
      errors.deliveryHouseNumber = "validation.required";
    }
  }

  return errors;
}

export function canSubmitCheckout(
  fields: CheckoutFormValues,
  fulfillmentMethod: CheckoutFulfillmentMethod,
): boolean {
  return Object.keys(getCheckoutFieldErrors(fields, fulfillmentMethod)).length === 0;
}

export function getVisibleCheckoutFieldErrors(
  fieldErrors: CheckoutFieldErrors,
  touched: Partial<Record<CheckoutFieldKey, boolean>>,
  showAllErrors: boolean,
): CheckoutFieldErrors {
  const visible: CheckoutFieldErrors = {};
  for (const key of Object.keys(fieldErrors) as CheckoutFieldKey[]) {
    const message = fieldErrors[key];
    if (message && (showAllErrors || touched[key])) {
      visible[key] = message;
    }
  }
  return visible;
}
