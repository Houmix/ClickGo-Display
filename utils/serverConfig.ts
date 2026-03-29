import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_KEY   = 'display_server_url';
const DISCOVER_PATH = '/api/sync/discover/';
const PORT          = 8000;
const SCAN_TIMEOUT  = 1500;

let _url = '';

export function getPosUrl() { return _url; }
export function setPosUrl(url: string) { _url = url; }

export async function loadSavedUrl(): Promise<string | null> {
    const saved = await AsyncStorage.getItem(SERVER_KEY).catch(() => null);
    if (saved) _url = saved;
    return saved;
}

export async function saveUrl(url: string) {
    _url = url;
    await AsyncStorage.setItem(SERVER_KEY, url);
}

export async function clearUrl() {
    _url = '';
    await AsyncStorage.removeItem(SERVER_KEY);
}

export async function testIp(ip: string): Promise<string | null> {
    const url = `http://${ip}:${PORT}`;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), SCAN_TIMEOUT);
        const res = await fetch(`${url}${DISCOVER_PATH}`, { signal: ctrl.signal });
        clearTimeout(t);
        if (res.ok) {
            const data = await res.json();
            if (data.server === 'caisse') return url;
        }
    } catch {}
    return null;
}

export async function scanNetwork(
    onProgress?: (scanned: number, total: number) => void
): Promise<string | null> {
    const subnets = ['192.168.1', '192.168.0', '10.0.0', '10.0.1', '192.168.100'];
    const priority = [1, 2, 100, 101, 50, 200, 254, 10, 20, 30, 40];

    const ips: string[] = ['127.0.0.1'];
    for (const subnet of subnets) {
        for (const last of priority) ips.push(`${subnet}.${last}`);
        for (let i = 1; i <= 254; i++) {
            if (!priority.includes(i)) ips.push(`${subnet}.${i}`);
        }
    }

    const total = ips.length;
    let scanned = 0;
    const BATCH = 30;

    for (let i = 0; i < ips.length; i += BATCH) {
        const results = await Promise.all(ips.slice(i, i + BATCH).map(testIp));
        scanned += Math.min(BATCH, ips.length - i);
        onProgress?.(scanned, total);
        const found = results.find(r => r !== null);
        if (found) return found;
    }
    return null;
}
