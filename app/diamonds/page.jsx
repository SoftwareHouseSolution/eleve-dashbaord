'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Gem, Loader2, Upload, X } from 'lucide-react';
import DashboardShell from '../../components/DashboardShell';
import DiamondPicker from '../../components/diamonds/DiamondPicker';
import DiamondBrowse from '../../components/diamonds/DiamondBrowse';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import BulkRunPanel from '../../components/shopify/bulkImport/BulkRunPanel';
import ProductOrganization from '../../components/shopify/ProductOrganization';
import { Button } from '../../components/ui/button';
import { fetchListedSkus, runBulkPublish } from '../../lib/bulkImportWorkflow';
import { fetchShopifyCollections } from '../../lib/shopifyItemWorkflow';

const EMPTY_SET = new Set();

/**
 * Diamonds -> Shopify. Same pipeline as gold Bulk Import: the codes sent
 * are "D-<zco>", and /api/shopify/publish-bulk routes those to the diamond
 * path. After publishing, diamonds are repriced automatically by the same
 * GWEB sweep as gold whenever the dollar rate changes.
 */
export default function DiamondsPage() {
  const [listedSkus, setListedSkus] = useState(EMPTY_SET);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [selected, setSelected] = useState(EMPTY_SET);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productType, setProductType] = useState('');
  const [vendor, setVendor] = useState('');
  const [tags, setTags] = useState([]);
  const [collectionIds, setCollectionIds] = useState([]);
  const [collectionsAvailable, setCollectionsAvailable] = useState([]);

  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [results, setResults] = useState([]);
  const [runTotal, setRunTotal] = useState(0);
  const [stopped, setStopped] = useState(false);
  const stopRef = useRef(false);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      setListedSkus(await fetchListedSkus());
    } catch (err) {
      setCatalogError(err.message || 'Could not read the Shopify catalog');
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    fetchShopifyCollections().then(d => setCollectionsAvailable(d.collections || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const selectedCodes = useMemo(() => Array.from(selected), [selected]);
  const defaults = useMemo(() => ({
    productType: productType || undefined,
    vendor: vendor || undefined,
    tags,
    collectionIds,
  }), [productType, vendor, tags, collectionIds]);

  const [repriceMsg, setRepriceMsg] = useState('');
  const repriceNow = async () => {
    setRepriceMsg('');
    try {
      const res = await fetch('/api/shopify/reprice-diamonds', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setRepriceMsg(data.started
        ? 'Updating diamond prices on Shopify in the background…'
        : 'An update is already running.');
    } catch (err) {
      setRepriceMsg(err.message || 'Could not start the update');
    }
  };

  const handlePublish = async () => {
    if (selectedCodes.length === 0) return;
    const ok = window.confirm(
      `Publish ${selectedCodes.length} diamond${selectedCodes.length !== 1 ? 's' : ''} to Shopify now?\n\n`
      + 'They go live immediately. Keep this tab open until it finishes.',
    );
    if (!ok) return;
    stopRef.current = false;
    setStopped(false);
    setResults([]);
    setRunTotal(selectedCodes.length);
    setStarted(true);
    setRunning(true);
    const { results: finalResults, stopped: wasStopped } = await runBulkPublish(selectedCodes, {
      defaults,
      shouldStop: () => stopRef.current,
      onProgress: ({ results: partial }) => setResults([...partial]),
    });
    setResults(finalResults);
    setStopped(wasStopped);
    setRunning(false);
    const published = finalResults.filter(r => r.outcome === 'published').map(r => String(r.mco));
    if (published.length) setListedSkus(prev => new Set([...prev, ...published]));
  };

  const resetRun = () => {
    setStarted(false);
    setResults([]);
    setRunTotal(0);
    setStopped(false);
    setSelected(EMPTY_SET);
    loadCatalog();
  };

  return (
    <DashboardShell>
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <Gem size={20} />
            <h1 className="text-xl font-bold tracking-tight">Diamonds</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Browse GWEB diamond stock or look diamonds up by code, then publish to Shopify. Price is the GWEB selling price (USD × dollar rate)
            and updates on its own whenever GWEB's gold or dollar rate changes.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" variant="outline" onClick={repriceNow}>Update diamond prices now</Button>
            {repriceMsg && <span className="text-xs text-muted-foreground">{repriceMsg}</span>}
          </div>
        </div>

        {started ? (
          <BulkRunPanel
            running={running}
            done={results.length}
            total={runTotal}
            results={results}
            stopped={stopped}
            onStop={() => { stopRef.current = true; }}
            onReset={resetRun}
          />
        ) : (
          <div className="space-y-4">
            {catalogError && (
              <div className="scan-error">
                <AlertCircle size={15} className="shrink-0" />
                <span>{catalogError}</span>
                <Button size="sm" variant="ghost" className="ml-auto h-6 text-xs" onClick={loadCatalog}>Retry</Button>
              </div>
            )}

            {loadingCatalog ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
                <Loader2 size={15} className="animate-spin" />
                Checking which diamonds are already on Shopify…
              </div>
            ) : (
              <Tabs defaultValue="browse" className="w-full !flex !flex-col">
                <TabsList>
                  <TabsTrigger value="browse">Browse stock</TabsTrigger>
                  <TabsTrigger value="codes">By code</TabsTrigger>
                </TabsList>
                <TabsContent value="browse" className="pt-3">
                  <DiamondBrowse
                    listedSkus={listedSkus}
                    selected={selected}
                    onSelectionChange={setSelected}
                    disabled={running}
                  />
                </TabsContent>
                <TabsContent value="codes" className="pt-3">
                  <DiamondPicker
                    listedSkus={listedSkus}
                    selected={selected}
                    onSelectionChange={setSelected}
                    disabled={running}
                  />
                </TabsContent>
              </Tabs>
            )}

            <div className="border rounded-xl bg-card">
              <button type="button" className="w-full flex items-center gap-2 p-3 text-sm font-medium"
                onClick={() => setSettingsOpen(o => !o)}>
                {settingsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                Shared settings for this batch
                <span className="text-xs font-normal text-muted-foreground ml-1">optional</span>
              </button>
              {settingsOpen && (
                <div className="px-3 pb-3">
                  <ProductOrganization
                    productType={productType}
                    onProductTypeChange={setProductType}
                    vendor={vendor}
                    onVendorChange={setVendor}
                    tags={tags}
                    onTagsChange={setTags}
                    collectionsAvailable={collectionsAvailable}
                    selectedCollectionIds={collectionIds}
                    onSelectedCollectionIdsChange={setCollectionIds}
                  />
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background/95 backdrop-blur py-3">
              <span className="text-sm">
                <strong>{selectedCodes.length}</strong> diamond{selectedCodes.length !== 1 ? 's' : ''} selected
              </span>
              {selectedCodes.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setSelected(EMPTY_SET)}>
                  <X size={12} /> Clear
                </Button>
              )}
              <Button className="ml-auto gap-2" disabled={selectedCodes.length === 0 || running || loadingCatalog}
                onClick={handlePublish}>
                <Upload size={14} />
                Publish {selectedCodes.length || ''} to Shopify
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
