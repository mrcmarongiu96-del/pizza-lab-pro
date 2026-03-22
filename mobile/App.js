import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Audio } from 'expo-av';
import io from 'socket.io-client';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from 'react-native-webrtc';

// ⚠️  CAMBIA QUESTO con l'IP del tuo server
const SIGNALING_SERVER_URL = 'http://192.168.1.100:3000';

const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const PALETTE = [
  '#f97316', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
  '#84cc16', '#14b8a6',
];

function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // Pre-join
  const [username, setUsername] = useState('Sala1');
  const [roomId, setRoomId] = useState('ristorante');
  const [serverConnected, setServerConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Avvio...');

  // Post-join
  const [users, setUsers] = useState([]);   // { socketId, username, color, isTalking, talkingTo }
  const [messages, setMessages] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState(null); // null=tutti | socketId
  const [chatInput, setChatInput] = useState('');
  const [isTalking, setIsTalking] = useState(false);

  const socketRef = useRef(null);
  const mySocketIdRef = useRef(null);
  const myColorRef = useRef('#06b6d4');
  const peersRef = useRef(new Map());       // socketId -> RTCPeerConnection
  const localStreamRef = useRef(null);
  const scrollRef = useRef(null);
  // keep selectedTarget accessible in callbacks without stale closure
  const selectedTargetRef = useRef(null);

  useEffect(() => {
    selectedTargetRef.current = selectedTarget;
  }, [selectedTarget]);

  useEffect(() => {
    init();
    return () => cleanup();
  }, []);

  // ── Audio ──────────────────────────────────────────────────────
  const init = async () => {
    await configureAudio();
    connectSocket();
  };

  const configureAudio = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
    } catch (err) {
      console.error('configureAudio', err);
    }
  };

  // ── WebRTC helpers ─────────────────────────────────────────────
  const getLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getAudioTracks().forEach((t) => { t.enabled = false; });
    localStreamRef.current = stream;
    return stream;
  };

  const createPeerConnection = async (socketId) => {
    if (peersRef.current.has(socketId)) return peersRef.current.get(socketId);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    const stream = await getLocalStream();
    stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { to: socketId, candidate: e.candidate });
      }
    };

    pc.ontrack = () => {};

    pc.onconnectionstatechange = () => refreshStatus();

    peersRef.current.set(socketId, pc);
    return pc;
  };

  const sendOffer = async (socketId) => {
    try {
      const pc = await createPeerConnection(socketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('offer', { to: socketId, sdp: offer });
    } catch (err) {
      console.error('sendOffer', err);
    }
  };

  const closePeer = (socketId) => {
    const pc = peersRef.current.get(socketId);
    if (pc) { try { pc.close(); } catch (_) {} peersRef.current.delete(socketId); }
    setUsers((prev) => prev.filter((u) => u.socketId !== socketId));
    if (selectedTargetRef.current === socketId) setSelectedTarget(null);
    refreshStatus();
  };

  const destroyAllPeers = () => {
    peersRef.current.forEach((pc) => { try { pc.close(); } catch (_) {} });
    peersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  };

  const refreshStatus = () => {
    const count = peersRef.current.size;
    if (count === 0) { setStatus('In attesa di altri dispositivi'); return; }
    const connected = [...peersRef.current.values()].filter(
      (pc) => pc.connectionState === 'connected'
    ).length;
    setStatus(`${connected}/${count} connessi`);
  };

  // ── Messages ───────────────────────────────────────────────────
  const addMessage = (msg) => {
    setMessages((prev) => [...prev, { id: Date.now() + Math.random(), ...msg }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  // ── Socket ─────────────────────────────────────────────────────
  const connectSocket = () => {
    const socket = io(SIGNALING_SERVER_URL, { transports: ['websocket'], reconnection: true });

    socket.on('connect', () => {
      mySocketIdRef.current = socket.id;
      setServerConnected(true);
      setStatus('Connesso al server');
    });

    socket.on('disconnect', () => {
      setServerConnected(false);
      setJoined(false);
      setUsers([]);
      setStatus('Server disconnesso');
      destroyAllPeers();
    });

    // Lista utenti già in stanza → questo dispositivo manda offer a tutti
    socket.on('room-users', async ({ users: roomUsers }) => {
      const others = roomUsers.filter((u) => u.socketId !== socket.id);
      setUsers(others.map((u) => ({
        ...u, color: colorForName(u.username), isTalking: false, talkingTo: null,
      })));
      for (const u of others) await sendOffer(u.socketId);
      setStatus(others.length === 0 ? 'In attesa di altri dispositivi' : `Collegamento con ${others.length} dispositivo/i...`);
    });

    // Nuovo utente entrato → preparo la PC, aspetto il suo offer
    socket.on('user-joined', async ({ socketId, username: uname }) => {
      setUsers((prev) => [
        ...prev.filter((u) => u.socketId !== socketId),
        { socketId, username: uname, color: colorForName(uname), isTalking: false, talkingTo: null },
      ]);
      await createPeerConnection(socketId);
      addMessage({ type: 'system', text: `${uname} è entrato`, timestamp: Date.now() });
    });

    socket.on('offer', async ({ from, sdp }) => {
      try {
        const pc = await createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, sdp: answer });
      } catch (err) { console.error('offer', err); }
    });

    socket.on('answer', async ({ from, sdp }) => {
      try {
        const pc = peersRef.current.get(from);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (err) { console.error('answer', err); }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      try {
        const pc = peersRef.current.get(from);
        if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) { console.error('ice', err); }
    });

    socket.on('user-left', ({ socketId, username: uname }) => {
      closePeer(socketId);
      addMessage({ type: 'system', text: `${uname || 'Un utente'} ha lasciato la stanza`, timestamp: Date.now() });
    });

    // ── Messaggi di testo ──────────────────────────────────────
    socket.on('group-message', ({ from, username: uname, text, timestamp }) => {
      addMessage({
        type: 'msg', from, fromName: uname, fromColor: colorForName(uname),
        to: 'all', text, timestamp, isMine: false,
      });
    });

    socket.on('direct-message', ({ from, username: uname, text, timestamp }) => {
      addMessage({
        type: 'msg', from, fromName: uname, fromColor: colorForName(uname),
        to: socket.id, text, timestamp, isMine: false, isDirect: true,
      });
    });

    // ── Indicatori PTT ─────────────────────────────────────────
    socket.on('talking-start', ({ from, to: talkingTo }) => {
      setUsers((prev) => prev.map((u) =>
        u.socketId === from ? { ...u, isTalking: true, talkingTo } : u
      ));
    });

    socket.on('talking-stop', ({ from }) => {
      setUsers((prev) => prev.map((u) =>
        u.socketId === from ? { ...u, isTalking: false, talkingTo: null } : u
      ));
    });

    socketRef.current = socket;
  };

  // ── Actions ────────────────────────────────────────────────────
  const joinRoom = () => {
    if (!username.trim() || !roomId.trim()) {
      Alert.alert('Errore', 'Inserisci nome e stanza');
      return;
    }
    if (!socketRef.current || !serverConnected) {
      Alert.alert('Errore', 'Server non raggiungibile');
      return;
    }
    myColorRef.current = colorForName(username.trim());
    socketRef.current.emit('join-room', { username: username.trim(), roomId: roomId.trim() });
    setJoined(true);
    setStatus('Entrato in stanza...');
  };

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text || !socketRef.current) return;
    const timestamp = Date.now();

    if (selectedTarget) {
      const targetUser = users.find((u) => u.socketId === selectedTarget);
      socketRef.current.emit('direct-message', { to: selectedTarget, text });
      addMessage({
        type: 'msg', from: mySocketIdRef.current, fromName: username,
        fromColor: myColorRef.current, to: selectedTarget,
        toName: targetUser?.username, text, timestamp, isMine: true, isDirect: true,
      });
    } else {
      socketRef.current.emit('group-message', { text });
      addMessage({
        type: 'msg', from: mySocketIdRef.current, fromName: username,
        fromColor: myColorRef.current, to: 'all', text, timestamp, isMine: true,
      });
    }
    setChatInput('');
  };

  const startTalking = () => {
    if (!joined || !localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
    setIsTalking(true);
    socketRef.current?.emit('talking-start', { to: selectedTargetRef.current });
  };

  const stopTalking = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
    setIsTalking(false);
    socketRef.current?.emit('talking-stop', {});
  };

  const cleanup = () => {
    destroyAllPeers();
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
  };

  // ── Derived ────────────────────────────────────────────────────
  const targetUser = users.find((u) => u.socketId === selectedTarget);
  const pttColor = isTalking ? '#dc2626' : (selectedTarget ? '#2563eb' : '#16a34a');
  const activeTalkers = users.filter((u) => u.isTalking);

  // ══════════════════════════════════════════════════════════════
  // PRE-JOIN SCREEN
  // ══════════════════════════════════════════════════════════════
  if (!joined) {
    return (
      <SafeAreaView style={s.container}>
        <StatusBar barStyle="light-content" />
        <View style={s.loginCard}>
          <View style={[s.avatarLg, { backgroundColor: colorForName(username || '?') }]}>
            <Text style={s.avatarLgText}>{initials(username || '?')}</Text>
          </View>
          <Text style={s.title}>Walkie Talkie</Text>
          <Text style={s.subtitle}>Push-to-talk · messaggi · profili</Text>

          <TextInput
            style={s.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Il tuo nome"
            placeholderTextColor="#94a3b8"
            maxLength={20}
          />
          <TextInput
            style={s.input}
            value={roomId}
            onChangeText={setRoomId}
            placeholder="Stanza / canale"
            placeholderTextColor="#94a3b8"
            maxLength={30}
          />

          <TouchableOpacity
            style={[s.joinButton, !serverConnected && s.disabled]}
            onPress={joinRoom}
            disabled={!serverConnected}
          >
            <Text style={s.joinButtonText}>
              {serverConnected ? 'Entra nella stanza' : 'Connessione al server...'}
            </Text>
          </TouchableOpacity>

          <Text style={s.statusSmall}>{status}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // POST-JOIN SCREEN
  // ══════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── Header / profilo ───────────────────────────────── */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={[s.avatarSm, { backgroundColor: myColorRef.current }]}>
              <Text style={s.avatarSmText}>{initials(username)}</Text>
            </View>
            <View>
              <Text style={s.headerName}>{username}</Text>
              <Text style={s.headerRoom}>#{roomId}</Text>
            </View>
          </View>
          <Text style={s.headerStatus}>{status}</Text>
        </View>

        {/* ── Selettore destinatario ─────────────────────────── */}
        <View style={s.targetBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.targetScroll}>
            {/* chip "Tutti" */}
            <TouchableOpacity
              style={[s.chip, !selectedTarget && s.chipActive]}
              onPress={() => setSelectedTarget(null)}
            >
              <Text style={[s.chipText, !selectedTarget && s.chipTextActive]}>Tutti</Text>
            </TouchableOpacity>

            {users.map((u) => (
              <TouchableOpacity
                key={u.socketId}
                style={[s.chip, selectedTarget === u.socketId && s.chipActive, { borderColor: u.color }]}
                onPress={() => setSelectedTarget((t) => (t === u.socketId ? null : u.socketId))}
              >
                <View style={[s.chipDot, { backgroundColor: u.color }]} />
                <Text style={[s.chipText, selectedTarget === u.socketId && s.chipTextActive]}>
                  {u.username}
                </Text>
                {/* pallino animato se sta parlando */}
                {u.isTalking && <View style={s.talkingPulse} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* ── Feed messaggi ─────────────────────────────────────── */}
        <ScrollView ref={scrollRef} style={s.feed} contentContainerStyle={s.feedContent}>
          {messages.length === 0 && (
            <Text style={s.emptyFeed}>Nessun messaggio ancora{'\n'}Premi PTT per parlare</Text>
          )}
          {messages.map((msg) => {
            if (msg.type === 'system') {
              return (
                <Text key={msg.id} style={s.systemMsg}>{msg.text}</Text>
              );
            }
            const isMe = msg.isMine;
            return (
              <View key={msg.id} style={[s.msgRow, isMe && s.msgRowMe]}>
                {!isMe && (
                  <View style={[s.msgAvatar, { backgroundColor: msg.fromColor }]}>
                    <Text style={s.msgAvatarText}>{initials(msg.fromName)}</Text>
                  </View>
                )}
                <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleOther]}>
                  {!isMe && (
                    <Text style={[s.bubbleSender, { color: msg.fromColor }]}>{msg.fromName}</Text>
                  )}
                  {msg.isDirect && (
                    <View style={s.dmBadge}>
                      <Text style={s.dmBadgeText}>
                        {isMe ? `DM → ${msg.toName}` : 'DM → te'}
                      </Text>
                    </View>
                  )}
                  <Text style={s.bubbleText}>{msg.text}</Text>
                  <Text style={s.bubbleTime}>{formatTime(msg.timestamp)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {/* ── Banner chi sta parlando ────────────────────────── */}
        {activeTalkers.length > 0 && (
          <View style={s.talkingBar}>
            {activeTalkers.map((u) => {
              const toLabel = u.talkingTo
                ? (users.find((x) => x.socketId === u.talkingTo)?.username ?? 'qualcuno')
                : 'tutti';
              return (
                <Text key={u.socketId} style={[s.talkingLabel, { color: u.color }]}>
                  {u.username} → {toLabel}
                </Text>
              );
            })}
          </View>
        )}

        {/* ── Input testo ───────────────────────────────────── */}
        <View style={s.chatRow}>
          <TextInput
            style={s.chatInput}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={
              selectedTarget
                ? `Messaggio a ${targetUser?.username ?? ''}...`
                : 'Messaggio al gruppo...'
            }
            placeholderTextColor="#94a3b8"
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[s.sendBtn, !chatInput.trim() && s.disabled]}
            onPress={sendMessage}
            disabled={!chatInput.trim()}
          >
            <Text style={s.sendBtnText}>→</Text>
          </TouchableOpacity>
        </View>

        {/* ── PTT Button ────────────────────────────────────── */}
        <View style={s.pttArea}>
          {selectedTarget && (
            <Text style={s.pttTargetLabel}>PTT diretto → {targetUser?.username}</Text>
          )}
          <TouchableOpacity
            style={[s.pttButton, { backgroundColor: pttColor }]}
            onPressIn={startTalking}
            onPressOut={stopTalking}
            activeOpacity={0.85}
          >
            <Text style={s.pttText}>
              {isTalking
                ? 'PARLI ORA'
                : selectedTarget
                ? 'PTT DIRETTO'
                : 'PTT GRUPPO'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },

  // ── Pre-join ──────────────────────────────────────────────────
  loginCard: {
    margin: 24,
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    elevation: 6,
  },
  avatarLg: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  avatarLgText: { color: '#fff', fontSize: 26, fontWeight: '800' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: '#94a3b8', fontSize: 13, marginBottom: 20, textAlign: 'center' },
  input: {
    width: '100%', backgroundColor: '#334155', color: '#fff',
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, marginBottom: 12, fontSize: 16,
  },
  joinButton: {
    width: '100%', backgroundColor: '#2563eb',
    paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 12,
  },
  joinButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  statusSmall: { color: '#64748b', fontSize: 12 },
  disabled: { opacity: 0.45 },

  // ── Post-join header ──────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1e293b',
    borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarSm: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSmText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  headerName: { color: '#fff', fontWeight: '700', fontSize: 15 },
  headerRoom: { color: '#64748b', fontSize: 12 },
  headerStatus: { color: '#38bdf8', fontSize: 12, fontWeight: '600' },

  // ── Target selector ───────────────────────────────────────────
  targetBar: {
    backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  targetScroll: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, borderWidth: 1.5, borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  chipActive: { backgroundColor: '#1e3a5f', borderColor: '#3b82f6' },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  talkingPulse: {
    width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22c55e',
    marginLeft: 2,
  },

  // ── Messages feed ─────────────────────────────────────────────
  feed: { flex: 1 },
  feedContent: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  emptyFeed: {
    color: '#475569', textAlign: 'center', marginTop: 40, fontSize: 14, lineHeight: 22,
  },
  systemMsg: {
    color: '#475569', textAlign: 'center', fontSize: 12, marginVertical: 4,
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAvatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  msgAvatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  bubble: {
    maxWidth: '75%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8,
  },
  bubbleOther: { backgroundColor: '#1e293b', borderBottomLeftRadius: 4 },
  bubbleMe: { backgroundColor: '#1d4ed8', borderBottomRightRadius: 4 },
  bubbleSender: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  bubbleText: { color: '#fff', fontSize: 15 },
  bubbleTime: { color: 'rgba(255,255,255,0.45)', fontSize: 10, marginTop: 3, textAlign: 'right' },
  dmBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4, alignSelf: 'flex-start',
  },
  dmBadgeText: { color: '#e2e8f0', fontSize: 10, fontWeight: '700' },

  // ── Talking banner ────────────────────────────────────────────
  talkingBar: {
    backgroundColor: '#0f2d1a', paddingHorizontal: 16, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: '#166534',
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  talkingLabel: { fontSize: 12, fontWeight: '700' },

  // ── Chat input ────────────────────────────────────────────────
  chatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#1e293b', borderTopWidth: 1, borderTopColor: '#334155',
  },
  chatInput: {
    flex: 1, backgroundColor: '#0f172a', color: '#fff',
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, fontSize: 15,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },

  // ── PTT ───────────────────────────────────────────────────────
  pttArea: {
    alignItems: 'center', paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16,
    backgroundColor: '#1e293b',
  },
  pttTargetLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: '600' },
  pttButton: {
    width: '100%', height: 72, borderRadius: 999,
    alignItems: 'center', justifyContent: 'center',
  },
  pttText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 1 },
});
