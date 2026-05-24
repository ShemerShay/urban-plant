import { getPlantById } from "@/lib/plantCatalog";

import type { Offer, OfferWithProduct } from "./offerTypes";

export function enrichOfferWithProduct(offer: Offer): OfferWithProduct {
  const product = getPlantById(offer.productId);
  return {
    ...offer,
    productName: product?.name ?? offer.productId,
    currency: product?.currency ?? "ILS",
    plantImages: product?.images ?? [],
    plantSubtitle: product?.subtitle ?? "",
  };
}

export function enrichOffersWithProduct(offers: Offer[]): OfferWithProduct[] {
  return offers.map(enrichOfferWithProduct);
}
