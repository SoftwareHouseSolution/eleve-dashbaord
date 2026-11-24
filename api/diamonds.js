import api from './axios';
import { normalizeGwebDiamond } from '../lib/diamond';

/**
 * GWEB diamond jewelry (Dim.Fd2):
 *   list     -> /Dim/api/fd2/                stock list (needs the GWEB addition)
 *   getByZco -> /Dim/api/fd2/by-code/<code>/ single lookup (exists today, public)
 * Responses are mapped to dashboard field names by normalizeGwebDiamond.
 */
export const diamondsApi = {
  async list(params = {}) {
    const res = await api.get('/Dim/api/fd2/', { params });
    const data = res.data || {};
    return {
      ...res,
      data: { ...data, results: (data.results || []).map(normalizeGwebDiamond).filter(Boolean) },
    };
  },
  async getByZco(code) {
    const res = await api.get(`/Dim/api/fd2/by-code/${encodeURIComponent(code)}/`);
    const item = normalizeGwebDiamond(res.data);
    if (!item) {
      // GWEB answers 200 with empty fields for an unknown code.
      const err = new Error('Not in GWEB');
      err.response = { status: 404 };
      throw err;
    }
    return { ...res, data: item };
  },
};
