'use strict';

/**
 * Builds a MongoDB query that matches sales for a given shop.
 * Filters by soldByShop (the shop that performed the sale) with a backward-compat
 * fallback to the shop field for older records that pre-date the soldByShop field.
 */
function buildSalesByShopQuery(shop) {
  if (!shop || typeof shop !== 'string') return {};
  return {
    $or: [
      { soldByShop: shop },
      { soldByShop: { $exists: false }, shop },
      { soldByShop: null, shop },
    ],
  };
}

module.exports = { buildSalesByShopQuery };
