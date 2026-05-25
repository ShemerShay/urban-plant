import { getPlantById } from "@/lib/plantCatalog";

import type { Offer, OfferWithProduct } from "./offerTypes";

export async function enrichOfferWithProduct(offer: Offer): Promise<OfferWithProduct> {
  const product = await getPlantById(offer.productId);
  return {
    ...offer,
    productName: product?.name ?? offer.productId,
    currency: product?.currency ?? "ILS",
    plantImages: product?.images ?? [],
    plantSubtitle: product?.subtitle ?? "",
  };
}

export async function enrichOffersWithProduct(offers: Offer[]): Promise<OfferWithProduct[]> {
  return Promise.all(offers.map(enrichOfferWithProduct));
}
