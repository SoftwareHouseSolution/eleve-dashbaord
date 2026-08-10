'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, ImageOff, Loader2, Square } from 'lucide-react';
import { formatEta, summariseResults } from '../../../lib/bulkImport';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';

function OutcomeBadge({ outcome }) {
  if (outcome === 'published') return <Badge>Published</Badge>;
  if (outcome === 'skipped') return <Badge variant="secondary">Skipped</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

export default function BulkRunPanel({ running, done, total, results, stopped, onStop, onReset }) {
  const [filter, setFilter] = useState('problems');

  const summary = useMemo(() => summariseResults(results), [results]);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const visible = useMemo(() => {
    if (filter === 'all') return results;
    if (filter === 'no-photos') {
      return results.filter(r => (r.warnings || []).some(w => /photo/i.test(w)));
    }
    return results.filter(r => r.outcome !== 'published');
  }, [results, filter]);

  const failedCodes = useMemo(
    () => results.filter(r => r.outcome === 'failed').map(r => r.mco).join('\n'),
    [results],
  );

  const copyFailed = () => {
    navigator.clipboard?.writeText(failedCodes);
  };

  return (
    <div className="space-y-4">
      <div className="border rounded-xl p-4 space-y-3 bg-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-medium">
            {running ? (
              <><Loader2 size={15} className="animate-spin" />Publishing {done} of {total}</>
            ) : (
              <><CheckCircle2 size={15} className="text-green-600" />
                {stopped ? 'Stopped' : 'Finished'} — {done} of {total} processed</>
            )}
          </div>
          {running ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{formatEta(total - done)}</span>
              <Button size="sm" variant="outline" onClick={onStop} className="gap-1.5">
                <Square size={12} /> Stop
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={onReset}>Start another batch</Button>
          )}
        </div>

        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gold-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="text-green-700 dark:text-green-400 font-medium">{summary.published} published</span>
          <span className="text-muted-foreground">{summary.skipped} skipped</span>
          <span className={summary.failed > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}>
            {summary.failed} failed
          </span>
          {summary.noPhotos > 0 && (
            <span className="text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
              <ImageOff size={12} />{summary.noPhotos} without photos
            </span>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              ['problems', `Needs attention (${summary.skipped + summary.failed})`],
              ['no-photos', `No photos (${summary.noPhotos})`],
              ['all', `Everything (${results.length})`],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={filter === key ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
            {summary.failed > 0 && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 ml-auto" onClick={copyFailed}>
                <Copy size={12} /> Copy failed codes
              </Button>
            )}
          </div>

          <div className="border rounded-xl overflow-hidden max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Code</th>
                  <th className="text-left p-2 font-medium">Result</th>
                  <th className="text-left p-2 font-medium">Detail</th>
                  <th className="w-16 p-2" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={4} className="p-6 text-center text-muted-foreground text-xs">
                    Nothing here — everything in this group went through cleanly.
                  </td></tr>
                ) : visible.map(r => (
                  <tr key={r.mco} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.mco}</td>
                    <td className="p-2"><OutcomeBadge outcome={r.outcome} /></td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {r.reason || (r.warnings || []).join(' · ') || r.title || '—'}
                    </td>
                    <td className="p-2 text-right">
                      {r.shopUrl && (
                        <a
                          href={r.shopUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gold-600 hover:underline"
                        >
                          <ExternalLink size={11} /> View
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
