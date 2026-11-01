'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { OptionChainPayload } from '@/lib/db';
import type { ComparedStrikeRow } from '@/app/api/comparison/route';

interface SnapshotItem {
  id: number;
  timestamp: string;
  formattedIST: string;
  date: string;
  time: string;
  checkpoint: string;
  expiry: string;
  spot: number;
  ltp: number;
  pcr: number;
  totalCeOI: number;
  totalPeOI: number;
  maxPain: number;
}

interface StrikeHistoryStep {
  snapshotId: number;
  timestamp: string;
  formattedIST: string;
  checkpoint: string;
  spot: number;
  indexLtp: number;
  pcr: number;
  ce: { ltp: number; oi: number; volume: number; iv: number } | null;
  pe: { ltp: number; oi: number; volume: number; iv: number } | null;
  ceAnalysis: any | null;
  peAnalysis: any | null;
}

// Simple Indian market standard hourly slots
const STANDARD_HOURLY_SLOTS = [
  { id: '9-10', label: '9:15 - 10:15 AM', start: '09:15', end: '10:15' },
  { id: '10-11', label: '10:15 - 11:15 AM', start: '10:15', end: '11:15' },
  { id: '11-12', label: '11:15 - 12:15 PM', start: '11:15', end: '12:15' },
  { id: '12-1', label: '12:15 - 1:15 PM', start: '12:15', end: '13:15' },
  { id: '1-2', label: '1:15 - 2:15 PM', start: '13:15', end: '14:15' },
  { id: '2-3', label: '2:15 - 3:15 PM', start: '14:15', end: '15:15' },
  { id: '3-close', label: '3:15 - 3:30 PM (Close)', start: '15:15', end: '15:30' },
  { id: 'open-now', label: 'Full Day (9:15 AM - Now)', start: '09:15', end: 'now' },
  { id: 'yesterday-now', label: 'Since Yesterday Close', start: 'yesterday', end: 'now' },
];

