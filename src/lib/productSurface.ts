/**
 * Card Master deliberately exposes only the validated Foundation product
 * surface. Upstream Skills Manager capabilities remain available in the
 * backend for compatibility, but they must not silently define the product.
 */
export interface CardMasterProductSurface {
  presets: boolean;
  tags: boolean;
  projects: boolean;
}

export const CARD_MASTER_PRODUCT_SURFACE: CardMasterProductSurface = {
  presets: false,
  tags: false,
  projects: false,
};
