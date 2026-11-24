'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2, Search } from 'lucide-react';
import { diamondsApi } from '../../api/diamonds';
import { formatFn6Currency } from '../../lib/fn6ItemFields';
import { IMPORT_STATUS, MAX_BULK_CODES, isSelectable, parsePastedCodes } from '../../lib/bulkImport';
import { classifyDiamond, diamondZcoFromSku, formatCarat } from '../../lib/diamond';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';

const LOOKUP_CONCURRENCY = 4;

function StatusBadge({ row }) {
  if (row.error) return <Badge variant="destructive">{row.error}</Badge>;
  const c = row.classification;
  if (c.status === IMPORT_STATUS.LISTED) return <Badge variant="secondary">On Shopify</Badge>;
  if (c.status === IMPORT_STATUS.NO_PRICE) return <Badge variant="destructive">No price</Badge>;
  if (c.status === IMPORT_STATUS.INVALID) return <Badge variant="destructive">{c.reason || 'Invalid'}</Badge>;
  return <Badge>Ready</Badge>;
}

/**
 * GWEB has no diamond list endpoint (and GWEB is not being changed), so
 * diamonds are picked by code: paste or scan codes, each one is looked up
 * in GWEB's existing /Dim/api/fd2/by-code/, then select what to publish.
 */
export default function DiamondPicker({ listedSkus, selected, onSelectionChange, disabled }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  const lookup = async () => {
    const codes = parsePastedCodes(text).map(diamondZcoFromSku).slice(0, MAX_BULK_CODES);
    if (codes.length === 0) return;
    setLoading(true);
    setError('');
    setProgress(0);
    const out = new Array(codes.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < codes.length) {
        const i = next++;
        const zco = codes[i];
        try {
          const res = await diamondsApi.getByZco(zco);
          const item = res.data;
          out[i] = item
            ? { key: zco, item, classification: classifyDiamond(item, listedSkus) }
            : { key: zco, item: { zco }, error: 'Bad GWEB response' };
        } catch (err) {
          out[i] = {
            key: zco,
            item: { zco },
            error: err?.response?.status === 404 ? 'Not in GWEB' : 'Lookup failed',
          };
        }
        done += 1;
        setProgress(done);
      }
    };
    try {
      await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
      setRows(out);
    } catch (err) {
      setError(err.message || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const selectable = useMemo(
    () => rows.filter(r => !r.error && isSelectable(r.classification)).map(r => r.classification.code),
    [rows],
  );
  const allSelected = selectable.length > 0 && selectable.every(c => selected.has(c));

  const toggleOne = (code, on) => {
    const next = new Set(selected);
    if (on) next.add(code); else next.delete(code);
    onSelectionChange(next);
  };
  const toggleAll = (on) => {
    const next = new Set(selected);
    for (const code of selectable) { if (on) next.add(code); else next.delete(code); }
    onSelectionChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={disabled || loading}
          rows={6}
          className="form-textarea font-mono text-xs w-full"
          placeholder={'Scan or paste diamond codes — one per line or comma-separated.\nWith or without "D-":\n\n1045\nD-1046'}
        />
        <Button onClick={lookup} disabled={disabled || loading || !text.trim()} className="gap-2">
          {loading
            ? <><Loader2 size={14} className="animate-spin" />Looking up… {progress}</>
            : <><Search size={14} />Look up in GWEB</>}
        </Button>
      </div>

      {error && (
        <div className="scan-error">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <Checkbox
              checked={allSelected}
              onCheckedChange={v => toggleAll(Boolean(v))}
              disabled={disabled || selectable.length === 0}
              aria-label="Select all publishable diamonds"
            />
            <span className="text-muted-foreground">Select all ({selectable.length} publishable)</span>
          </label>

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
                  <th className="text-right p-2 font-medium">Price</th>
                  <th className="text-left p-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { item } = row;
                  const code = row.classification?.code || `D-${item.zco}`;
                  const canSelect = !row.error && isSelectable(row.classification);
                  const isSelected = selected.has(code);
                  const clickable = canSelect && !disabled;
                  return (
                    <tr
                      key={row.key}
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
                      <td className="p-2 text-right text-xs">
                        {row.classification?.price ? formatFn6Currency(row.classification.price) : '—'}
                      </td>
                      <td className="p-2"><StatusBadge row={row} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
