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

export default function App() {
  const [username, setUsername] = useState('Sala1');
  const [roomId, setRoomId] = useState('ristorante');
  const [serverConnected, setServerConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Avvio...');
  const [isTalking, setIsTalking] = useState(false);
  const [peerCount, setPeerCount] = useState(0);

  const socketRef = useRef(null);
  // Map: socketId -> RTCPeerConnection
  const peersRef = useRef(new Map());
  // Map: socketId -> username (for display)
  const usersRef = useRef(new Map());
  const localStreamRef = useRef(null);

  useEffect(() => {
    init();
    return () => cleanup();
  }, []);

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
      setStatus('Audio pronto');
    } catch (err) {
      console.error(err);
      setStatus('Errore configurazione audio');
    }
  };

  // Crea o restituisce lo stream locale (chiamato una sola volta)
  const getLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = false; // silenzioso finché non si preme PTT
    });
    localStreamRef.current = stream;
    return stream;
  };

  // Crea una peer connection verso un dispositivo specifico
  const createPeerConnection = async (socketId) => {
    if (peersRef.current.has(socketId)) return peersRef.current.get(socketId);

    const pc = new RTCPeerConnection(ICE_CONFIG);
    const stream = await getLocalStream();

    // Aggiunge le tracce audio locali a questa peer connection
    stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          to: socketId,
          candidate: event.candidate,
        });
      }
    };

    // Con react-native-webrtc l'audio remoto parte automaticamente
    pc.ontrack = () => {};

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`Peer ${socketId} state: ${state}`);
      updateStatusFromPeers();
    };

    peersRef.current.set(socketId, pc);
    return pc;
  };

  // Crea e invia un offer verso socketId
  const sendOffer = async (socketId) => {
    try {
      const pc = await createPeerConnection(socketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current.emit('offer', { to: socketId, sdp: offer });
    } catch (err) {
      console.error('sendOffer error', err);
    }
  };

  // Chiude e rimuove la peer connection verso socketId
  const closePeer = (socketId) => {
    const pc = peersRef.current.get(socketId);
    if (pc) {
      pc.close();
      peersRef.current.delete(socketId);
    }
    usersRef.current.delete(socketId);
    setPeerCount(peersRef.current.size);
    updateStatusFromPeers();
  };

  const updateStatusFromPeers = () => {
    const count = peersRef.current.size;
    setPeerCount(count);
    if (count === 0) {
      setStatus('In attesa di altri dispositivi');
    } else {
      const connected = [...peersRef.current.values()].filter(
        (pc) => pc.connectionState === 'connected'
      ).length;
      setStatus(`${connected}/${count} dispositivi connessi`);
    }
  };

  const connectSocket = () => {
    const socket = io(SIGNALING_SERVER_URL, {
      transports: ['websocket'],
      reconnection: true,
    });

    socket.on('connect', () => {
      setServerConnected(true);
      setStatus('Connesso al server');
    });

    socket.on('disconnect', () => {
      setServerConnected(false);
      setJoined(false);
      setStatus('Server disconnesso');
      destroyAllPeers();
    });

    // Ricevuto all'ingresso: lista di tutti gli utenti già in stanza
    // Questo dispositivo (il nuovo) crea l'offer verso ognuno
    socket.on('room-users', async ({ users }) => {
      const others = users.filter((u) => u.socketId !== socket.id);
      if (others.length === 0) {
        setStatus('In attesa di altri dispositivi');
        return;
      }
      for (const user of others) {
        usersRef.current.set(user.socketId, user.username);
        await sendOffer(user.socketId);
      }
      setPeerCount(others.length);
      setStatus(`Collegamento con ${others.length} dispositivo/i...`);
    });

    // Un nuovo dispositivo è entrato: prepara la peer connection
    // (attendi il suo offer, non mandare tu)
    socket.on('user-joined', async ({ socketId, username }) => {
      usersRef.current.set(socketId, username);
      await createPeerConnection(socketId);
      setPeerCount(peersRef.current.size);
      setStatus(`${username} è entrato`);
    });

    // Ricevuto offer da un peer: rispondi con answer
    socket.on('offer', async ({ from, sdp }) => {
      try {
        const pc = await createPeerConnection(from);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, sdp: answer });
        updateStatusFromPeers();
      } catch (err) {
        console.error('offer error', err);
      }
    });

    // Ricevuto answer al nostro offer
    socket.on('answer', async ({ from, sdp }) => {
      try {
        const pc = peersRef.current.get(from);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        updateStatusFromPeers();
      } catch (err) {
        console.error('answer error', err);
      }
    });

    // Candidato ICE da un peer specifico
    socket.on('ice-candidate', async ({ from, candidate }) => {
      try {
        const pc = peersRef.current.get(from);
        if (!pc || !candidate) return;
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('ice error', err);
      }
    });

    // Un dispositivo è uscito: chiudi solo quella connessione
    socket.on('user-left', ({ socketId, username }) => {
      closePeer(socketId);
      const name = username || 'Un dispositivo';
      setStatus(`${name} è uscito`);
    });

    socketRef.current = socket;
  };

  const joinRoom = async () => {
    if (!username.trim() || !roomId.trim()) {
      Alert.alert('Errore', 'Inserisci nome e stanza');
      return;
    }
    if (!socketRef.current || !serverConnected) {
      Alert.alert('Errore', 'Server non raggiungibile');
      return;
    }
    socketRef.current.emit('join-room', {
      username: username.trim(),
      roomId: roomId.trim(),
    });
    setJoined(true);
    setStatus('Entrato in stanza...');
  };

  const startTalking = () => {
    if (!joined || !localStreamRef.current) return;
    // Abilitare la traccia la rende attiva su tutte le peer connections
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    setIsTalking(true);
    setStatus('Stai trasmettendo');
  };

  const stopTalking = () => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setIsTalking(false);
    updateStatusFromPeers();
  };

  const destroyAllPeers = () => {
    peersRef.current.forEach((pc) => {
      try { pc.close(); } catch (_) {}
    });
    peersRef.current.clear();
    usersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setPeerCount(0);
  };

  const cleanup = () => {
    destroyAllPeers();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.card}>
        <Text style={styles.title}>Walkie Talkie</Text>
        <Text style={styles.subtitle}>Push-to-talk · fino a 10 dispositivi</Text>

        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Nome dispositivo"
          placeholderTextColor="#94a3b8"
          editable={!joined}
        />

        <TextInput
          style={styles.input}
          value={roomId}
          onChangeText={setRoomId}
          placeholder="Stanza / canale"
          placeholderTextColor="#94a3b8"
          editable={!joined}
        />

        <TouchableOpacity
          style={[styles.joinButton, (!serverConnected || joined) && styles.disabled]}
          onPress={joinRoom}
          disabled={!serverConnected || joined}
        >
          <Text style={styles.joinButtonText}>
            {joined ? 'Connesso alla stanza' : 'Entra nella stanza'}
          </Text>
        </TouchableOpacity>

        <View style={styles.statusBox}>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Stato</Text>
            {joined && (
              <Text style={styles.peerBadge}>
                {peerCount} {peerCount === 1 ? 'dispositivo' : 'dispositivi'}
              </Text>
            )}
          </View>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        <TouchableOpacity
          style={[
            styles.pttButton,
            isTalking && styles.pttButtonActive,
            !joined && styles.disabled,
          ]}
          onPressIn={startTalking}
          onPressOut={stopTalking}
          disabled={!joined}
        >
          <Text style={styles.pttText}>
            {isTalking ? 'PARLI ORA' : 'TIENI PREMUTO\nPER PARLARE'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.info}>
          La voce viene trasmessa a tutti i dispositivi nella stessa stanza simultaneamente.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#cbd5e1',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#334155',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 12,
    fontSize: 16,
  },
  joinButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  statusBox: {
    backgroundColor: '#0b1220',
    padding: 14,
    borderRadius: 14,
    marginBottom: 18,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  peerBadge: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  statusText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  pttButton: {
    height: 130,
    borderRadius: 999,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pttButtonActive: {
    backgroundColor: '#dc2626',
  },
  pttText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  info: {
    color: '#cbd5e1',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 13,
  },
  disabled: {
    opacity: 0.5,
  },
});
