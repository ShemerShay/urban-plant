import { StreetSearchSelect } from "@/components/checkout/StreetSearchSelect";
import type { CheckoutFieldKey } from "@/lib/checkoutValidation";
import { DELIVERY_ADDRESS_PILOT_HINT, TEL_AVIV_CITY } from "@/lib/deliveryAddress";

const baseInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

const invalidInputClass = "border-red-400 focus:border-red-500 focus:ring-red-200/60";

export interface DeliveryAddressFieldValues {
  deliveryStreet: string;
  deliveryHouseNumber: string;
  apartmentOrNotes: string;
}

export type DeliveryAddressFieldErrors = Partial<
  Record<keyof DeliveryAddressFieldValues, string>
>;

interface DeliveryAddressFieldsProps {
  values: DeliveryAddressFieldValues;
  errors: DeliveryAddressFieldErrors;
  onChange: (field: keyof DeliveryAddressFieldValues, value: string) => void;
  onFieldBlur?: (field: CheckoutFieldKey) => void;
}

export function DeliveryAddressFields({
  values,
  errors,
  onChange,
  onFieldBlur,
}: DeliveryAddressFieldsProps) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold text-slate-800">Delivery address</legend>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="deliveryCity">
          City
        </label>
        <input
          id="deliveryCity"
          name="deliveryCity"
          type="text"
          readOnly
          className={`${baseInputClass} cursor-default bg-slate-50 text-slate-700`}
          value={TEL_AVIV_CITY}
          aria-readonly="true"
          aria-describedby="deliveryCity-hint"
        />
        <p id="deliveryCity-hint" className="text-xs leading-relaxed text-slate-600">
          {DELIVERY_ADDRESS_PILOT_HINT}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="deliveryStreet">
          Street
          <span aria-hidden="true" className="text-red-700">
            {" "}
            *
          </span>
        </label>
        <StreetSearchSelect
          id="deliveryStreet"
          value={values.deliveryStreet}
          error={errors.deliveryStreet}
          onChange={(street) => onChange("deliveryStreet", street)}
          onBlur={() => onFieldBlur?.("deliveryStreet")}
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="deliveryHouseNumber">
          House number
          <span aria-hidden="true" className="text-red-700">
            {" "}
            *
          </span>
        </label>
        <input
          id="deliveryHouseNumber"
          name="deliveryHouseNumber"
          type="text"
          inputMode="text"
          autoComplete="off"
          aria-required="true"
          aria-invalid={errors.deliveryHouseNumber ? true : undefined}
          aria-describedby={
            errors.deliveryHouseNumber ? "deliveryHouseNumber-error" : undefined
          }
          className={`${baseInputClass} ${errors.deliveryHouseNumber ? invalidInputClass : ""}`}
          value={values.deliveryHouseNumber}
          onChange={(event) => onChange("deliveryHouseNumber", event.target.value)}
          onBlur={() => onFieldBlur?.("deliveryHouseNumber")}
          placeholder="26b"
        />
        {errors.deliveryHouseNumber ? (
          <p id="deliveryHouseNumber-error" className="text-xs text-red-700">
            {errors.deliveryHouseNumber}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700" htmlFor="apartmentOrNotes">
          Apartment / floor / notes (optional)
        </label>
        <textarea
          id="apartmentOrNotes"
          name="apartmentOrNotes"
          className={baseInputClass}
          value={values.apartmentOrNotes}
          onChange={(event) => onChange("apartmentOrNotes", event.target.value)}
          rows={3}
          placeholder="Door code, floor, delivery details..."
        />
      </div>
    </fieldset>
  );
}
