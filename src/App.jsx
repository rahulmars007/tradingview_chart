import React, { useEffect, useRef, useState } from 'react';
import Papa from 'papaparse';
import { createChart, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';

/* Utilities */
const normalizeNumber = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/[,₹\s]/g, '').replace(/--/g, '');
  return parseFloat(cleaned);
};

const tryParseDateToSec = (dateStr, assumeMs = false) => {
  if (dateStr === null || dateStr === undefined) return NaN;
  const s = String(dateStr).trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (assumeMs) return Math.floor(n / 1000);
    if (s.length > 10) return Math.floor(n / 1000);
    return n;
  }
  const iso = Date.parse(s);
  if (!isNaN(iso)) return Math.floor(iso / 1000);
  const d = s.replace(/\./g, '/').replace(/-/g, '/');
  const parts = d.split('/');
  if (parts.length === 3) {
    let [p1, p2, p3] = parts; let day, month, year;
    if (p3.length === 4) { day = p1; month = p2; year = p3; }
    else if (p1.length === 4) { year = p1; month = p2; day = p3; }
    else { day = p1; month = p2; year = p3; }
    const rebuilt = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const parsed = Date.parse(rebuilt);
    if (!isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return NaN;
};

const median = (arr) => { const a = arr.filter(x => isFinite(x)).slice().sort((x, y) => x - y); if (!a.length) return NaN; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/* Simple EMA */
const computeEMA = (data, period) => {
  const res = [];
  if (!data || !data.length || period <= 0) return res;
  const k = 2 / (period + 1);
  let ema;
  // Initialize with SMA
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) { sum += data[i].close; }
  if (data.length < period) return res;
  ema = sum / period;
  res.push({ time: data[period - 1].time, value: ema });
  // Calculate EMA
  for (let i = period; i < data.length; i++) {
    const close = data[i].close;
    ema = (close - ema) * k + ema;
    res.push({ time: data[i].time, value: ema });
  }
  return res;
};

/* CSV uploader with auto-detect */
function CSVUploader({ onParsed, onFileNameChange }) {
  const fileRef = useRef(null);
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [mapping, setMapping] = useState({ date: '', open: '', high: '', low: '', close: '', volume: '' });
  const [assumeDateMs, setAssumeDateMs] = useState(false);

  const handleFile = (file) => {
    if (file && onFileNameChange) onFileNameChange(file.name);
    Papa.parse(file, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim(), complete: (results) => {
        const rows = results.data || [];
        if (!rows.length) { alert('No rows parsed'); return; }
        setRawRows(rows); setPreviewRows(rows.slice(0, 10)); const keys = Object.keys(rows[0] || {}); setHeaders(keys);
        const auto = autoDetect(keys); setMapping(m => ({ ...m, ...auto }));
        if (auto.date && auto.open && auto.high && auto.low && auto.close) {
          setTimeout(() => applyMapping(rows, auto, assumeDateMs), 200);
        }
      }, error: (err) => { console.error(err); alert('Parse error'); }
    });
  };

  const autoDetect = (keys) => { const find = (cands) => keys.find(k => cands.some(c => k.toLowerCase().includes(c))); return { date: find(['timestamp', 'date', 'time']) || '', open: find(['open', 'o']) || '', high: find(['high', 'h']) || '', low: find(['low', 'l']) || '', close: find(['close', 'c', 'last']) || '', volume: find(['volume', 'vol', 'v']) || '' }; };

  const applyMapping = (rowsArg = null, mappingArg = null, assumeMs = false) => {
    const rows = rowsArg || rawRows; const mappingObj = mappingArg || mapping;
    if (!rows.length) return;
    const { date, open, high, low, close, volume } = mappingObj;
    if (!date || !open || !high || !low || !close) { return; }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; const t = tryParseDateToSec(r[date], assumeMs); if (isNaN(t)) continue;
      const o = normalizeNumber(r[open]); const h = normalizeNumber(r[high]); const l = normalizeNumber(r[low]); const c = normalizeNumber(r[close]); const v = volume ? normalizeNumber(r[volume]) : undefined;
      if ([o, h, l, c].some(x => isNaN(x))) continue; out.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
    }
    out.sort((a, b) => a.time - b.time); onParsed(out);
  };

  return (
    <div className="upload-section">
      <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      <button className="btn btn-primary" onClick={() => fileRef.current.click()}>Upload CSV</button>
      <button className="btn" onClick={() => { setRawRows([]); setHeaders([]); setPreviewRows([]); onParsed([]); if (onFileNameChange) onFileNameChange(''); }}>Clear</button>
      {/* Filename display inside Uploader */}
    </div>
  );
}

