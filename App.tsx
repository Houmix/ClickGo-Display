import { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, StatusBar,
  TouchableOpacity, Animated,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { loadSavedUrl, saveUrl, clearUrl, scanNetwork, testIp, getPosUrl } from './utils/serverConfig';

// ── Types ─────────────────────────────────────────────────────────────────────
type AppScreen = 'scanning' | 'display';

interface DisplayOrder {
  order_id: number;
  kds_status: string;
  customer_identifier?: string;
  created_at: string;
}

// ── Colonnes ──────────────────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'waiting',     label: 'En attente',  statuses: ['new', 'pending_validation'], color: '#f59e0b', bg: '#fffbeb', icon: '⏳' },
  { key: 'in_progress', label: 'En cours',    statuses: ['in_progress'],               color: '#3b82f6', bg: '#eff6ff', icon: '🔥' },
  { key: 'ready',       label: 'Prête',       statuses: ['done'],                      color: '#10b981', bg: '#ecfdf5', icon: '✅' },
];

const RETRY_DELAY = 30_000;

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,    setScreen]    = useState<AppScreen>('scanning');
  const [scanPct,   setScanPct]   = useState(0);
  const [scanMsg,   setScanMsg]   = useState('Recherche du serveur caisse…');
  const [orders,    setOrders]    = useState<DisplayOrder[]>([]);
  const [wsStatus,  setWsStatus]  = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [clock,     setClock]     = useState(new Date());

  const wsRef        = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const restaurantIdRef = useRef<string>('');

  // Horloge
  useEffect(() => {
    activateKeepAwakeAsync();
    const clk = setInterval(() => setClock(new Date()), 1000);
    return () => { deactivateKeepAwake(); clearInterval(clk); };
  }, []);

  useEffect(() => { bootstrap(); return cleanup; }, []);

  const cleanup = () => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    wsRef.current?.close();
  };

  // ── Reconnexion rapide (sans changer d'écran) ────────────────────────────
  const reconnect = async () => {
    const url = getPosUrl();
    if (url) {
      // On connaît déjà le serveur → reconnexion directe, pas de scan
      setWsStatus('connecting');
      const ok = await testIp(url);
      if (ok) {
        restaurantIdRef.current = ok.restaurantId;
        connect(ok.url);
        return;
      }
    }
    // Serveur perdu → fallback sur le bootstrap complet
    bootstrap();
  };

  // ── Bootstrap : découverte initiale du serveur ──────────────────────────
  const bootstrap = async () => {
    setScreen('scanning');
    setScanPct(0);

    const saved = await loadSavedUrl();
    if (saved) {
      setScanMsg('Connexion au serveur connu…');
      const ok = await testIp(saved);
      if (ok) {
        await saveUrl(ok.url, ok.restaurantId);
        restaurantIdRef.current = ok.restaurantId;
        connect(ok.url);
        return;
      }
      setScanMsg('Serveur introuvable, scan du réseau…');
      await clearUrl();
    }

    setScanMsg('Scan du réseau local…');
    const found = await scanNetwork((s, t) => setScanPct(Math.round((s / t) * 100)));
    if (found) {
      await saveUrl(found.url, found.restaurantId);
      restaurantIdRef.current = found.restaurantId;
      connect(found.url);
    } else {
      setScanMsg('Serveur introuvable. Nouvelle tentative dans 30s…');
      reconnectRef.current = setTimeout(() => bootstrap(), RETRY_DELAY);
    }
  };

  // ── Fetch commandes ───────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    const url = getPosUrl();
    const resId = restaurantIdRef.current;
    if (!url || !resId) return;
    try {
      const r = await fetch(`${url}/order/api/kds/orders/${resId}/?include_pending=1`);
      if (r.ok) {
        const data = await r.json();
        const active = (data.orders || []).filter(
          (o: DisplayOrder) => !['delivered', 'cancelled'].includes(o.kds_status) && !o.cancelled
        );
        setOrders(active);
      }
    } catch {}
  }, []);

  // ── WebSocket KDS ─────────────────────────────────────────────────────────
  const connect = (url: string) => {
    const wsUrl = url.replace(/^http/, 'ws') + '/ws/kds/';
    wsRef.current?.close();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    setWsStatus('connecting');

    ws.onopen = () => {
      setWsStatus('connected');
      setScreen('display');
      fetchOrders();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchOrders, 5000);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'kds_message') return;
        const { type, order_id, kds_status } = msg.data;

        if (type === 'new_order') {
          fetchOrders();
        } else if (type === 'order_updated') {
          if (['delivered', 'cancelled'].includes(kds_status)) {
            setOrders(prev => prev.filter(o => o.order_id !== order_id));
          } else {
            setOrders(prev =>
              prev.map(o => o.order_id === order_id ? { ...o, kds_status } : o)
            );
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      if (pollRef.current) clearInterval(pollRef.current);
      // Reconnexion rapide sans repasser par l'écran de scan
      reconnectRef.current = setTimeout(() => reconnect(), 3000);
    };
    ws.onerror = () => ws.close();
  };

  // ── Scanning ──────────────────────────────────────────────────────────────
  if (screen === 'scanning') {
    return (
      <View style={s.scanContainer}>
        <StatusBar hidden />
        <Text style={s.scanTitle}>ClickGo Display</Text>
        <Text style={s.scanMsg}>{scanMsg}</Text>
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${scanPct}%` as any }]} />
        </View>
        <Text style={s.scanPct}>{scanPct}%</Text>
      </View>
    );
  }

  // ── Display : 3 colonnes ──────────────────────────────────────────────────
  return (
    <View style={s.screen}>
      <StatusBar hidden />

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Suivi de commande</Text>
        <View style={s.headerRight}>
          <View style={s.wsRow}>
            <View style={[s.wsDot, {
              backgroundColor: wsStatus === 'connected' ? '#4ade80'
                : wsStatus === 'connecting' ? '#fbbf24' : '#f87171'
            }]} />
            <Text style={s.wsLabel}>
              {wsStatus === 'connected' ? 'En ligne' : wsStatus === 'connecting' ? 'Connexion…' : 'Hors ligne'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { clearUrl(); bootstrap(); }} style={s.rescanBtn}>
            <Text style={s.rescanText}>Reconnecter</Text>
          </TouchableOpacity>
          <Text style={s.clock}>
            {clock.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>

      {/* Colonnes */}
      <View style={s.columnsContainer}>
        {COLUMNS.map(col => {
          const colOrders = orders
            .filter(o => col.statuses.includes(o.kds_status))
            .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

          return (
            <View key={col.key} style={s.column}>
              {/* En-tête colonne */}
              <View style={[s.columnHeader, { backgroundColor: col.color }]}>
                <Text style={s.columnIcon}>{col.icon}</Text>
                <Text style={s.columnLabel}>{col.label}</Text>
                <View style={s.columnCount}>
                  <Text style={s.columnCountText}>{colOrders.length}</Text>
                </View>
              </View>

              {/* Liste des numéros */}
              <ScrollView
                style={[s.columnBody, { backgroundColor: col.bg }]}
                contentContainerStyle={s.columnContent}
                showsVerticalScrollIndicator={false}
              >
                {colOrders.length === 0 ? (
                  <View style={s.emptyCol}>
                    <Text style={s.emptyText}>—</Text>
                  </View>
                ) : (
                  colOrders.map(order => (
                    <OrderCard
                      key={order.order_id}
                      order={order}
                      color={col.color}
                      isReady={col.key === 'ready'}
                    />
                  ))
                )}
              </ScrollView>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── Carte commande avec animation ────────────────────────────────────────────
function OrderCard({ order, color, isReady }: { order: DisplayOrder; color: string; isReady: boolean }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isReady) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    }
  }, [isReady]);

  const num = String(order.order_id).padStart(3, '0');

  return (
    <Animated.View style={[
      s.orderCard,
      { borderLeftColor: color },
      isReady && { transform: [{ scale: pulseAnim }] },
    ]}>
      <Text style={[s.orderNumber, { color }]}>#{num}</Text>
      {order.customer_identifier ? (
        <Text style={s.orderCustomer} numberOfLines={1}>{order.customer_identifier}</Text>
      ) : null}
    </Animated.View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Scanning
  scanContainer:  { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 40 },
  scanTitle:      { fontSize: 36, fontWeight: '800', color: 'white', marginBottom: 12 },
  scanMsg:        { fontSize: 16, color: '#94a3b8', marginBottom: 24, textAlign: 'center' },
  progressBar:    { width: '60%', height: 8, backgroundColor: '#1e293b', borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill:   { height: 8, backgroundColor: '#756fbf', borderRadius: 4 },
  scanPct:        { fontSize: 14, color: '#64748b', fontWeight: '600' },

  // Screen
  screen:         { flex: 1, backgroundColor: '#0f172a' },

  // Header
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e293b', paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#334155' },
  headerTitle:    { fontSize: 24, fontWeight: '900', color: 'white', letterSpacing: 1 },
  headerRight:    { flexDirection: 'row', alignItems: 'center', gap: 16 },
  wsRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wsDot:          { width: 8, height: 8, borderRadius: 4 },
  wsLabel:        { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  rescanBtn:      { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8 },
  rescanText:     { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '600' },
  clock:          { color: 'rgba(255,255,255,0.5)', fontSize: 20, fontWeight: '700', fontFamily: 'monospace' },

  // Colonnes
  columnsContainer: { flex: 1, flexDirection: 'row', gap: 2 },

  column:         { flex: 1 },
  columnHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, gap: 10 },
  columnIcon:     { fontSize: 22 },
  columnLabel:    { fontSize: 20, fontWeight: '800', color: 'white', letterSpacing: 0.5 },
  columnCount:    { backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 100, width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  columnCountText:{ color: 'white', fontWeight: '900', fontSize: 16 },

  columnBody:     { flex: 1 },
  columnContent:  { padding: 12, gap: 10 },

  emptyCol:       { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyText:      { fontSize: 32, color: 'rgba(0,0,0,0.15)', fontWeight: '700' },

  // Order card
  orderCard:      { backgroundColor: 'white', borderRadius: 16, padding: 16, borderLeftWidth: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  orderNumber:    { fontSize: 36, fontWeight: '900', textAlign: 'center' },
  orderCustomer:  { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 4, fontWeight: '600' },
});
