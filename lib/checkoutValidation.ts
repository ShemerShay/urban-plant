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

/**
 * Optional email opt-in rules (POS plant checkout).
 * Omitted -> legacy behavior: name, email and phone are always required.
 * Provided:
 * - delivery: name, phone and address required; email only when `emailOptIn`.
 * - pickup: nothing required; email only (required + valid) when `emailOptIn`.
 */
export interface CheckoutValidationRules {
  emailOptIn: boolean;
}

/** Which customer fields are visible/required for the current rules. */
export function getCheckoutCustomerFieldRequirements(
  fulfillmentMethod: CheckoutFulfillmentMethod,
  rules?: CheckoutValidationRules,
): { fullName: boolean; email: boolean; phone: boolean } {
  if (!rules) {
    return { fullName: true, email: true, phone: true };
  }
  const delivery = fulfillmentMethod === "delivery";
  return { fullName: delivery, email: rules.emailOptIn, phone: delivery };
}

export function getCheckoutFieldErrors(
  fields: CheckoutFormValues,
  fulfillmentMethod: CheckoutFulfillmentMethod,
  rules?: CheckoutValidationRules,
): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {};
  const required = getCheckoutCustomerFieldRequirements(fulfillmentMethod, rules);

  if (required.fullName && !fields.fullName.trim()) {
    errors.fullName = "validation.required";
  }

  if (required.email) {
    const emailTrim = fields.email.trim();
    if (!emailTrim) {
      errors.email = "validation.required";
    } else if (!isValidEmail(emailTrim)) {
      errors.email = "validation.email";
    }
  }

  if (required.phone && !isValidIsraeliMobilePhone(fields.phone)) {
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
  rules?: CheckoutValidationRules,
): boolean {
  return (
    Object.keys(getCheckoutFieldErrors(fields, fulfillmentMethod, rules)).length === 0
  );
}

export type CheckoutCustomerServerInput = {
  fulfillmentMethod: CheckoutFulfillmentMethod;
  /** undefined -> legacy all-required rules. */
  emailOptIn?: boolean;
  fullName: string;
  email: string;
  phone: string;
};

/**
 * Server-side plant customer validation. Returns the first error (same English
 * strings the API has always used) or null. Shared by POS prep.
 */
export function getCheckoutCustomerServerError(
  input: CheckoutCustomerServerInput,
): string | null {
  const rules =
    typeof input.emailOptIn === "boolean"
      ? { emailOptIn: input.emailOptIn }
      : undefined;
  const required = getCheckoutCustomerFieldRequirements(input.fulfillmentMethod, rules);
  if (required.fullName && !input.fullName.trim()) {
    return "fullName is required";
  }
  if (required.email) {
    const email = input.email.trim();
    if (!email || !isValidEmail(email)) {
      return "customerEmail is required and must be a valid email";
    }
  }
  if (required.phone) {
    const phone = input.phone.trim();
    if (!phone || !isValidIsraeliMobilePhone(phone)) {
      return "Please enter a valid 10-digit Israeli phone number.";
    }
  }
  return null;
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