export default function OptionChainPage() {
  // Mode selection
  const [activeTab, setActiveTab] = useState<'price_to_oi' | 'chain'>('price_to_oi');

  // Standard Option Chain Data
  const [data, setData] = useState<OptionChainPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedExpiry, setSelectedExpiry] = useState<string>('');
  const [selectedStrike, setSelectedStrike] = useState<string>('all');
  const [searchStrike, setSearchStrike] = useState<string>('');

  // Dark Mode State
  const [darkMode, setDarkMode] = useState<boolean>(false);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    setDarkMode(isDark);
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  // ── Simplified Time Range States ──────────────────────────────────────────
  const [snapshotsList, setSnapshotsList] = useState<SnapshotItem[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string>('open-now');
  const [fromSnapshotId, setFromSnapshotId] = useState<number | null>(null);
  const [toSnapshotId, setToSnapshotId] = useState<number | null>(null);
  const [comparisonData, setComparisonData] = useState<any | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  // ── Strike Deep-Dive Inspector Modal ──────────────────────────────────────
  const [modalStrike, setModalStrike] = useState<number | null>(null);
  const [strikeHistory, setStrikeHistory] = useState<StrikeHistoryStep[]>([]);
  const [modalLoading, setModalLoading] = useState(false);

  // 1. Fetch live option chain
  const fetchData = useCallback(async (expiry?: string) => {
    try {
      setRefreshing(true);
      const url = expiry ? `/api/chain?expiry=${encodeURIComponent(expiry)}` : '/api/chain';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();

      if (json.success && json.data) {
        setData(json.data);
        if (!selectedExpiry && json.data.expiry) {
          setSelectedExpiry(json.data.expiry);
        }
        setError(null);
      } else {
        setError(json.error || 'Failed to load option chain');
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching option chain');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedExpiry]);

  // 2. Fetch list of available snapshots
  const fetchSnapshotsList = useCallback(async () => {
    try {
      const res = await fetch('/api/snapshots?limit=50', { cache: 'no-store' });
      const json = await res.json();
      if (json.success && json.snapshots && json.snapshots.length > 0) {
        const list: SnapshotItem[] = json.snapshots;
        setSnapshotsList(list);

        // Default: To = latest snapshot, From = previous snapshot
        if (list.length >= 2) {
          setToSnapshotId(list[0].id);
          setFromSnapshotId(list[1].id);
        } else if (list.length === 1) {
          setToSnapshotId(list[0].id);
          setFromSnapshotId(list[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load snapshots list:', e);
    }
  }, []);

  // 3. Fetch Range Comparison Data
  const fetchComparison = useCallback(async (fromId: number, toId: number) => {
    if (!fromId || !toId) return;
    try {
      setComparisonLoading(true);
      const res = await fetch(`/api/comparison?fromId=${fromId}&toId=${toId}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success && json.comparison) {
        setComparisonData(json.comparison);
      }
    } catch (e) {
      console.error('Failed to fetch range comparison:', e);
    } finally {
      setComparisonLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
    fetchSnapshotsList();
  }, [fetchData, fetchSnapshotsList]);

  // Trigger comparison when from/to IDs change
  useEffect(() => {
    if (fromSnapshotId && toSnapshotId) {
      fetchComparison(fromSnapshotId, toSnapshotId);
    }
  }, [fromSnapshotId, toSnapshotId, fetchComparison]);

  // Background auto-refresh every 30s silently
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(selectedExpiry);
      fetchSnapshotsList();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedExpiry, fetchData, fetchSnapshotsList]);

  // Handle Simple Hour Slot Click
  const handleSlotClick = (slot: typeof STANDARD_HOURLY_SLOTS[0]) => {
    setSelectedSlotId(slot.id);
    if (!snapshotsList.length) return;

    const latest = snapshotsList[0];
    setToSnapshotId(latest.id);

    if (slot.id === 'open-now') {
      const today = latest.date;
      const todaySnaps = snapshotsList.filter((s) => s.date === today);
      const openSnap = todaySnaps[todaySnaps.length - 1] || latest;
      setFromSnapshotId(openSnap.id);
    } else if (slot.id === 'yesterday-now') {
      const today = latest.date;
      const yesterdaySnap = snapshotsList.find((s) => s.date !== today);
      setFromSnapshotId(yesterdaySnap ? yesterdaySnap.id : snapshotsList[snapshotsList.length - 1].id);
    } else {
      const matchStart = snapshotsList.find((s) => s.checkpoint.includes(slot.start));
      const matchEnd = snapshotsList.find((s) => s.checkpoint.includes(slot.end));

      if (matchStart && matchEnd) {
        setFromSnapshotId(matchStart.id);
        setToSnapshotId(matchEnd.id);
      } else if (snapshotsList.length >= 2) {
        setFromSnapshotId(snapshotsList[1].id);
        setToSnapshotId(latest.id);
      }
    }
  };

  // Open Strike History Modal
  const openStrikeModal = async (strike: number) => {
    setModalStrike(strike);
    setModalLoading(true);
    try {
      const res = await fetch(`/api/strike-history?strike=${strike}&limit=20`);
      const json = await res.json();
      if (json.success && json.history) {
        setStrikeHistory(json.history);
      }
    } catch (e) {
      console.error('Failed to load strike history:', e);
    } finally {
      setModalLoading(false);
    }
  };

  // Number formatting
  const formatIndianNumber = (num: number | null | undefined, decimals = 0): string => {
    if (num === null || num === undefined || num === 0) return '-';
    if (decimals > 0) {
      const parts = num.toFixed(decimals).split('.');
      const intPart = parseInt(parts[0], 10).toLocaleString('en-IN');
      return `${intPart}.${parts[1]}`;
    }
    return Math.round(num).toLocaleString('en-IN');
  };

  const renderDelta = (delta: number, decimals = 2) => {
    if (!delta || delta === 0) return <span className="text-gray-400 dark:text-slate-500 font-normal">-</span>;
    const isPos = delta > 0;
    const color = isPos ? 'text-[#008000] dark:text-emerald-400' : 'text-[#d32f2f] dark:text-rose-400';
    const text = isPos ? `+${delta.toFixed(decimals)}` : delta.toFixed(decimals);
    return <span className={`${color} font-semibold text-[11px]`}>{text}</span>;
  };

  // Human-friendly Indian-simple observation badge
  const renderObservationBadge = (obs: string, optView: string, eqView: string, isCall: boolean) => {
    if (!obs || obs === 'NEUTRAL / SIMILAR') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
          No Big Change
        </span>
      );
    }

    if (obs === 'LONG BUILD UP') {
      return (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isCall
              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
              : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
          }`}
        >
          {isCall ? '🟢 Call Buying (Bullish)' : '🔴 Put Buying (Bearish)'}
        </span>
      );
    }

    if (obs === 'SHORT COVERING') {
      return (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isCall
              ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 border-emerald-400 dark:border-emerald-600'
              : 'bg-rose-100 dark:bg-rose-900/60 text-rose-900 dark:text-rose-200 border-rose-400 dark:border-rose-600'
          }`}
        >
          {isCall ? '🚀 Call Short Covering (Bullish)' : '🔻 Put Short Covering (Bearish)'}
        </span>
      );
    }

    if (obs === 'SHORT BUILD UP') {
      return (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isCall
              ? 'bg-red-50 dark:bg-red-950/60 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700'
              : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
          }`}
        >
          {isCall ? '🔴 Call Writing (Resistance)' : '🟢 Put Writing (Support)'}
        </span>
      );
    }

    if (obs === 'LONG COVERING') {
      return (
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
            isCall
              ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-700'
              : 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border-teal-300 dark:border-teal-700'
          }`}
        >
          {isCall ? '🔻 Call Unwinding (Bearish)' : '🟢 Put Unwinding (Bullish)'}
        </span>
      );
    }

    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700">
        {obs}
      </span>
    );
  };

  // CSV download function
  const downloadCSV = () => {
    if (!data || !data.rows) return;
    const headers = [
      'CALLS_OI',
      'CALLS_CHNG_IN_OI',
      'CALLS_LTP',
      'CALLS_CHNG',
      'STRIKE',
      'PUTS_CHNG',
      'PUTS_LTP',
      'PUTS_CHNG_IN_OI',
      'PUTS_OI',
    ];

    const csvRows = [headers.join(',')];
    for (const r of data.rows) {
      csvRows.push(
        [
          r.ce.oi,
          r.ce.change_oi,
          r.ce.ltp,
          r.ce.price_change,
          r.strike,
          r.pe.price_change,
          r.pe.ltp,
          r.pe.change_oi,
          r.pe.oi,
        ].join(',')
      );
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nifty-oi-analysis-${data.expiry || 'latest'}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Filter strikes
  const filteredChainRows = useMemo(() => {
    if (!data || !data.rows) return [];
    let rows = data.rows;
    const cleanSearch = searchStrike.trim().replace(/,/g, '');
    if (cleanSearch) {
      return rows.filter((r) => r.strike.toString().includes(cleanSearch));
    }
    if (selectedStrike === 'all') return rows;
    if (selectedStrike.startsWith('±')) {
      const count = parseInt(selectedStrike.replace('±', ''), 10);
      const atmIndex = rows.findIndex((r) => r.isATM);
      if (atmIndex === -1) return rows;
      const start = Math.max(0, atmIndex - count);
      const end = Math.min(rows.length, atmIndex + count + 1);
      return rows.slice(start, end);
    }
    const target = parseInt(selectedStrike, 10);
    return rows.filter((r) => r.strike === target);
  }, [data, selectedStrike, searchStrike]);

  const filteredComparisonRows = useMemo(() => {
    if (!comparisonData || !comparisonData.rows) return [];
    let rows: ComparedStrikeRow[] = comparisonData.rows;
    const cleanSearch = searchStrike.trim().replace(/,/g, '');
    if (cleanSearch) {
      return rows.filter((r) => r.strike.toString().includes(cleanSearch));
    }
    if (selectedStrike === 'all') return rows;
    if (selectedStrike.startsWith('±')) {
      const count = parseInt(selectedStrike.replace('±', ''), 10);
      const atmIndex = rows.findIndex((r) => r.isATM);
      if (atmIndex === -1) return rows;
      const start = Math.max(0, atmIndex - count);
      const end = Math.min(rows.length, atmIndex + count + 1);
      return rows.slice(start, end);
    }
    const target = parseInt(selectedStrike, 10);
    return rows.filter((r) => r.strike === target);
  }, [comparisonData, selectedStrike, searchStrike]);

  const spot = data?.spot || 23053.10;

  return (
    <div className="min-h-screen bg-[#f0f2f5] dark:bg-[#0b0f19] text-[#222222] dark:text-[#e5e7eb] font-sans antialiased text-[12px] p-2 sm:p-4 md:p-6 lg:p-8 select-text flex flex-col items-center transition-colors">
      {/* ── Main Container Card ── */}
      <div className="w-full max-w-[1080px] bg-white dark:bg-[#111827] rounded-xl border border-[#d0d7de] dark:border-slate-800 shadow-sm p-3 sm:p-5 flex flex-col transition-colors">
        {/* ── Clean Header Bar ────────────────────────────────────────────── */}
        <div className="w-full pb-3 border-b border-[#e1e4e8] dark:border-slate-800 mb-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            {/* Left: Clean Brand Logo & Single Spot Price */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <img
                src="/logo.png"
                alt="Price to OI Logo"
                className="w-7 h-7 rounded-full object-cover border border-[#2b2259]/30 dark:border-indigo-400/40 shadow-xs"
              />
              <span className="font-bold text-[#2b2259] dark:text-indigo-300 text-[13px] bg-[#f0f2f5] dark:bg-slate-800 px-2 py-0.5 rounded border border-[#d0d7de] dark:border-slate-700">
                NIFTY 50
              </span>
              <span className="font-black text-[#111111] dark:text-white text-[17px] tracking-tight">
                {formatIndianNumber(spot, 2)}
              </span>
              <span className="text-[#888888] dark:text-slate-400 text-[11px] ml-1">
                As on {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '15:30'} IST
              </span>
              <button
                onClick={() => {
                  fetchData(selectedExpiry);
                  fetchSnapshotsList();
                }}
                title="Refresh Data"
                className="text-[#ea6212] hover:text-[#c44e07] dark:text-orange-400 dark:hover:text-orange-300 transition cursor-pointer p-0.5 ml-0.5"
              >
                <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Right: Mode Switcher Tabs, Theme Toggle & CSV */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Dark Mode Toggle */}
              <button
                onClick={toggleDarkMode}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-[#333] dark:text-slate-200 border border-[#d0d7de] dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 transition cursor-pointer"
                title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                aria-label="Toggle dark mode"
              >
                {darkMode ? (
                  <>
                    <span className="text-amber-400 text-xs">☀️</span>
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500 text-xs">🌙</span>
                    <span>Dark</span>
                  </>
                )}
              </button>

              <button
                onClick={downloadCSV}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-[#333] dark:text-slate-200 border border-[#d0d7de] dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition cursor-pointer"
                title="Download CSV"
              >
                <svg className="w-3.5 h-3.5 text-[#d93025] dark:text-red-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
                </svg>
                <span>Download CSV</span>
              </button>

              <div className="flex items-center bg-[#f0f2f5] dark:bg-slate-800 p-0.5 rounded-lg border border-[#d0d7de] dark:border-slate-700">
                <button
                  onClick={() => setActiveTab('price_to_oi')}
                  className={`px-3 py-1 rounded-md text-[11.5px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'price_to_oi'
                      ? 'bg-[#2b2259] dark:bg-indigo-600 text-white shadow-xs'
                      : 'text-[#555] dark:text-slate-400 hover:text-[#111] dark:hover:text-white'
                  }`}
                >
                  <span>🎯 Hourly OI Analyzer</span>
                </button>
                <button
                  onClick={() => setActiveTab('chain')}
                  className={`px-3 py-1 rounded-md text-[11.5px] font-bold transition cursor-pointer flex items-center gap-1.5 ${
                    activeTab === 'chain'
                      ? 'bg-[#2b2259] dark:bg-indigo-600 text-white shadow-xs'
                      : 'text-[#555] dark:text-slate-400 hover:text-[#111] dark:hover:text-white'
                  }`}
                >
                  <span>⚡ NSE Option Chain</span>
                </button>
              </div>
            </div>
          </div>

          {/* Clean Filter & Key Metrics Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Expiry Selector */}
              <div className="flex items-center gap-1">
                <span className="text-[#666] dark:text-slate-400">Expiry:</span>
                <select
                  value={selectedExpiry}
                  onChange={(e) => {
                    setSelectedExpiry(e.target.value);
                    fetchData(e.target.value);
                  }}
                  className="h-6 px-1.5 rounded border border-[#d0d7de] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#2b2259] dark:text-indigo-300 font-bold text-[11px] focus:outline-none cursor-pointer"
                >
                  {data?.allExpiries && data.allExpiries.length > 0 ? (
                    data.allExpiries.map((exp) => (
                      <option key={exp} value={exp} className="dark:bg-slate-800 dark:text-slate-200">
                        {exp}
                      </option>
                    ))
                  ) : (
                    <option value={data?.expiry} className="dark:bg-slate-800 dark:text-slate-200">{data?.expiry || 'Current Expiry'}</option>
                  )}
                </select>
              </div>

              {/* Strike Filter */}
              <div className="flex items-center gap-1">
                <span className="text-[#666] dark:text-slate-400">Strikes:</span>
                <select
                  value={selectedStrike}
                  onChange={(e) => setSelectedStrike(e.target.value)}
                  className="h-6 px-1.5 rounded border border-[#d0d7de] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#333] dark:text-slate-200 font-medium text-[11px] focus:outline-none cursor-pointer"
                >
                  <option value="all" className="dark:bg-slate-800 dark:text-slate-200">All Strikes</option>
                  <option value="±10" className="dark:bg-slate-800 dark:text-slate-200">ATM ±10 Strikes</option>
                  <option value="±20" className="dark:bg-slate-800 dark:text-slate-200">ATM ±20 Strikes</option>
                  <option value="±30" className="dark:bg-slate-800 dark:text-slate-200">ATM ±30 Strikes</option>
                  {data?.rows?.map((r) => (
                    <option key={r.strike} value={r.strike.toString()} className="dark:bg-slate-800 dark:text-slate-200">
                      Strike {r.strike}
                    </option>
                  ))}
                </select>
              </div>

              {/* Instant Strike Search Input */}
              <div className="flex items-center relative">
                <div className="relative flex items-center">
                  <span className="absolute left-2 text-gray-400 dark:text-slate-500 pointer-events-none text-[10px]">
                    🔍
                  </span>
                  <input
                    type="text"
                    value={searchStrike}
                    onChange={(e) => setSearchStrike(e.target.value)}
                    placeholder="Search Strike (e.g. 23000)"
                    className="h-6 pl-6 pr-6 py-0.5 rounded border border-[#d0d7de] dark:border-slate-700 bg-white dark:bg-slate-800 text-[#2b2259] dark:text-indigo-200 font-semibold text-[11px] placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-[#2b2259] dark:focus:border-indigo-500 focus:ring-1 focus:ring-[#2b2259] dark:focus:ring-indigo-500 w-36 sm:w-44 transition"
                  />
                  {searchStrike && (
                    <button
                      onClick={() => setSearchStrike('')}
                      title="Clear search"
                      className="absolute right-1.5 text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 cursor-pointer p-0.5 text-[10px] font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center gap-3 text-[#555] dark:text-slate-400">
              <div>
                PCR: <span className="font-bold text-[#111] dark:text-slate-100">{data?.pcr?.toFixed(2) || '1.62'}</span>
              </div>
              <div>
                Max Pain: <span className="font-bold text-[#111] dark:text-slate-100">{data?.maxPain || 23000}</span>
              </div>
              <div>
                Call OI: <span className="font-bold text-[#111] dark:text-slate-100">{formatIndianNumber(data?.totalCeOI)}</span>
              </div>
              <div>
                Put OI: <span className="font-bold text-[#111] dark:text-slate-100">{formatIndianNumber(data?.totalPeOI)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── TAB 1: HOURLY PRICE-TO-OI ANALYZER ───────────────────────────────── */}
        {activeTab === 'price_to_oi' && (
          <div className="flex flex-col gap-3">
            {/* ── Simple 1-Hour Clickable Boxes (No duplicate dropdowns) ── */}
            <div className="bg-[#fafbfc] dark:bg-slate-900/60 border border-[#d0d7de] dark:border-slate-800 rounded-lg p-3 sm:p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold text-[#2b2259] dark:text-indigo-300">
                    ⏰ Click Any Hour Window:
                  </span>
                  <span className="text-gray-500 dark:text-slate-400 text-[11px]">
                    (Select a time box to see where institutional buyers and sellers were active)
                  </span>
                </div>
              </div>

              {/* Clickable Time Boxes */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-2 pt-0.5">
                {STANDARD_HOURLY_SLOTS.map((slot) => {
                  const isSelected = selectedSlotId === slot.id;
                  return (
                    <button
                      key={slot.id}
                      onClick={() => handleSlotClick(slot)}
                      className={`p-2 rounded-lg text-center font-bold text-[11px] transition-all cursor-pointer flex flex-col items-center justify-center border shadow-2xs ${
                        isSelected
                          ? 'bg-[#2b2259] dark:bg-indigo-600 text-white border-[#2b2259] dark:border-indigo-500 ring-2 ring-[#2b2259]/30 dark:ring-indigo-500/30 scale-[1.02]'
                          : 'bg-white dark:bg-slate-800 text-[#333] dark:text-slate-200 border-[#d0d7de] dark:border-slate-700 hover:border-[#2b2259] dark:hover:border-indigo-400 hover:bg-[#f8fafc] dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded text-[#2b2259] dark:text-indigo-500 cursor-pointer"
                        />
                        <span className="tracking-tight">{slot.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Executive Market Conclusion Summary Card */}
            {comparisonData && comparisonData.summary && (
              <div className="bg-gradient-to-r from-[#fafbfc] to-white dark:from-slate-900/90 dark:to-slate-900/50 border border-[#d0d7de] dark:border-slate-800 rounded-lg p-3.5 flex flex-col gap-2.5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[#444] dark:text-slate-300 font-semibold text-[12px]">Market Position in this Time Window:</span>
                    <span
                      className={`px-3 py-1 rounded-md text-[12px] font-black uppercase tracking-wider ${
                        comparisonData.summary.marketStance === 'STRONG BULLISH'
                          ? 'bg-emerald-600 text-white'
                          : comparisonData.summary.marketStance === 'BULLISH'
                          ? 'bg-emerald-500 text-white'
                          : comparisonData.summary.marketStance === 'STRONG BEARISH'
                          ? 'bg-rose-700 text-white'
                          : comparisonData.summary.marketStance === 'BEARISH'
                          ? 'bg-rose-500 text-white'
                          : 'bg-gray-600 text-white'
                      }`}
                    >
                      {comparisonData.summary.marketStance === 'STRONG BULLISH' && '🚀 STRONGLY BULLISH'}
                      {comparisonData.summary.marketStance === 'BULLISH' && '🟢 BULLISH'}
                      {comparisonData.summary.marketStance === 'NEUTRAL' && '⚪ SIDEWAYS / NEUTRAL'}
                      {comparisonData.summary.marketStance === 'BEARISH' && '🔴 BEARISH'}
                      {comparisonData.summary.marketStance === 'STRONG BEARISH' && '🔻 STRONGLY BEARISH'}
                    </span>
                  </div>

                  {/* Spot & PCR Shift */}
                  <div className="flex items-center gap-3 text-[11.5px] text-[#444] dark:text-slate-300">
                    <div>
                      Nifty Spot Shift:{' '}
                      <span className={`font-bold ${comparisonData.deltaSpot >= 0 ? 'text-[#008000] dark:text-emerald-400' : 'text-[#d32f2f] dark:text-rose-400'}`}>
                        {comparisonData.deltaSpot >= 0 ? `+${comparisonData.deltaSpot}` : comparisonData.deltaSpot} pts
                      </span>
                    </div>
                    <div>
                      PCR Shift:{' '}
                      <span className={`font-bold ${comparisonData.deltaPCR >= 0 ? 'text-[#008000] dark:text-emerald-400' : 'text-[#d32f2f] dark:text-rose-400'}`}>
                        {comparisonData.deltaPCR >= 0 ? `+${comparisonData.deltaPCR}` : comparisonData.deltaPCR}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Counter Breakdown Grid (Simple, Clear English) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] pt-1">
                  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 flex flex-col">
                    <span className="text-gray-500 dark:text-slate-400 font-medium">Call Buying (Bullish):</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400 text-[13px]">{comparisonData.summary.ce.longBuildup} strikes</span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 flex flex-col">
                    <span className="text-gray-500 dark:text-slate-400 font-medium">Call Writing (Resistance):</span>
                    <span className="font-bold text-red-700 dark:text-rose-400 text-[13px]">{comparisonData.summary.ce.shortBuildup} strikes</span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 flex flex-col">
                    <span className="text-gray-500 dark:text-slate-400 font-medium">Put Buying (Downside):</span>
                    <span className="font-bold text-red-700 dark:text-rose-400 text-[13px]">{comparisonData.summary.pe.longBuildup} strikes</span>
                  </div>
                  <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-2 flex flex-col">
                    <span className="text-gray-500 dark:text-slate-400 font-medium">Put Writing (Support Floor):</span>
                    <span className="font-bold text-emerald-700 dark:text-emerald-400 text-[13px]">{comparisonData.summary.pe.shortBuildup} strikes</span>
                  </div>
                </div>

                {/* Key Observations */}
                {comparisonData.summary.keyObservations?.length > 0 && (
                  <div className="text-[11px] text-[#333] dark:text-slate-300 pt-1.5 border-t border-gray-100 dark:border-slate-800 flex flex-col gap-1">
                    {comparisonData.summary.keyObservations.map((obs: string, idx: number) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <span className="text-[#ea6212] dark:text-orange-400 font-bold">✔</span>
                        <span>{obs}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Clean 9-Column Symmetrical Table (No extra 'Price Shift' column) */}
            <div className="overflow-x-auto border border-[#c8c8c8] dark:border-slate-800 rounded-md shadow-xs">
              <table className="w-full text-left border-collapse font-sans bg-white dark:bg-[#111827] text-[11px]">
                <thead>
                  {/* Master Header */}
                  <tr className="bg-[#2b2259] dark:bg-[#1a153a] text-white font-bold text-center border-b border-[#3e3478] dark:border-slate-800">
                    <th colSpan={4} className="py-1.5 text-center tracking-wider border-r-2 border-white/20">
                      CALLS (CE) • What Happened in this Hour
                    </th>
                    <th className="py-1.5 px-3 text-center border-r-2 border-white/20 bg-[#1f1842] dark:bg-[#110e26]">
                      STRIKE
                    </th>
                    <th colSpan={4} className="py-1.5 text-center tracking-wider">
                      PUTS (PE) • What Happened in this Hour
                    </th>
                  </tr>
                  {/* Sub Header */}
                  <tr className="bg-[#2b2259] dark:bg-[#1a153a] text-white text-[10.5px] border-b border-gray-300 dark:border-slate-700">
                    <th className="py-1 px-2 text-center border-r border-white/10">CONCLUSION</th>
                    <th className="py-1 px-2.5 text-right border-r border-white/10">OI (CHANGE)</th>
                    <th className="py-1 px-2.5 text-right border-r border-white/10">LTP</th>
                    <th className="py-1 px-2.5 text-right border-r-2 border-white/20">PRICE CHG</th>

                    {/* Strike */}
                    <th className="py-1 px-3 text-center border-r-2 border-white/20 bg-[#1f1842] dark:bg-[#110e26]">
                      STRIKE PRICE
                    </th>

                    {/* Puts */}
                    <th className="py-1 px-2.5 text-right border-r border-white/10">PRICE CHG</th>
                    <th className="py-1 px-2.5 text-right border-r border-white/10">LTP</th>
                    <th className="py-1 px-2.5 text-right border-r border-white/10">OI (CHANGE)</th>
                    <th className="py-1 px-2 text-center">CONCLUSION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6e6e6] dark:divide-slate-800">
                  {comparisonLoading ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-gray-500 dark:text-slate-400 font-medium">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-5 h-5 border-2 border-[#2b2259] dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
                          <span>Calculating hourly changes for this time range...</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredComparisonRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-gray-500 dark:text-slate-400">
                        {searchStrike ? (
                          <span>
                            No strike found matching <span className="font-bold text-[#2b2259] dark:text-indigo-400">"{searchStrike}"</span>. Try another strike or clear search.
                          </span>
                        ) : (
                          'No strike comparison data available. Please click on one of the hour boxes above.'
                        )}
                      </td>
                    </tr>
                  ) : (
                    filteredComparisonRows.map((row) => {
                      const ceBg = row.isITMCall ? 'bg-[#fff7d6] dark:bg-[#252210]' : 'bg-white dark:bg-[#111827]';
                      const peBg = row.isITMPut ? 'bg-[#fff7d6] dark:bg-[#252210]' : 'bg-white dark:bg-[#111827]';
                      const isATM = row.isATM;

                      return (
                        <tr
                          key={`comp_${row.strike}`}
                          className={`hover:bg-[#f0f7ff] dark:hover:bg-slate-800/60 transition-colors ${isATM ? 'font-semibold' : ''}`}
                        >
                          {/* ── CALLS (LEFT SIDE) ── */}
                          {/* Call Conclusion Badge */}
                          <td className={`py-1.5 px-2 text-center border-r border-[#e6e6e6] dark:border-slate-800 ${ceBg}`}>
                            {renderObservationBadge(row.ce.analysis.observation, row.ce.analysis.optionView, row.ce.analysis.equityView, true)}
                          </td>

                          {/* Call OI & Delta */}
                          <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${ceBg}`}>
                            <div className="flex flex-col items-end">
                              <span className="font-medium text-[#111] dark:text-slate-100">{formatIndianNumber(row.ce.toOI)}</span>
                              {renderDelta(row.ce.deltaOI, 0)}
                            </div>
                          </td>

                          {/* Call LTP */}
                          <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${ceBg}`}>
                            <div className="flex flex-col items-end">
                              <span className="text-[#0055b8] dark:text-blue-400 font-bold">
                                {row.ce.toLtp > 0 ? formatIndianNumber(row.ce.toLtp, 2) : '-'}
                              </span>
                              {row.ce.fromLtp > 0 && row.ce.fromLtp !== row.ce.toLtp && (
                                <span className="text-[9.5px] text-gray-400 dark:text-slate-500">
                                  from {row.ce.fromLtp.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Call Delta Price */}
                          <td className={`py-1.5 px-2.5 text-right border-r-2 border-[#b0b0b0] dark:border-slate-700 ${ceBg}`}>
                            {renderDelta(row.ce.deltaPrice, 2)}
                          </td>

                          {/* ── STRIKE PRICE (CENTER) ── */}
                          <td
                            className={`py-1.5 px-3 text-center font-bold border-r-2 border-[#b0b0b0] dark:border-slate-700 cursor-pointer hover:bg-[#d8e8fc] dark:hover:bg-blue-950/70 transition ${
                              isATM ? 'bg-[#e7f1ff] dark:bg-[#172554] text-[#0055b8] dark:text-blue-300' : 'bg-[#fafafa] dark:bg-[#0d1424] text-[#0055b8] dark:text-blue-400'
                            }`}
                            onClick={() => openStrikeModal(row.strike)}
                            title="Click on strike to view its hourly journey"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span className="underline hover:text-[#003380] dark:hover:text-blue-200">{formatIndianNumber(row.strike, 2)}</span>
                              {isATM && (
                                <span className="text-[8px] px-1 py-0.2 bg-[#0055b8] dark:bg-blue-600 text-white rounded font-bold uppercase">
                                  ATM
                                </span>
                              )}
                            </div>
                          </td>

                          {/* ── PUTS (RIGHT SIDE) ── */}
                          {/* Put Delta Price */}
                          <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${peBg}`}>
                            {renderDelta(row.pe.deltaPrice, 2)}
                          </td>

                          {/* Put LTP */}
                          <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${peBg}`}>
                            <div className="flex flex-col items-end">
                              <span className="text-[#0055b8] dark:text-blue-400 font-bold">
                                {row.pe.toLtp > 0 ? formatIndianNumber(row.pe.toLtp, 2) : '-'}
                              </span>
                              {row.pe.fromLtp > 0 && row.pe.fromLtp !== row.pe.toLtp && (
                                <span className="text-[9.5px] text-gray-400 dark:text-slate-500">
                                  from {row.pe.fromLtp.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Put OI & Delta */}
                          <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${peBg}`}>
                            <div className="flex flex-col items-end">
                              <span className="font-medium text-[#111] dark:text-slate-100">{formatIndianNumber(row.pe.toOI)}</span>
                              {renderDelta(row.pe.deltaOI, 0)}
                            </div>
                          </td>

                          {/* Put Conclusion Badge */}
                          <td className={`py-1.5 px-2 text-center ${peBg}`}>
                            {renderObservationBadge(row.pe.analysis.observation, row.pe.analysis.optionView, row.pe.analysis.equityView, false)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 2: STANDARD OPTION CHAIN (NSE VIEW) ─────────────────────────── */}
        {activeTab === 'chain' && (
          <div className="overflow-x-auto border border-[#c8c8c8] dark:border-slate-800 rounded-md shadow-xs">
            <table className="w-full text-left border-collapse font-sans bg-white dark:bg-[#111827] text-[11.5px]">
              <thead>
                <tr className="bg-[#2b2259] dark:bg-[#1a153a] text-white font-bold text-center border-b border-[#3e3478] dark:border-slate-800">
                  <th colSpan={4} className="py-1.5 text-center tracking-wider border-r-2 border-white/20">
                    CALLS
                  </th>
                  <th className="py-1.5 px-3 text-center border-r-2 border-white/20 bg-[#1f1842] dark:bg-[#110e26]">
                    STRIKE
                  </th>
                  <th colSpan={4} className="py-1.5 text-center tracking-wider">
                    PUTS
                  </th>
                </tr>
                <tr className="bg-[#2b2259] dark:bg-[#1a153a] text-white text-[11px] border-b border-gray-300 dark:border-slate-700">
                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">OI</th>
                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">CHNG IN OI</th>
                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">LTP</th>
                  <th className="py-1.5 px-2.5 text-right border-r-2 border-white/20">CHNG</th>

                  <th className="py-1.5 px-3 text-center border-r-2 border-white/20 bg-[#1f1842] dark:bg-[#110e26]">
                    STRIKE PRICE
                  </th>

                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">CHNG</th>
                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">LTP</th>
                  <th className="py-1.5 px-2.5 text-right border-r border-white/10">CHNG IN OI</th>
                  <th className="py-1.5 px-2.5 text-right">OI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6e6e6] dark:divide-slate-800">
                {filteredChainRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500 dark:text-slate-400">
                      {searchStrike ? (
                        <span>
                          No strike found matching <span className="font-bold text-[#2b2259] dark:text-indigo-400">"{searchStrike}"</span>. Try another strike or clear search.
                        </span>
                      ) : (
                        'No option chain data available.'
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredChainRows.map((row) => {
                  const ceBg = row.isITMCall ? 'bg-[#fff7d6] dark:bg-[#252210]' : 'bg-white dark:bg-[#111827]';
                  const peBg = row.isITMPut ? 'bg-[#fff7d6] dark:bg-[#252210]' : 'bg-white dark:bg-[#111827]';
                  const isATM = row.isATM;

                  return (
                    <tr
                      key={row.strike}
                      className={`hover:bg-[#f0f7ff] dark:hover:bg-slate-800/60 transition-colors ${isATM ? 'font-semibold' : ''}`}
                    >
                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 font-medium text-[#111] dark:text-slate-100 ${ceBg}`}>
                        {formatIndianNumber(row.ce.oi)}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 font-medium text-[#111] dark:text-slate-100 ${ceBg}`}>
                        {formatIndianNumber(row.ce.change_oi)}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${ceBg}`}>
                        {row.ce.ltp > 0 ? (
                          <span className="text-[#0055b8] dark:text-blue-400 font-bold hover:underline cursor-pointer">
                            {formatIndianNumber(row.ce.ltp, 2)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right border-r-2 border-[#b0b0b0] dark:border-slate-700 ${ceBg}`}>
                        {renderDelta(row.ce.price_change)}
                      </td>

                      <td
                        className={`py-1.5 px-3 text-center font-bold border-r-2 border-[#b0b0b0] dark:border-slate-700 cursor-pointer hover:bg-[#d8e8fc] dark:hover:bg-blue-950/70 ${
                          isATM ? 'bg-[#e7f1ff] dark:bg-[#172554] text-[#0055b8] dark:text-blue-300' : 'bg-[#fafafa] dark:bg-[#0d1424] text-[#0055b8] dark:text-blue-400'
                        }`}
                        onClick={() => openStrikeModal(row.strike)}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span className="underline hover:text-[#003380] dark:hover:text-blue-200">{formatIndianNumber(row.strike, 2)}</span>
                          {isATM && (
                            <span className="text-[8px] px-1 py-0.2 bg-[#0055b8] dark:bg-blue-600 text-white rounded font-bold uppercase">
                              ATM
                            </span>
                          )}
                        </div>
                      </td>

                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${peBg}`}>
                        {renderDelta(row.pe.price_change)}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 ${peBg}`}>
                        {row.pe.ltp > 0 ? (
                          <span className="text-[#0055b8] dark:text-blue-400 font-bold hover:underline cursor-pointer">
                            {formatIndianNumber(row.pe.ltp, 2)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right border-r border-[#e6e6e6] dark:border-slate-800 font-medium text-[#111] dark:text-slate-100 ${peBg}`}>
                        {formatIndianNumber(row.pe.change_oi)}
                      </td>
                      <td className={`py-1.5 px-2.5 text-right text-[#111] dark:text-slate-100 font-medium ${peBg}`}>
                        {formatIndianNumber(row.pe.oi)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            </table>
          </div>
        )}

        {/* ── Clean Footer ────────────────────────────────────────────────────── */}
        <div className="w-full mt-2.5 text-[11px] text-[#666] dark:text-slate-400 flex flex-wrap items-center justify-between gap-2 px-1">
          <div>
            * Data source: NSE India • Snapshot Checkpoint: <span className="font-semibold text-[#111] dark:text-slate-200">{data?.checkpoint || 'LIVE'}</span>
          </div>
          <div>
            Tip: Click on any <b className="text-[#111] dark:text-slate-200">Strike Price</b> to inspect its hourly journey.
          </div>
        </div>
      </div>

      {/* ── STRIKE DEEP-DIVE INSPECTOR MODAL ──────────────────────────────────── */}
      {modalStrike !== null && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white dark:bg-[#111827] rounded-xl border border-[#d0d7de] dark:border-slate-800 shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-[#2b2259] dark:bg-[#1a153a] text-white p-3 sm:p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[16px] font-black tracking-wide">
                  Strike {modalStrike} • Hourly Timeline Journey
                </span>
                <span className="text-[11px] bg-white/20 px-2 py-0.5 rounded font-mono">
                  NIFTY
                </span>
              </div>
              <button
                onClick={() => setModalStrike(null)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 text-white transition cursor-pointer text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
              {modalLoading ? (
                <div className="py-16 text-center text-gray-500 dark:text-slate-400 font-medium flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-[#2b2259] dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
                  <span>Loading hourly progression for Strike {modalStrike}...</span>
                </div>
              ) : strikeHistory.length === 0 ? (
                <div className="py-12 text-center text-gray-500 dark:text-slate-400">
                  No historical snapshots found for Strike {modalStrike}.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="text-[11.5px] text-[#444] dark:text-slate-300 bg-[#f8fafc] dark:bg-slate-900/60 p-2.5 rounded-lg border border-[#e2e8f0] dark:border-slate-800">
                    Chronological step-by-step breakdown across each recorded hour. Check how Call and Put positions built up or covered.
                  </div>

                  <div className="border border-[#e1e4e8] dark:border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-[#f0f2f5] dark:bg-slate-800 text-[#333] dark:text-slate-200 font-bold border-b border-[#e1e4e8] dark:border-slate-800">
                          <th className="py-2 px-2.5 text-center">TIME SLOT</th>
                          <th className="py-2 px-2 text-right">SPOT</th>
                          <th className="py-2 px-2 text-right">CE LTP (OI)</th>
                          <th className="py-2 px-2 text-center">CALL ACTION</th>
                          <th className="py-2 px-2 text-right">PE LTP (OI)</th>
                          <th className="py-2 px-2 text-center">PUT ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#eee] dark:divide-slate-800">
                        {strikeHistory.map((step, idx) => (
                          <tr key={`step_${step.snapshotId}`} className="hover:bg-[#f8fafc] dark:hover:bg-slate-800/60">
                            <td className="py-2 px-2.5 font-bold text-[#2b2259] dark:text-indigo-400 text-center">
                              {step.formattedIST} <span className="text-[10px] text-gray-500 dark:text-slate-400 font-normal">[{step.checkpoint}]</span>
                            </td>
                            <td className="py-2 px-2 text-right font-medium text-gray-700 dark:text-slate-300">
                              {step.spot.toFixed(1)}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <span className="font-bold text-[#0055b8] dark:text-blue-400">₹{step.ce?.ltp || 0}</span>{' '}
                              <span className="text-gray-500 dark:text-slate-400 text-[10px]">({formatIndianNumber(step.ce?.oi)})</span>
                            </td>
                            <td className="py-2 px-2 text-center">
                              {step.ceAnalysis ? (
                                renderObservationBadge(
                                  step.ceAnalysis.observation,
                                  step.ceAnalysis.optionView,
                                  step.ceAnalysis.equityView,
                                  true
                                )
                              ) : (
                                <span className="text-gray-400 dark:text-slate-500 text-[10px]">Baseline</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <span className="font-bold text-[#0055b8] dark:text-blue-400">₹{step.pe?.ltp || 0}</span>{' '}
                              <span className="text-gray-500 dark:text-slate-400 text-[10px]">({formatIndianNumber(step.pe?.oi)})</span>
                            </td>
                            <td className="py-2 px-2 text-center">
                              {step.peAnalysis ? (
                                renderObservationBadge(
                                  step.peAnalysis.observation,
                                  step.peAnalysis.optionView,
                                  step.peAnalysis.equityView,
                                  false
                                )
                              ) : (
                                <span className="text-gray-400 dark:text-slate-500 text-[10px]">Baseline</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-[#fafbfc] dark:bg-slate-900/60 border-t border-[#e1e4e8] dark:border-slate-800 p-3 flex justify-end">
              <button
                onClick={() => setModalStrike(null)}
                className="px-4 py-1.5 bg-[#2b2259] dark:bg-indigo-600 text-white text-[12px] font-bold rounded-md hover:bg-[#1f1842] dark:hover:bg-indigo-500 transition cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
