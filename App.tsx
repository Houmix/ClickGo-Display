import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, FlatList, StatusBar, TouchableOpacity } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { loadSavedUrl, saveUrl, clearUrl, scanNetwork, testIp } from './utils/serverConfig';

// ── Types ────────────────────────────────────────────────────────────────────
type AppScreen = 'scanning' | 'idle' | 'order' | 'confirmed';

interface OrderItem { name: string; qty: number; price: number; is_reward?: boolean; }
interface OrderData  { order_id: number; total: number; items: OrderItem[]; customer_identifier?: string; }

const RETRY_DELAY = 30_000; // rescan si serveur perdu

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,    setScreen]    = useState<AppScreen>('scanning');
  const [scanPct,   setScanPct]   = useState(0);
  const [scanMsg,   setScanMsg]   = useState('Recherche du serveur caisse…');
  const [order,     setOrder]     = useState<OrderData | null>(null);
  const [connected, setConnected] = useState(false);

  const serverUrl    = useRef('');
  const wsRef        = useRef<WebSocket | null>(null);
  const idleTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Écran toujours allumé
  useEffect(() => {
    activateKeepAwakeAsync();
    return () => { deactivateKeepAwake(); };
  }, []);

  // Démarrage : essai URL sauvegardée puis scan
  useEffect(() => { bootstrap(); }, []);

  const bootstrap = async () => {
    setScreen('scanning');
    setScanPct(0);

    // 1. Tenter l'URL mémorisée
    const saved = await loadSavedUrl();
    if (saved) {
      setScanMsg('Connexion au serveur connu…');
      const ok = await testIp(saved);
      if (ok) { connectWS(ok); return; }
      setScanMsg('Serveur introuvable, scan du réseau…');
      await clearUrl();
    }

    // 2. Scanner le réseau
    setScanMsg('Scan du réseau local…');
    const found = await scanNetwork((scanned, total) => {
      setScanPct(Math.round((scanned / total) * 100));
    });

    if (found) {
      await saveUrl(found);
      connectWS(found);
    } else {
      setScanMsg('Serveur introuvable. Nouvelle tentative dans 30s…');
      reconnectRef.current = setTimeout(() => bootstrap(), RETRY_DELAY);
    }
  };

  const connectWS = (url: string) => {
    serverUrl.current = url;
    const wsUrl = url.replace(/^http/, 'ws') + '/ws/display/';

    wsRef.current?.close();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setScreen('idle');
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type !== 'display_message') return;
        const data = msg.data;

        if (data.status === 'order_in_progress') {
          setOrder(data);
          setScreen('order');
          if (idleTimer.current) clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setScreen('idle'), 60_000);
        } else if (data.status === 'order_confirmed') {
          setScreen('confirmed');
          if (idleTimer.current) clearTimeout(idleTimer.current);
          idleTimer.current = setTimeout(() => setScreen('idle'), 5_000);
        } else if (data.status === 'idle') {
          setScreen('idle');
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      // Connexion perdue → rescan après 5s
      reconnectRef.current = setTimeout(() => bootstrap(), 5_000);
    };

    ws.onerror = () => { ws.close(); };
  };

  // ── Scanning ────────────────────────────────────────────────────────────────
  if (screen === 'scanning') {
    return (
      <View style={s.scanContainer}>
        <StatusBar hidden />
        <Image source={require('./assets/icon.png')} style={s.scanLogo} resizeMode="contain" />
        <Text style={s.scanTitle}>ClickGo Display</Text>
        <Text style={s.scanMsg}>{scanMsg}</Text>

        {/* Barre de progression */}
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${scanPct}%` }]} />
        </View>
        <Text style={s.scanPct}>{scanPct}%</Text>
      </View>
    );
  }

  // ── Idle ────────────────────────────────────────────────────────────────────
  if (screen === 'idle') {
    return (
      // Appui long (5s) → forcer un nouveau scan (pour débug technicien)
      <TouchableOpacity activeOpacity={1} onLongPress={() => { clearUrl(); bootstrap(); }} style={s.idleContainer}>
        <StatusBar hidden />
        <Image source={require('./assets/icon.png')} style={s.idleLogo} resizeMode="contain" />
        <Text style={s.idleTitle}>Bienvenue</Text>
        <Text style={s.idleSub}>Votre commande apparaîtra ici</Text>
        {!connected && (
          <View style={s.disconnectedBadge}>
            <Text style={s.disconnectedText}>● Reconnexion…</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // ── Commande en cours ───────────────────────────────────────────────────────
  if (screen === 'order' && order) {
    return (
      <View style={s.orderContainer}>
        <StatusBar hidden />

        {/* Colonne articles */}
        <View style={s.orderLeft}>
          <Text style={s.orderHeader}>Votre commande</Text>
          <FlatList
            data={order.items}
            keyExtractor={(_, i) => String(i)}
            ItemSeparatorComponent={() => <View style={s.separator} />}
            renderItem={({ item }) => (
              <View style={[s.orderRow, item.is_reward && s.orderRowReward]}>
                <Text style={s.orderQty}>{item.qty}x</Text>
                <Text style={[s.orderName, item.is_reward && s.orderNameReward]} numberOfLines={1}>
                  {item.is_reward ? `🎁 ${item.name}` : item.name}
                </Text>
                <Text style={[s.orderPrice, item.is_reward && s.orderPriceReward]}>
                  {item.is_reward ? 'OFFERT' : `${item.price} DA`}
                </Text>
              </View>
            )}
          />
        </View>

        {/* Colonne total */}
        <View style={s.orderRight}>
          {order.customer_identifier ? (
            <View style={s.customerBadge}>
              <Text style={s.customerLabel}>Client</Text>
              <Text style={s.customerName} numberOfLines={1}>{order.customer_identifier}</Text>
            </View>
          ) : null}
          <View style={s.totalBox}>
            <Text style={s.totalLabel}>TOTAL</Text>
            <Text style={s.totalAmount}>{order.total.toFixed(0)} DA</Text>
          </View>
          <Text style={s.thankYou}>Merci de votre confiance !</Text>
        </View>
      </View>
    );
  }

  // ── Confirmation ────────────────────────────────────────────────────────────
  return (
    <View style={s.confirmedContainer}>
      <StatusBar hidden />
      <Text style={s.confirmedEmoji}>✅</Text>
      <Text style={s.confirmedTitle}>Commande confirmée !</Text>
      <Text style={s.confirmedSub}>Bonne dégustation 😊</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Scanning
  scanContainer:  { flex:1, backgroundColor:'#0f172a', justifyContent:'center', alignItems:'center', padding:40 },
  scanLogo:       { width:100, height:100, marginBottom:20, opacity:0.9 },
  scanTitle:      { fontSize:32, fontWeight:'800', color:'white', marginBottom:8 },
  scanMsg:        { fontSize:16, color:'#94a3b8', marginBottom:24, textAlign:'center' },
  progressBar:    { width:'60%', height:8, backgroundColor:'#1e293b', borderRadius:4, overflow:'hidden', marginBottom:8 },
  progressFill:   { height:8, backgroundColor:'#0056b3', borderRadius:4 },
  scanPct:        { fontSize:14, color:'#64748b', fontWeight:'600' },

  // Idle
  idleContainer:  { flex:1, backgroundColor:'#0056b3', justifyContent:'center', alignItems:'center' },
  idleLogo:       { width:160, height:160, marginBottom:24 },
  idleTitle:      { fontSize:64, fontWeight:'900', color:'white', letterSpacing:2 },
  idleSub:        { fontSize:22, color:'rgba(255,255,255,0.7)', marginTop:8 },
  disconnectedBadge: { position:'absolute', bottom:20, right:20, backgroundColor:'rgba(0,0,0,0.4)', paddingHorizontal:14, paddingVertical:8, borderRadius:20 },
  disconnectedText:  { color:'#fbbf24', fontSize:13, fontWeight:'600' },

  // Order
  orderContainer: { flex:1, flexDirection:'row', backgroundColor:'#f8fafc' },
  orderLeft:      { flex:3, backgroundColor:'white', padding:32, borderRightWidth:1, borderRightColor:'#e2e8f0' },
  orderHeader:    { fontSize:28, fontWeight:'800', color:'#0f172a', marginBottom:20, borderBottomWidth:3, borderBottomColor:'#0056b3', paddingBottom:12 },
  orderRow:       { flexDirection:'row', alignItems:'center', paddingVertical:10 },
  orderRowReward: { backgroundColor:'#fefce8', borderRadius:8, paddingHorizontal:8 },
  orderQty:       { fontSize:20, fontWeight:'800', color:'#0056b3', width:48 },
  orderName:      { flex:1, fontSize:20, color:'#0f172a', fontWeight:'500' },
  orderNameReward:{ color:'#92400e' },
  orderPrice:     { fontSize:20, fontWeight:'700', color:'#64748b' },
  orderPriceReward:{ color:'#16a34a', fontWeight:'800' },
  separator:      { height:1, backgroundColor:'#f1f5f9' },

  orderRight:     { flex:2, backgroundColor:'#0056b3', padding:32, justifyContent:'center', alignItems:'center' },
  customerBadge:  { backgroundColor:'rgba(255,255,255,0.15)', borderRadius:16, paddingHorizontal:24, paddingVertical:12, marginBottom:32, width:'100%', alignItems:'center' },
  customerLabel:  { fontSize:14, color:'rgba(255,255,255,0.7)', fontWeight:'600', marginBottom:4 },
  customerName:   { fontSize:22, color:'white', fontWeight:'800' },
  totalBox:       { backgroundColor:'white', borderRadius:24, padding:32, alignItems:'center', width:'100%', marginBottom:24, shadowColor:'#000', shadowOffset:{width:0,height:8}, shadowOpacity:0.2, shadowRadius:16, elevation:8 },
  totalLabel:     { fontSize:18, fontWeight:'700', color:'#64748b', letterSpacing:4, marginBottom:8 },
  totalAmount:    { fontSize:56, fontWeight:'900', color:'#0056b3' },
  thankYou:       { fontSize:18, color:'rgba(255,255,255,0.8)', fontWeight:'500', textAlign:'center' },

  // Confirmed
  confirmedContainer: { flex:1, backgroundColor:'#16a34a', justifyContent:'center', alignItems:'center' },
  confirmedEmoji:     { fontSize:100, marginBottom:24 },
  confirmedTitle:     { fontSize:56, fontWeight:'900', color:'white', marginBottom:12 },
  confirmedSub:       { fontSize:28, color:'rgba(255,255,255,0.8)' },
});
