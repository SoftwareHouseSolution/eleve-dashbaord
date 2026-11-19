import api from './axios';
import { normalizeGwebDiamond } from '../lib/diamond';

/**
 * GWEB diamonds (Stone.Ft5) through GWEB's EXISTING lookup endpoint.
 * GWEB has no diamond list endpoint, so diamonds are looked up by code.
 */
export const diamondsApi = {
  async getByZco(zco) {
    const res = await api.get(`/Stone/api/ft5/by-zco/${encodeURIComponent(zco)}/`);
    return { ...res, data: normalizeGwebDiamond(res.data) };
  },
};
