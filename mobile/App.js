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

  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const otherPeerIdRef = useRef(null);

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
      destroyPeer();
    });

    socket.on('room-users', async ({ users }) => {
      const others = users.filter((u) => u.socketId !== socket.id);
      if (others.length > 0) {
        otherPeerIdRef.current = others[0].socketId;
        await ensurePeerConnection();
        await createOffer();
        setStatus(`Collegamento con ${others[0].username}...`);
      } else {
        setStatus('In attesa di un altro dispositivo');
      }
    });

    socket.on('user-joined', async ({ socketId, username }) => {
      otherPeerIdRef.current = socketId;
      await ensurePeerConnection();
      setStatus(`${username} è entrato`);
    });

    socket.on('offer', async ({ from, sdp }) => {
      try {
        otherPeerIdRef.current = from;
        await ensurePeerConnection();
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peerRef.current.createAnswer();
        await peerRef.current.setLocalDescription(answer);
        socket.emit('answer', { to: from, sdp: answer });
        setStatus('Canale audio attivo');
      } catch (err) {
        console.error('offer error', err);
      }
    });

    socket.on('answer', async ({ sdp }) => {
      try {
        if (!peerRef.current) return;
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        setStatus('Canale audio attivo');
      } catch (err) {
        console.error('answer error', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        if (!peerRef.current || !candidate) return;
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('ice error', err);
      }
    });

    socket.on('user-left', () => {
      setStatus("L'altro utente è uscito");
      otherPeerIdRef.current = null;
      destroyPeer();
    });

    socketRef.current = socket;
  };

  const ensurePeerConnection = async () => {
    if (peerRef.current) return;

    const pc = new RTCPeerConnection(ICE_CONFIG);

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    stream.getAudioTracks().forEach((track) => {
      track.enabled = false;
      pc.addTrack(track, stream);
    });

    localStreamRef.current = stream;

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current && otherPeerIdRef.current) {
        socketRef.current.emit('ice-candidate', {
          to: otherPeerIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      setStatus('Ricezione audio attiva');
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') setStatus('Pronto');
      if (state === 'connecting') setStatus('Connessione in corso');
      if (state === 'disconnected') setStatus('Connessione persa');
      if (state === 'failed') setStatus('Connessione fallita');
    };

    peerRef.current = pc;
  };

  const createOffer = async () => {
    try {
      if (!peerRef.current || !otherPeerIdRef.current || !socketRef.current) return;
      const offer = await peerRef.current.createOffer();
      await peerRef.current.setLocalDescription(offer);
      socketRef.current.emit('offer', {
        to: otherPeerIdRef.current,
        sdp: offer,
      });
    } catch (err) {
      console.error('createOffer error', err);
    }
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
    setStatus(`Entrato in ${roomId}`);
  };

  const startTalking = () => {
    if (!joined) return;
    if (!localStreamRef.current) {
      Alert.alert('Attendi', 'Connessione audio non pronta');
      return;
    }

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
    setStatus('Pronto');
  };

  const destroyPeer = () => {
    try {
      if (peerRef.current) {
        peerRef.current.close();
        peerRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      remoteStreamRef.current = null;
    } catch (err) {
      console.error('destroyPeer error', err);
    }
  };

  const cleanup = () => {
    destroyPeer();
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
        <Text style={styles.subtitle}>Push-to-talk per smartphone</Text>

        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="Nome dispositivo"
          placeholderTextColor="#94a3b8"
        />

        <TextInput
          style={styles.input}
          value={roomId}
          onChangeText={setRoomId}
          placeholder="Stanza / canale"
          placeholderTextColor="#94a3b8"
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
          <Text style={styles.statusLabel}>Stato</Text>
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
            {isTalking ? 'PARLI ORA' : 'TIENI PREMUTO PER PARLARE'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.info}>
          Gli auricolari Bluetooth vengono normalmente gestiti dal sistema audio di Android/iPhone.
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
  statusLabel: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 4,
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