/* TradingChart: separate volume scale + clipping */
function TradingChart({ ohlc, theme = 'dark', indicators = { emaFast: 9, emaSlow: 21 }, onLegendChange }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);

  const emaFastRef = useRef(null);
  const emaSlowRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    // container.style.height = 'calc(100vh - 120px)'; // Removed fixed height
    container.style.height = '100%'; // Take full height of parent
    container.style.position = 'relative';
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: theme === 'dark' ? '#0b1226' : '#fff' }, textColor: theme === 'dark' ? '#d1d4dc' : '#1b1b1b' },
      grid: {
        vertLines: { color: '#2B2B43', style: 0, visible: true },
        horzLines: { color: '#2B2B43', style: 0, visible: true },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      kineticScroll: { touch: true, mouse: true },
      rightPriceScale: { borderColor: theme === 'dark' ? '#2b2b43' : '#e6e6e6' },
      timeScale: {
        rightOffset: 12,
        barSpacing: 6,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        borderVisible: true,
        borderColor: theme === 'dark' ? '#2b2b43' : '#e6e6e6',
        visible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      localization: {
        timeFormatter: (time) => {
          return new Date(time * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      }
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, { upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
    candleRef.current = candleSeries;



    const emaFastSeries = chart.addSeries(LineSeries, { color: '#f1c40f', lineWidth: 2, title: 'EMA Fast' });
    emaFastRef.current = emaFastSeries;

    const emaSlowSeries = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, title: 'EMA Slow' });
    emaSlowRef.current = emaSlowSeries;

    const ro = new ResizeObserver(() => { if (!chartRef.current || !container) return; chartRef.current.applyOptions({ width: container.clientWidth, height: container.clientHeight }); });
    ro.observe(container);



    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.seriesData) {
        onLegendChange(null);
        return;
      }
      const seriesData = param.seriesData;
      const c = seriesData.get(candleSeries);
      const sFast = seriesData.get(emaFastSeries);
      const sSlow = seriesData.get(emaSlowSeries);

      if (c) {
        onLegendChange({
          time: param.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          emaFast: sFast ? sFast.value : undefined,
          emaSlow: sSlow ? sSlow.value : undefined
        });
      } else {
        onLegendChange(null);
      }
    });

    return () => { ro.disconnect(); chart.remove(); };
  }, [theme]);



  // 1. Update Candle Data & Reset View (only when file changes)
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    if (!chart || !candleSeries) return;

    const lcData = (ohlc || []).map(r => ({ time: r.time, open: r.open, high: r.high, low: r.low, close: r.close }));
    candleSeries.setData(lcData);

    if (lcData.length > 0) {
      try { chart.timeScale().fitContent(); } catch (e) { }
    }
  }, [ohlc]);

  // 2. Update EMAs
  useEffect(() => {
    const emaFastSeries = emaFastRef.current;
    const emaSlowSeries = emaSlowRef.current;
    if (!emaFastSeries || !emaSlowSeries) return;

    if (indicators && indicators.emaFast) {
      const d = computeEMA(ohlc, indicators.emaFast);
      emaFastSeries.setData(d);
    } else {
      emaFastSeries.setData([]);
    }

    if (indicators && indicators.emaSlow) {
      const d = computeEMA(ohlc, indicators.emaSlow);
      emaSlowSeries.setData(d);
    } else {
      emaSlowSeries.setData([]);
    }
  }, [ohlc, indicators?.emaFast, indicators?.emaSlow]);

  return <div style={{ position: 'relative', width: '100%', height: '100%' }}><div ref={containerRef} style={{ width: '100%', height: '100%' }} /></div>;
}

export default function App() {
  const [data, setData] = useState([]);
  const [theme, setTheme] = useState('dark');
  const [emaFast, setEmaFast] = useState(9);
  const [emaSlow, setEmaSlow] = useState(21);
  const [legendData, setLegendData] = useState(null);
  const [fileName, setFileName] = useState('');

  const formatVal = (n) => n ? Number(n).toFixed(2) : '—';

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      <div className="header-toolbar">
        <div className="header-group">
          <div className="header-title">TradingView Chart</div>
          <CSVUploader onParsed={(d) => setData(d)} onFileNameChange={setFileName} />
          {fileName && <div className="file-name-display">{fileName}</div>}
        </div>

        <div className="header-group" style={{ flex: 1, justifyContent: 'center' }}>
          {legendData ? (
            <div className="legend-container">
              <div>{new Date(legendData.time * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</div>
              <div className="legend-item"><span className="legend-label">O</span> {formatVal(legendData.open)}</div>
              <div className="legend-item"><span className="legend-label">H</span> {formatVal(legendData.high)}</div>
              <div className="legend-item"><span className="legend-label">L</span> {formatVal(legendData.low)}</div>
              <div className="legend-item"><span className="legend-label">C</span> {formatVal(legendData.close)}</div>
              {legendData.emaFast !== undefined && !isNaN(legendData.emaFast) && (
                <div className="legend-item" style={{ color: '#f1c40f' }}>
                  <span className="legend-label">Fast</span> {formatVal(legendData.emaFast)}
                </div>
              )}
              {legendData.emaSlow !== undefined && !isNaN(legendData.emaSlow) && (
                <div className="legend-item" style={{ color: '#2962ff' }}>
                  <span className="legend-label">Slow</span> {formatVal(legendData.emaSlow)}
                </div>
              )}
            </div>
          ) : (
            <div className="legend-container" style={{ opacity: 0.5 }}>OHLC Data</div>
          )}
        </div>

        <div className="header-group">
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            Fast <input type="number" className="input-control" value={emaFast} onChange={e => setEmaFast(Math.max(1, Number(e.target.value) || 1))} style={{ width: 40 }} />
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            Slow <input type="number" className="input-control" value={emaSlow} onChange={e => setEmaSlow(Math.max(1, Number(e.target.value) || 1))} style={{ width: 40 }} />
          </label>
          <select className="input-control" value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
      </div>
      <div style={{ flex: 1 }}><TradingChart ohlc={data} theme={theme} indicators={{ emaFast, emaSlow }} onLegendChange={setLegendData} /></div>
    </div>
  );
}
