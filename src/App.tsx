import { useCallback, useEffect, useState } from 'react';
import {
  BarChart2,
  CalendarDays,
  CheckSquare,
  Clapperboard,
  Compass,
  FolderKanban,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { CalendarView } from './components/CalendarView';
import { CommentsView } from './components/CommentsView';
import { InsightsView } from './components/InsightsView';
import { LibraryView } from './components/LibraryView';
import { OverviewView } from './components/OverviewView';
import { ReviewView } from './components/ReviewView';
import { SettingsView } from './components/SettingsView';
import { StudioView } from './components/StudioView';
import { VideosView } from './components/VideosView';
import type { StudioState } from './types/ui';

type NavTab = 'overview' | 'library' | 'studio' | 'review' | 'calendar' | 'videos' | 'comments' | 'insights' | 'channels';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'library', label: '创意库与导入', icon: FolderKanban },
  { id: 'studio', label: '制作与渲染', icon: Clapperboard },
  { id: 'review', label: '审核队列', icon: CheckSquare },
  { id: 'calendar', label: '排期与配额', icon: CalendarDays },
  { id: 'videos', label: '频道视频与数据', icon: BarChart2 },
  { id: 'comments', label: '评论中心', icon: MessageSquare },
  { id: 'insights', label: '情报与趋势', icon: Compass },
  { id: 'channels', label: '频道与设置', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [channelId, setChannelId] = useState<string>('ch-physics-music');
  const [state, setState] = useState<StudioState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchState = useCallback(async (targetChannelId: string) => {
    try {
      const res = await fetch(`/api/state?channelId=${encodeURIComponent(targetChannelId)}`);
      if (!res.ok) throw new Error('无法加载工作台状态');
      const data = (await res.json()) as StudioState;
      setState(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState(channelId);
  }, [channelId, fetchState]);

  /** 深链接意图：切到某页时可直接落在指定子标签（如创意库的「导入」） */
  const [navIntent, setNavIntent] = useState<string | null>(null);

  const handleNavigate = (tab: string) => {
    setActiveTab(tab as NavTab);
    setNavIntent(null);
    setMobileMenuOpen(false);
  };

  const handleNavigateWithIntent = (tab: NavTab, intent: string) => {
    setActiveTab(tab);
    setNavIntent(intent);
    setMobileMenuOpen(false);
  };

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab) ?? NAV_ITEMS[0];
  const reviewCount = state?.specs.filter((s) => s.status === 'in_review').length ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-slate-200 md:bg-white">
        <div className="flex h-16 items-center border-b border-slate-200 px-6">
          <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            Shorts Studio
          </span>
        </div>
        <nav aria-label="主导航" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'review' && reviewCount > 0 && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? 'text-slate-200' : 'text-slate-500'
                    }`}
                  >
                    {reviewCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-slate-950/40" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 flex w-64 flex-col bg-white border-r border-slate-200">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
              <span className="font-display text-base font-bold text-slate-900">Shorts Studio</span>
              <button
                type="button"
                aria-label="关闭导航"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded p-1.5 text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium ${
                      activeTab === item.id ? 'bg-slate-900 text-white' : 'text-slate-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb / Channel Switcher / 1 Primary Action */}
        <header className="flex h-16 items-center justify-between gap-2 sm:gap-4 border-b border-slate-200 bg-white px-3 sm:px-4 md:px-8">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              aria-label="打开菜单"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden shrink-0"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="hidden sm:block truncate text-sm font-semibold text-slate-900 md:text-base">
              {state ? `${state.channel.title} / ${activeNav.label}` : '加载中...'}
            </h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0">
            {state && (
              <select
                aria-label="切换隔离频道"
                value={state.channel.id}
                onChange={(e) => setChannelId(e.target.value)}
                className="max-w-[195px] sm:max-w-[260px] truncate rounded-md border border-slate-200 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-slate-900 focus:outline-none"
              >
                {state.channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.title} ({ch.slug})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => handleNavigateWithIntent('library', 'import')}
              title="前往创意库的「导入 JSON 与模板」"
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 sm:px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">导入或生成 Spec</span>
              <span className="sm:hidden">导入</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-8 max-w-[1360px] w-full mx-auto">
          {loading && !state && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white" />
                ))}
              </div>
              <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {error}
            </div>
          )}

          {state && (
            <>
              {activeTab === 'overview' && <OverviewView state={state} onNavigate={handleNavigate} />}
              {activeTab === 'library' && (
                <LibraryView
                  state={state}
                  initialSubTab={navIntent ?? undefined}
                  onIntentConsumed={() => setNavIntent(null)}
                  onRefresh={() => fetchState(state.channel.id)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeTab === 'studio' && (
                <StudioView
                  state={state}
                  onRefresh={() => fetchState(state.channel.id)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeTab === 'review' && (
                <ReviewView
                  state={state}
                  onRefresh={() => fetchState(state.channel.id)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeTab === 'calendar' && (
                <CalendarView state={state} onRefresh={() => fetchState(state.channel.id)} />
              )}
              {activeTab === 'videos' && (
                <VideosView
                  state={state}
                  onRefresh={() => fetchState(state.channel.id)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeTab === 'comments' && (
                <CommentsView state={state} onRefresh={() => fetchState(state.channel.id)} />
              )}
              {activeTab === 'insights' && (
                <InsightsView
                  state={state}
                  onRefresh={() => fetchState(state.channel.id)}
                  onNavigate={handleNavigate}
                />
              )}
              {activeTab === 'channels' && (
                <SettingsView
                  state={state}
                  onRefresh={() => fetchState(state.channel.id)}
                  onSwitchChannel={(id) => setChannelId(id)}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
