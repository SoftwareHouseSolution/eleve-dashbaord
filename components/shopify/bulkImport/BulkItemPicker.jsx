'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ImageOff, Loader2, RotateCcw, ScanBarcode } from 'lucide-react';
import { fn6Api } from '../../../api/fn6';
import { TYPE_LABELS, TYPE_OPTIONS } from '../../../constants/fn6';
import { formatFn6Currency } from '../../../lib/fn6ItemFields';
import { IMPORT_STATUS, MAX_BULK_CODES, classifyItem, isSelectable } from '../../../lib/bulkImport';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../ui/select';

const PAGE_SIZE = 50;
const SELECT_ALL_PAGE_SIZE = 200;

function StatusBadge({ classification }) {
  if (classification.status === IMPORT_STATUS.LISTED) {
    return <Badge variant="secondary">On Shopify</Badge>;
  }
  if (classification.status === IMPORT_STATUS.NO_PRICE) {
    return <Badge variant="destructive">No price</Badge>;
  }
  if (classification.status === IMPORT_STATUS.INVALID) {
    return <Badge variant="destructive">Invalid</Badge>;
  }
  if (classification.photos === 0) {
    return (
      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300">
        <ImageOff size={11} className="mr-1" />No photos
      </Badge>
    );
  }
  return <Badge>Ready</Badge>;
}

export default function BulkItemPicker({ listedSkus, rates, selected, onSelectionChange, disabled }) {
  const [search, setSearch] = useState('');
  const [karat, setKarat] = useState(undefined);
  const [applied, setApplied] = useState({});
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectingAll, setSelectingAll] = useState(false);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fn6Api.list({ ...applied, page, page_size: PAGE_SIZE });
      setRows(res.data?.results || []);
      setTotal(Number(res.data?.count) || 0);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load items');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { loadPage(); }, [loadPage]);

  const classified = useMemo(
    () => rows.map(item => ({ item, classification: classifyItem(item, listedSkus, rates) })),
    [rows, listedSkus, rates],
  );

  const selectableOnPage = useMemo(
    () => classified.filter(r => isSelectable(r.classification)).map(r => r.classification.code),
    [classified],
  );

  const allPageSelected = selectableOnPage.length > 0
    && selectableOnPage.every(code => selected.has(code));

  const applyFilters = () => {
    const params = {};
    if (search.trim()) params.search = search.trim();
    if (karat) params.co = karat;
    setApplied(params);
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setKarat(undefined);
    setApplied({});
    setPage(1);
  };

  const toggleOne = (code, on) => {
    const next = new Set(selected);
    if (on) next.add(code);
    else next.delete(code);
    onSelectionChange(next);
  };

  const togglePage = (on) => {
    const next = new Set(selected);
    for (const code of selectableOnPage) {
      if (on) next.add(code);
      else next.delete(code);
    }
    onSelectionChange(next);
  };

  /**
   * Select every item the current filter matches, not just this page —
   * this is the "1000 at once" path. Pages through the whole result set so
   * each item is still classified before it can be selected.
   */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    setError('');
    const next = new Set(selected);
    try {
      let current = 1;
      for (;;) {
        const res = await fn6Api.list({ ...applied, page: current, page_size: SELECT_ALL_PAGE_SIZE });
        const batch = res.data?.results || [];
        for (const item of batch) {
          const classification = classifyItem(item, listedSkus, rates);
          if (isSelectable(classification)) next.add(classification.code);
        }
        if (next.size >= MAX_BULK_CODES) {
          setError(`Stopped at ${MAX_BULK_CODES} items — run this batch, then select the rest.`);
          break;
        }
        if (!res.data?.next) break;
        current += 1;
      }
      onSelectionChange(next);
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to select all matching items');
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
                placeholder="Scan or type item code…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyFilters(); }}
                className="pl-9"
                disabled={busy}
              />
            </div>
          </div>
          <div className="w-36">
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">Karat</Label>
            <Select value={karat} onValueChange={setKarat} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="All" /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.filter(o => o.value).map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={applyFilters} disabled={busy} className="gap-1.5">
              <ScanBarcode size={13} /> Search
            </Button>
            {(search || karat) && (
              <Button size="sm" variant="ghost" onClick={clearFilters} disabled={busy} className="gap-1.5 text-muted-foreground">
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
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allPageSelected}
            onCheckedChange={v => togglePage(Boolean(v))}
            disabled={busy || selectableOnPage.length === 0}
            aria-label="Select all publishable items on this page"
          />
          <span className="text-muted-foreground">
            Select page ({selectableOnPage.length} publishable)
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={selectAllMatching}
          disabled={busy || total === 0}
        >
          {selectingAll
            ? <><Loader2 size={13} className="animate-spin mr-1.5" />Selecting…</>
            : <>Select all {total} matching</>}
        </Button>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 p-2" />
              <th className="text-left p-2 font-medium">Code</th>
              <th className="text-left p-2 font-medium">Name</th>
              <th className="text-left p-2 font-medium">Karat</th>
              <th className="text-right p-2 font-medium">Price</th>
              <th className="text-right p-2 font-medium">Photos</th>
              <th className="text-left p-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                <Loader2 size={16} className="animate-spin inline mr-2" />Loading items…
              </td></tr>
            ) : classified.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">
                No items match this filter
              </td></tr>
            ) : classified.map(({ item, classification }) => {
              const code = classification.code;
              const selectable = isSelectable(classification);
              return (
                <tr
                  key={code || item.id}
                  className={`border-t ${selectable ? '' : 'opacity-50'}`}
                >
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={selected.has(code)}
                      onCheckedChange={v => toggleOne(code, Boolean(v))}
                      disabled={busy || !selectable}
                      aria-label={`Select ${code}`}
                    />
                  </td>
                  <td className="p-2 font-mono text-xs">{code}</td>
                  <td className="p-2 max-w-[220px] truncate">{item.idis || '—'}</td>
                  <td className="p-2 text-xs">{TYPE_LABELS[item.co] || (item.co ? `${item.co}K` : '—')}</td>
                  <td className="p-2 text-right text-xs">
                    {classification.price ? formatFn6Currency(classification.price) : '—'}
                  </td>
                  <td className="p-2 text-right text-xs">{classification.photos}</td>
                  <td className="p-2"><StatusBadge classification={classification} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lastPage > 1 && (
        <div className="pagination-bar">
          <Button size="sm" variant="outline" className="h-8" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground px-2">Page {page} of {lastPage}</span>
          <Button size="sm" variant="outline" className="h-8" disabled={busy || page >= lastPage} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
