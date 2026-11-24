'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, RotateCcw, ScanBarcode, X } from 'lucide-react';
import { diamondsApi } from '../../api/diamonds';
import { formatFn6Currency } from '../../lib/fn6ItemFields';
import { IMPORT_STATUS, MAX_BULK_CODES, isSelectable } from '../../lib/bulkImport';
import { classifyDiamond, formatCarat } from '../../lib/diamond';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const PAGE_SIZE = 50;
const SELECT_ALL_PAGE_SIZE = 200;

function StatusBadge({ c }) {
  if (c.status === IMPORT_STATUS.LISTED) return <Badge variant="secondary">On Shopify</Badge>;
  if (c.status === IMPORT_STATUS.NO_PRICE) return <Badge variant="destructive">No price</Badge>;
  if (c.status === IMPORT_STATUS.INVALID) return <Badge variant="destructive">{c.reason || 'Invalid'}</Badge>;
  return <Badge>Ready</Badge>;
}

/**
 * GWEB diamond stock (/Dim/api/fd2/) — the diamond version of the gold
 * BulkItemPicker: search, pages, select a page or everything matching.
 */
export default function DiamondBrowse({ listedSkus, selected, onSelectionChange, disabled }) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectingCount, setSelectingCount] = useState(0);
  const cancelRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await diamondsApi.list({ ...applied, page, page_size: PAGE_SIZE });
      setRows(res.data.results);
      setTotal(Number(res.data.count) || 0);
    } catch (err) {
      setError(err?.response?.status === 404
        ? 'The diamond stock list isn’t on the GWEB server yet. Use the “By code” tab for now.'
        : (err?.response?.data?.detail || err.message || 'Failed to load diamonds'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { load(); }, [load]);

  const classified = useMemo(
    () => rows.map(item => ({ item, c: classifyDiamond(item, listedSkus) })),
    [rows, listedSkus],
  );
  const selectableOnPage = useMemo(
    () => classified.filter(r => isSelectable(r.c)).map(r => r.c.code),
    [classified],
  );
  const allPageSelected = selectableOnPage.length > 0 && selectableOnPage.every(c => selected.has(c));

  const apply = () => { setApplied(search.trim() ? { search: search.trim() } : {}); setPage(1); };
  const clear = () => { setSearch(''); setApplied({}); setPage(1); };

  const toggleOne = (code, on) => {
    const next = new Set(selected);
    if (on) next.add(code); else next.delete(code);
    onSelectionChange(next);
  };
  const togglePage = (on) => {
    const next = new Set(selected);
    for (const code of selectableOnPage) { if (on) next.add(code); else next.delete(code); }
    onSelectionChange(next);
  };

  const selectAllMatching = async () => {
    cancelRef.current = false;
    setSelectingAll(true);
    setSelectingCount(0);
    setError('');
    const next = new Set(selected);
    try {
      let current = 1;
      for (;;) {
        if (cancelRef.current) break;
        const res = await diamondsApi.list({ ...applied, page: current, page_size: SELECT_ALL_PAGE_SIZE });
        for (const item of res.data.results) {
          const c = classifyDiamond(item, listedSkus);
          if (isSelectable(c)) next.add(c.code);
        }
        setSelectingCount(next.size);
        onSelectionChange(new Set(next));
        if (next.size >= MAX_BULK_CODES) {
          setError(`Stopped at ${MAX_BULK_CODES} diamonds — publish these, then select the rest.`);
          break;
        }
        if (!res.data.next) break;
        current += 1;
      }
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to select all');
    } finally {
      setSelectingAll(false);
    }
  };

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const busy = disabled || loading || selectingAll;

  return (
    <div className="space-y-4">
      <div className="filters-card">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Search code or name
            </Label>
            <div className="relative">
              <ScanBarcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search diamonds…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') apply(); }}
                className="pl-9"
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={apply} disabled={busy} className="gap-1.5">
              <ScanBarcode size={13} /> Search
            </Button>
            {search && (
              <Button size="sm" variant="ghost" onClick={clear} disabled={busy} className="gap-1.5 text-muted-foreground">
                <RotateCcw size={13} /> Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="scan-error">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <Checkbox
            checked={allPageSelected}
            onCheckedChange={v => togglePage(Boolean(v))}
            disabled={disabled || selectableOnPage.length === 0}
            aria-label="Select all publishable diamonds on this page"
          />
          <span className="text-muted-foreground">
            Select this page ({selectableOnPage.length} publishable) · {total} in stock
          </span>
        </label>
        <div className="flex items-center gap-2">
          {selectingAll && (
            <Button size="sm" variant="ghost" className="h-8 text-xs gap-1 text-muted-foreground"
              onClick={() => { cancelRef.current = true; }}>
              <X size={12} /> Cancel
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={selectAllMatching} disabled={busy || total === 0}>
            {selectingAll
              ? <><Loader2 size={13} className="animate-spin mr-1.5" />Selecting… {selectingCount}</>
              : <>Select all {total} matching</>}
          </Button>
        </div>
      </div>

      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 p-2" />
              <th className="text-left p-2 font-medium">Code</th>
              <th className="text-left p-2 font-medium">Name</th>
              <th className="text-left p-2 font-medium">Carat</th>
              <th className="text-left p-2 font-medium">Shape</th>
              <th className="text-left p-2 font-medium">Color</th>
              <th className="text-left p-2 font-medium">Clarity</th>
              <th className="text-right p-2 font-medium">Qty</th>
              <th className="text-right p-2 font-medium">Price</th>
              <th className="text-left p-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">
                <Loader2 size={16} className="animate-spin inline mr-2" />Loading diamonds…
              </td></tr>
            ) : classified.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No diamonds match this filter</td></tr>
            ) : classified.map(({ item, c }) => {
              const code = c.code;
              const canSelect = isSelectable(c);
              const isSelected = selected.has(code);
              const clickable = canSelect && !disabled;
              return (
                <tr
                  key={code || item.id}
                  onClick={clickable ? () => toggleOne(code, !isSelected) : undefined}
                  className={[
                    'border-t',
                    canSelect ? '' : 'opacity-50',
                    clickable ? 'cursor-pointer hover:bg-muted/40' : '',
                    isSelected ? 'bg-gold-50 dark:bg-gold-900/20' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={v => toggleOne(code, Boolean(v))}
                      onClick={e => e.stopPropagation()}
                      disabled={disabled || !canSelect}
                      aria-label={`Select ${code}`}
                      className="border-2 border-muted-foreground/50 data-[state=checked]:border-gold-500"
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{code}</td>
                  <td className="p-2 max-w-[200px] truncate">{item.zdis || '—'}</td>
                  <td className="p-2 text-xs">{formatCarat(item.carat) || '—'}</td>
                  <td className="p-2 text-xs">{item.shape || '—'}</td>
                  <td className="p-2 text-xs">{item.color || '—'}</td>
                  <td className="p-2 text-xs">{item.clarity || '—'}</td>
                  <td className="p-2 text-right text-xs">{item.qty}</td>
                  <td className="p-2 text-right text-xs">{c.price ? formatFn6Currency(c.price) : '—'}</td>
                  <td className="p-2"><StatusBadge c={c} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="pagination-bar">
          <Button size="sm" variant="outline" className="h-8" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Button>
          <span className="text-xs text-muted-foreground px-2">Page {page} of {lastPage}</span>
          <Button size="sm" variant="outline" className="h-8" disabled={busy || page >= lastPage} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
