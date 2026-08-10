'use client';

import { useMemo, useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { MAX_BULK_CODES, parsePastedCodes } from '../../../lib/bulkImport';
import { Button } from '../../ui/button';

/**
 * Paste a column straight out of Excel. Codes are only checked against
 * what's already on Shopify here — price and photos are resolved during the
 * run, so pasting 1000 codes doesn't fire 1000 lookups before you press go.
 */
export default function BulkPasteCodes({ listedSkus, onAdd, disabled }) {
  const [text, setText] = useState('');

  const parsed = useMemo(() => parsePastedCodes(text), [text]);
  const alreadyListed = useMemo(
    () => parsed.filter(code => listedSkus.has(code)),
    [parsed, listedSkus],
  );
  const fresh = useMemo(
    () => parsed.filter(code => !listedSkus.has(code)),
    [parsed, listedSkus],
  );
  const overLimit = fresh.length > MAX_BULK_CODES;

  const handleAdd = () => {
    onAdd(fresh.slice(0, MAX_BULK_CODES));
    setText('');
  };

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={disabled}
        rows={10}
        className="form-textarea font-mono text-xs w-full"
        placeholder={'Paste item codes — one per line, or separated by commas.\n\n27000020\n27000021\n27000022'}
      />

      {parsed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {parsed.length} code{parsed.length !== 1 ? 's' : ''} found
          {alreadyListed.length > 0 && (
            <> · <span className="text-amber-700 dark:text-amber-400">
              {alreadyListed.length} already on Shopify (will be left out)
            </span></>
          )}
          {overLimit && (
            <> · <span className="text-destructive">
              only the first {MAX_BULK_CODES} will be added
            </span></>
          )}
        </p>
      )}

      <Button onClick={handleAdd} disabled={disabled || fresh.length === 0} className="gap-2">
        <ClipboardPaste size={14} />
        Add {fresh.length > 0 ? `${Math.min(fresh.length, MAX_BULK_CODES)} ` : ''}code{fresh.length !== 1 ? 's' : ''} to selection
      </Button>
    </div>
  );
}
