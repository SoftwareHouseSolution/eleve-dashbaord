import api from './axios';
import { normalizeGwebDiamond } from '../lib/diamond';

/**
 * GWEB diamonds (Stone.Ft5):
 *   list     -> /Stone/api/ft5/            stock list (read-only, login needed)
 *   getByZco -> /Stone/api/ft5/by-zco/<zco>/ single lookup (public)
 * Responses are mapped to dashboard field names by normalizeGwebDiamond.
 */
export const diamondsApi = {
  async list(params = {}) {
    const res = await api.get('/Stone/api/ft5/', { params });
    const data = res.data || {};
    return {
      ...res,
      data: { ...data, results: (data.results || []).map(normalizeGwebDiamond).filter(Boolean) },
    };
  },
  async getByZco(zco) {
    const res = await api.get(`/Stone/api/ft5/by-zco/${encodeURIComponent(zco)}/`);
    return { ...res, data: normalizeGwebDiamond(res.data) };
  },
};
