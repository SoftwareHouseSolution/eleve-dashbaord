'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, RotateCcw, ScanBarcode } from 'lucide-react';
import { formatFn6Currency } from '../../lib/fn6ItemFields';
import { IMPORT_STATUS, MAX_BULK_CODES, isSelectable } from '../../lib/bulkImport';
import { classifyDiamond, formatCarat } from '../../lib/diamond';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const PAGE_SIZE = 50;
const POLL_MS = 60 * 1000; // pick up new / sold pieces without reloading

function StatusBadge({ c }) {
  if (c.status === IMPORT_STATUS.LISTED) return <Badge variant="secondary">On Shopify</Badge>;
  if (c.status === IMPORT_STATUS.NO_PRICE) return <Badge variant="destructive">No price</Badge>;
  if (c.status === IMPORT_STATUS.INVALID) return <Badge variant="destructive">{c.reason || 'Invalid'}</Badge>;
  return <Badge>Ready</Badge>;
}

function matches(item, q) {
  if (!q) return true;
  const hay = [item.sku, item.zco, item.zdis, item.shape, item.color, item.clarity, item.karat && `${item.karat}k`]
    .filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

/**
 * GWEB diamond stock — the diamond version of the gold BulkItemPicker.
 * Data comes from /api/diamonds/stock (the dashboard scans GWEB's public
 * per-code lookup and caches it), so no GWEB change is needed.
 */
export default function DiamondBrowse({ listedSkus, selected, onSelectionChange, disabled }) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const res = await fetch(`/api/diamonds/stock${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setItems(data.items || []);
      setMeta({ scannedAt: data.scannedAt, lastCode: data.lastCode, updating: data.updating, lastError: data.lastError });
      if (!silent) setError('');
    } catch (err) {
      // A failed background check keeps the current list on screen.
      if (!silent) setError(err.message || 'Failed to load diamond stock from GWEB');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (disabled) return undefined; // don't reshuffle rows during a publish run
    const t = setInterval(() => load({ silent: true }), POLL_MS);
    return () => clearInterval(t);
  }, [load, disabled]);

  const filtered = useMemo(() => items.filter(i => matches(i, applied)), [items, applied]);
  const classified = useMemo(
    () => filtered.map(item => ({ item, c: classifyDiamond(item, listedSkus) })),
    [filtered, listedSkus],
  );
  const lastPage = Math.max(1, Math.ceil(classified.length / PAGE_SIZE));
  const pageRows = classified.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selectableOnPage = pageRows.filter(r => isSelectable(r.c)).map(r => r.c.code);
  const selectableAll = classified.filter(r => isSelectable(r.c)).map(r => r.c.code);
  const allPageSelected = selectableOnPage.length > 0 && selectableOnPage.every(c => selected.has(c));

  const apply = () => { setApplied(search.trim()); setPage(1); };
  const clear = () => { setSearch(''); setApplied(''); setPage(1); };

  const toggleOne = (code, on) => {
    const next = new Set(selected);
    if (on) next.add(code); else next.delete(code);
    onSelectionChange(next);
  };
  const toggleCodes = (codes, on) => {
    const next = new Set(selected);
    for (const code of codes) {
      if (on) { if (next.size < MAX_BULK_CODES) next.add(code); } else next.delete(code);
    }
    onSelectionChange(next);
  };

  const busy = disabled || loading;
  const listedCount = classified.filter(r => r.c.status === IMPORT_STATUS.LISTED).length;

  return (
    <div className="space-y-4">
      <div className="filters-card">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <Label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Search code, shape, color, clarity or karat
            </Label>
            <div className="relative">
              <ScanBarcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="e.g. 1045, Round, G-H VS, 18k…"
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
            {applied && (
              <Button size="sm" variant="ghost" onClick={clear} disabled={busy} className="gap-1.5 text-muted-foreground">
                <RotateCcw size={13} /> Clear
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => load({ refresh: true })} disabled={busy} className="gap-1.5">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh from GWEB
            </Button>
          </div>
        </div>
        {meta && !loading && (
          <p className="text-[11px] text-muted-foreground mt-2">
            {items.length} diamond pieces in stock · {listedCount} on Shopify ·
            {' '}checked {meta.scannedAt ? new Date(meta.scannedAt).toLocaleTimeString() : '—'} · updates automatically
            {meta.updating ? ' · checking GWEB now…' : ''}
          </p>
        )}
        {meta?.lastError && !loading && (
          <p className="text-[11px] text-amber-700 mt-1">
            GWEB didn’t answer properly on the last check — showing the last good list. It retries automatically.
          </p>
        )}
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
            onCheckedChange={v => toggleCodes(selectableOnPage, Boolean(v))}
            disabled={disabled || selectableOnPage.length === 0}
            aria-label="Select all publishable diamonds on this page"
          />
          <span className="text-muted-foreground">Select this page ({selectableOnPage.length} publishable)</span>
        </label>
        <Button size="sm" variant="outline" onClick={() => toggleCodes(selectableAll, true)} disabled={busy || selectableAll.length === 0}>
          Select all {selectableAll.length} publishable
        </Button>
      </div>

      <div className="border rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 p-2" />
              <th className="text-left p-2 font-medium">Code</th>
              <th className="text-left p-2 font-medium">Karat</th>
              <th className="text-right p-2 font-medium">Gold (g)</th>
              <th className="text-right p-2 font-medium">Stones</th>
              <th className="text-left p-2 font-medium">Carat</th>
              <th className="text-left p-2 font-medium">Shape</th>
              <th className="text-left p-2 font-medium">Color</th>
              <th className="text-left p-2 font-medium">Clarity</th>
              <th className="text-right p-2 font-medium">Price</th>
              <th className="text-left p-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">
                <Loader2 size={16} className="animate-spin inline mr-2" />
                Loading diamond stock from GWEB… the first load takes about 30 seconds
              </td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No diamonds match this filter</td></tr>
            ) : pageRows.map(({ item, c }) => {
              const code = c.code;
              const canSelect = isSelectable(c);
              const isSelected = selected.has(code);
              const clickable = canSelect && !disabled;
              return (
                <tr
                  key={code}
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
                  <td className="p-2 text-xs">{item.karat ? `${item.karat}K` : '—'}</td>
                  <td className="p-2 text-right text-xs">{item.goldWeight ? Number(item.goldWeight).toFixed(2) : '—'}</td>
                  <td className="p-2 text-right text-xs">{item.stoneCount || '—'}</td>
                  <td className="p-2 text-xs">{formatCarat(item.carat) || '—'}</td>
                  <td className="p-2 text-xs">{item.shape || '—'}</td>
                  <td className="p-2 text-xs">{item.color || '—'}</td>
                  <td className="p-2 text-xs">{item.clarity || '—'}</td>
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
          <span className="text-xs text-muted-foreground px-2">Page {page} of {lastPage} · {classified.length} pieces</span>
          <Button size="sm" variant="outline" className="h-8" disabled={busy || page >= lastPage} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
