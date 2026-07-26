"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stage = "lobby" | "matching" | "battle" | "results" | "leaderboard";
type RoundPhase = "connecting" | "ready" | "countdown" | "barking" | "judging";
type ConnectionState = "idle" | "connecting" | "connected" | "recovering" | "failed";

type Prompt = {
  title: string;
  cue: string;
  emoji: string;
  judge: string;
  color: string;
  weights: [number, number, number];
};

type Score = {
  total: number;
  power: number;
  control: number;
  character: number;
};

type Room = {
  id: string;
  role: "offerer" | "answerer";
  promptIndex: number;
  status: string;
  ready: boolean;
  rivalReady: boolean;
  startsAt: number | null;
  score: Score | null;
  rivalScore: Score | null;
  rival: { name: string; rating: number };
  rating: number;
};

type ArenaSignal = {
  id: number;
  payload:
    | { type: "offer" | "answer"; sdp: string }
    | { type: "candidate"; candidate: RTCIceCandidateInit }
    | null;
};

type Leader = {
  name: string;
  rating: number;
  wins: number;
  losses: number;
};

const prompts: Prompt[] = [
  {
    title: "The Joy Bark",
    cue: "Your human just came home after 100 years.",
    emoji: "🥹",
    judge: "Bright tone · rising energy · pure joy",
    color: "#ffcc4d",
    weights: [0.35, 0.2, 0.45],
  },
  {
    title: "Tiny But Terrifying",
    cue: "You weigh six pounds. Act like you own the block.",
    emoji: "😤",
    judge: "Big power · sharp attacks · no hesitation",
    color: "#ff735c",
    weights: [0.55, 0.25, 0.2],
  },
  {
    title: "The Dramatic Whimper",
    cue: "Dinner is seventeen seconds late. Devastating.",
    emoji: "🥺",
    judge: "Dynamic range · restraint · emotional damage",
    color: "#b69cff",
    weights: [0.15, 0.4, 0.45],
  },
  {
    title: "Moonlight Howl",
    cue: "Call the whole pack. Make it cinematic.",
    emoji: "🌕",
    judge: "Sustain · smooth tone · legendary finish",
    color: "#79d8ff",
    weights: [0.4, 0.4, 0.2],
  },
  {
    title: "Rapid-Fire Yaps",
    cue: "The mail carrier has entered your jurisdiction.",
    emoji: "📦",
    judge: "Fast attacks · rhythm · maximum urgency",
    color: "#b8ec57",
    weights: [0.3, 0.25, 0.45],
  },
  {
    title: "The Sneaky Boof",
    cue: "You heard something downstairs. Probably a sock.",
    emoji: "🕵️",
    judge: "Quiet control · suspense · one perfect boof",
    color: "#f4a4e3",
    weights: [0.15, 0.55, 0.3],
  },
];

const showcaseLeaders = [
  { name: "Sir Barksalot", rating: 1842, wins: 94, losses: 21 },
  { name: "Luna", rating: 1796, wins: 81, losses: 19 },
  { name: "Cheddar", rating: 1731, wins: 77, losses: 26 },
  { name: "Tofu", rating: 1689, wins: 69, losses: 24 },
  { name: "Biggie Paws", rating: 1654, wins: 62, losses: 28 },
];

const dogFaces = ["🐕‍🦺", "🐺", "🦮", "🐶", "🐕", "🐩", "🐾"];
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

async function arenaPost(body: Record<string, unknown>) {
  const result = await fetch("/api/arena", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await result.json();
  if (!result.ok) throw new Error(payload.error ?? "The arena is unavailable.");
  return payload;
}

function Waveform({ values, active, color }: { values: number[]; active: boolean; color: string }) {
  const bars = values.length
    ? values.slice(-36)
    : Array.from({ length: 36 }, (_, index) => 10 + ((index * 13) % 26));
  return (
    <div className={`waveform ${active ? "waveform--active" : ""}`} aria-hidden="true">
      {bars.map((value, index) => (
        <span
          key={index}
          style={{
            height: `${clamp(value, 8, 96)}%`,
            backgroundColor: active ? color : "rgba(255,255,255,.24)",
          }}
        />
      ))}
    </div>
  );
}

function PawMark() {
  return (
    <span className="paw-mark" aria-hidden="true">
      <i /><i /><i /><i /><b />
    </span>
  );
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("lobby");
  const [roundPhase, setRoundPhase] = useState<RoundPhase>("connecting");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [room, setRoom] = useState<Room | null>(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [countdown, setCountdown] = useState(3);
  const [micReady, setMicReady] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [mediaNote, setMediaNote] = useState("Camera + mic check happens when you enter.");
  const [arenaNote, setArenaNote] = useState("Ready to meet the pack.");
  const [error, setError] = useState("");
  const [wave, setWave] = useState<number[]>([]);
  const [opponentWave, setOpponentWave] = useState<number[]>([]);
  const [score, setScore] = useState<Score | null>(null);
  const [rivalScore, setRivalScore] = useState<Score | null>(null);
  const [rating, setRating] = useState(1200);
  const [record, setRecord] = useState({ wins: 0, losses: 0 });
  const [displayName, setDisplayName] = useState("Anonymous Pup");
  const [playerId, setPlayerId] = useState("");
  const [leaders, setLeaders] = useState<Leader[]>(showcaseLeaders);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const roomRef = useRef<Room | null>(null);
  const stageRef = useRef<Stage>("lobby");
  const contextRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const samplesRef = useRef<number[]>([]);
  const crossingsRef = useRef<number[]>([]);
  const lastSignalIdRef = useRef(0);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const scheduledStartRef = useRef<number | null>(null);
  const resultRecordedRef = useRef(false);
  const reconnectAttemptRef = useRef(false);

  const prompt = prompts[room?.promptIndex ?? 0];
  const rival = room?.rival ?? { name: "Mystery Pup", rating: 1200 };
  const totalMatches = record.wins + record.losses;
  const winRate = totalMatches ? Math.round((record.wins / totalMatches) * 100) : 0;
  const winner = Boolean(score && rivalScore && score.total >= rivalScore.total);
  const userRank = useMemo(
    () => Math.max(1, leaders.filter((leader) => leader.rating > rating).length + 1),
    [leaders, rating],
  );

  const setCurrentStage = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  useEffect(() => {
    const savedId = window.localStorage.getItem("barkoff-player-id");
    const savedName = window.localStorage.getItem("barkoff-name");
    const savedProfile = window.localStorage.getItem("barkoff-profile");
    const nextId = savedId || crypto.randomUUID();
    window.localStorage.setItem("barkoff-player-id", nextId);
    const profileTimer = window.setTimeout(() => {
      setPlayerId(nextId);
      if (savedName) setDisplayName(savedName);
      if (savedProfile) {
        try {
          const profile = JSON.parse(savedProfile) as { rating?: number; wins?: number; losses?: number };
          setRating(profile.rating ?? 1200);
          setRecord({ wins: profile.wins ?? 0, losses: profile.losses ?? 0 });
        } catch {
          // Keep a clean local profile.
        }
      }
    }, 0);

    const beforeUnload = () => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return;
      const body = new Blob(
        [JSON.stringify({ action: "leave", playerId: nextId, roomId: activeRoom.id })],
        { type: "application/json" },
      );
      navigator.sendBeacon("/api/arena", body);
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.clearTimeout(profileTimer);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  useEffect(() => {
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      void remoteVideoRef.current.play().catch(() => undefined);
    }
  }, [stage, micReady, remoteVideo]);

  useEffect(() => {
    if (stage !== "leaderboard") return;
    let cancelled = false;
    fetch("/api/arena?action=leaderboard", { cache: "no-store" })
      .then((result) => result.json())
      .then((payload: { players?: Leader[] }) => {
        if (!cancelled && payload.players?.length) setLeaders(payload.players);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stage]);

  const clearRoundTimers = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    if (startTimeoutRef.current) clearTimeout(startTimeoutRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    animationRef.current = null;
    timerRef.current = null;
    startTimeoutRef.current = null;
    countdownRef.current = null;
  }, []);

  const closePeer = useCallback(() => {
    clearRoundTimers();
    peerRef.current?.close();
    peerRef.current = null;
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current = null;
    localAnalyserRef.current = null;
    remoteAnalyserRef.current = null;
    pendingCandidatesRef.current = [];
    scheduledStartRef.current = null;
    lastSignalIdRef.current = 0;
    reconnectAttemptRef.current = false;
    setRemoteVideo(false);
    setConnectionState("idle");
  }, [clearRoundTimers]);

  const requestMedia = useCallback(async () => {
    if (streamRef.current) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaNote("This browser does not support camera and microphone access.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setMicReady(stream.getAudioTracks().length > 0);
      setHasVideo(stream.getVideoTracks().length > 0);
      setMediaNote("Camera + mic ready. Your media stays peer-to-peer.");
      return stream.getAudioTracks().length > 0;
    } catch {
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = audioOnly;
        setMicReady(true);
        setHasVideo(false);
        setMediaNote("Mic ready. Camera is off.");
        return true;
      } catch {
        setMediaNote("Camera or microphone access is required for an online bark-off.");
        return false;
      }
    }
  }, []);

  const sendSignal = useCallback(
    (activeRoom: Room, signal: Record<string, unknown>) =>
      arenaPost({
        action: "signal",
        playerId,
        roomId: activeRoom.id,
        signal,
      }),
    [playerId],
  );

  const createPeer = useCallback(
    async (activeRoom: Room) => {
      if (peerRef.current || !streamRef.current) return peerRef.current;
      setConnectionState("connecting");
      setArenaNote("Opening a secure peer-to-peer tunnel...");
      const peer = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.cloudflare.com:3478" },
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
        iceCandidatePoolSize: 10,
      });
      peerRef.current = peer;
      for (const track of streamRef.current.getTracks()) {
        peer.addTrack(track, streamRef.current);
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void sendSignal(activeRoom, {
          type: "candidate",
          candidate: event.candidate.toJSON(),
        }).catch(() => setArenaNote("Reconnecting signaling..."));
      };
      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        remoteStreamRef.current = stream;
        setRemoteVideo(true);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
          void remoteVideoRef.current.play().catch(() => undefined);
        }
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setConnectionState("connected");
          setArenaNote("Live peer-to-peer connection · End-to-end encrypted");
          reconnectAttemptRef.current = false;
        } else if (peer.connectionState === "disconnected") {
          setConnectionState("recovering");
          setArenaNote("Your rival’s connection is recovering...");
        } else if (peer.connectionState === "failed") {
          setConnectionState("failed");
          setArenaNote("Connection failed. Trying a fresh route...");
          if (!reconnectAttemptRef.current && activeRoom.role === "offerer") {
            reconnectAttemptRef.current = true;
            peer.restartIce();
            void peer
              .createOffer({ iceRestart: true })
              .then((offer) => peer.setLocalDescription(offer).then(() => offer))
              .then((offer) => sendSignal(activeRoom, { type: offer.type, sdp: offer.sdp ?? "" }))
              .catch(() => undefined);
          }
        }
      };

      if (activeRoom.role === "offerer") {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await sendSignal(activeRoom, { type: offer.type, sdp: offer.sdp ?? "" });
      }
      return peer;
    },
    [sendSignal],
  );

  const handleSignals = useCallback(
    async (activeRoom: Room, signals: ArenaSignal[]) => {
      const peer = (await createPeer(activeRoom)) ?? peerRef.current;
      if (!peer) return;
      for (const item of signals) {
        lastSignalIdRef.current = Math.max(lastSignalIdRef.current, item.id);
        const signal = item.payload;
        if (!signal) continue;
        try {
          if (signal.type === "offer") {
            if (peer.signalingState !== "stable") continue;
            await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
            for (const candidate of pendingCandidatesRef.current.splice(0)) {
              await peer.addIceCandidate(candidate);
            }
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            await sendSignal(activeRoom, { type: answer.type, sdp: answer.sdp ?? "" });
          } else if (signal.type === "answer") {
            if (peer.signalingState === "have-local-offer") {
              await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
              for (const candidate of pendingCandidatesRef.current.splice(0)) {
                await peer.addIceCandidate(candidate);
              }
            }
          } else if (signal.type === "candidate") {
            if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
            else pendingCandidatesRef.current.push(signal.candidate);
          }
        } catch {
          setArenaNote("Negotiating the best media route...");
        }
      }
    },
    [createPeer, sendSignal],
  );

  const calculateLocalScore = useCallback((): Score => {
    const samples = samplesRef.current;
    const crossings = crossingsRef.current;
    const average = samples.length
      ? samples.reduce((sum, value) => sum + value, 0) / samples.length
      : 0.04;
    const variance = samples.length
      ? samples.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / samples.length
      : 0;
    const max = samples.length ? Math.max(...samples) : 0.05;
    const crossingAverage = crossings.length
      ? crossings.reduce((sum, value) => sum + value, 0) / crossings.length
      : 0;
    const activePrompt = prompts[roomRef.current?.promptIndex ?? 0];
    const power = clamp(Math.round(38 + average * 62 + max * 22), 25, 99);
    const control = clamp(Math.round(96 - Math.sqrt(variance) * 72), 35, 99);
    const character = clamp(Math.round(46 + Math.sqrt(variance) * 122 + crossingAverage * 90), 30, 99);
    const [powerWeight, controlWeight, characterWeight] = activePrompt.weights;
    return {
      total: clamp(
        Math.round(power * powerWeight + control * controlWeight + character * characterWeight),
        30,
        99,
      ),
      power,
      control,
      character,
    };
  }, []);

  const stopRound = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    animationRef.current = null;
    timerRef.current = null;
    setRoundPhase("judging");
    setTimeLeft(0);
    const result = calculateLocalScore();
    setScore(result);
    const activeRoom = roomRef.current;
    if (activeRoom) {
      void arenaPost({
        action: "score",
        playerId,
        roomId: activeRoom.id,
        score: result,
      }).catch(() => setError("Your score is saved locally, but the judge is reconnecting."));
    }
  }, [calculateLocalScore, playerId]);

  const startSyncedRound = useCallback(() => {
    const stream = streamRef.current;
    const context = contextRef.current;
    if (!stream || !context) return;
    setRoundPhase("barking");
    setTimeLeft(10);
    setScore(null);
    setRivalScore(null);
    setWave([]);
    setOpponentWave([]);
    samplesRef.current = [];
    crossingsRef.current = [];

    const localSource = context.createMediaStreamSource(stream);
    const localAnalyser = context.createAnalyser();
    localAnalyser.fftSize = 1024;
    localAnalyser.smoothingTimeConstant = 0.42;
    localSource.connect(localAnalyser);
    localAnalyserRef.current = localAnalyser;

    if (remoteStreamRef.current) {
      const remoteSource = context.createMediaStreamSource(remoteStreamRef.current);
      const remoteAnalyser = context.createAnalyser();
      remoteAnalyser.fftSize = 512;
      remoteAnalyser.smoothingTimeConstant = 0.55;
      remoteSource.connect(remoteAnalyser);
      remoteAnalyserRef.current = remoteAnalyser;
    }

    const localData = new Uint8Array(localAnalyser.fftSize);
    const remoteData = new Uint8Array(remoteAnalyserRef.current?.fftSize ?? 512);
    const sample = () => {
      localAnalyser.getByteTimeDomainData(localData);
      let energy = 0;
      let zeroCrossings = 0;
      for (let index = 0; index < localData.length; index += 1) {
        const normalized = (localData[index] - 128) / 128;
        energy += normalized * normalized;
        if (index > 0 && (localData[index - 1] - 128) * (localData[index] - 128) < 0) {
          zeroCrossings += 1;
        }
      }
      const boosted = clamp(Math.sqrt(energy / localData.length) * 5.5, 0.01, 1);
      samplesRef.current.push(boosted);
      crossingsRef.current.push(zeroCrossings / localData.length);
      setWave((current) => [...current.slice(-35), 9 + boosted * 87]);

      const remoteAnalyser = remoteAnalyserRef.current;
      if (remoteAnalyser) {
        remoteAnalyser.getByteTimeDomainData(remoteData);
        let remoteEnergy = 0;
        for (const value of remoteData) remoteEnergy += Math.pow((value - 128) / 128, 2);
        const remoteLevel = clamp(Math.sqrt(remoteEnergy / remoteData.length) * 5.5, 0.01, 1);
        setOpponentWave((current) => [...current.slice(-35), 9 + remoteLevel * 87]);
      }
      animationRef.current = requestAnimationFrame(sample);
    };
    sample();

    const endsAt = Date.now() + 10_000;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) stopRound();
    }, 120);
  }, [stopRound]);

  const scheduleRound = useCallback(
    (startsAt: number) => {
      if (scheduledStartRef.current === startsAt) return;
      scheduledStartRef.current = startsAt;
      setRoundPhase("countdown");
      const updateCountdown = () =>
        setCountdown(Math.max(1, Math.ceil((startsAt - Date.now()) / 1000)));
      updateCountdown();
      countdownRef.current = setInterval(updateCountdown, 150);
      startTimeoutRef.current = setTimeout(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        startSyncedRound();
      }, Math.max(0, startsAt - Date.now()));
    },
    [startSyncedRound],
  );

  useEffect(() => {
    if ((stage !== "matching" && stage !== "battle") || !playerId) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const params = new URLSearchParams({
          playerId,
          after: String(lastSignalIdRef.current),
        });
        if (roomRef.current) params.set("roomId", roomRef.current.id);
        const result = await fetch(`/api/arena?${params}`, { cache: "no-store" });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error ?? "Matchmaking unavailable.");

        if (payload.state === "matched" && payload.room) {
          const nextRoom = payload.room as Room;
          roomRef.current = nextRoom;
          setRoom(nextRoom);
          setRating(nextRoom.rating);
          if (stageRef.current === "matching") {
            setCurrentStage("battle");
            setRoundPhase("connecting");
          }
          await handleSignals(nextRoom, (payload.signals ?? []) as ArenaSignal[]);
          if (nextRoom.startsAt) scheduleRound(nextRoom.startsAt);
          if (nextRoom.status === "abandoned") {
            setError(`${nextRoom.rival.name} left the arena. Find a new rival when you’re ready.`);
            closePeer();
            setCurrentStage("lobby");
          } else if (nextRoom.score && nextRoom.rivalScore) {
            setScore(nextRoom.score);
            setRivalScore(nextRoom.rivalScore);
            setRating(nextRoom.rating);
            if (!resultRecordedRef.current) {
              resultRecordedRef.current = true;
              setRecord((current) => {
                const won = nextRoom.score!.total >= nextRoom.rivalScore!.total;
                const updated = won
                  ? { ...current, wins: current.wins + 1 }
                  : { ...current, losses: current.losses + 1 };
                window.localStorage.setItem(
                  "barkoff-profile",
                  JSON.stringify({ rating: nextRoom.rating, ...updated }),
                );
                return updated;
              });
            }
            closePeer();
            setCurrentStage("results");
          }
        }
        setError("");
      } catch (caught) {
        setArenaNote(caught instanceof Error ? caught.message : "Reconnecting to the arena...");
      }
      if (!cancelled) pollTimer = setTimeout(poll, stageRef.current === "matching" ? 900 : 520);
    };
    void poll();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [
    stage,
    playerId,
    closePeer,
    handleSignals,
    scheduleRound,
    setCurrentStage,
  ]);

  const enterArena = async () => {
    setError("");
    if (!playerId) return;
    const mediaAvailable = await requestMedia();
    if (!mediaAvailable) {
      setError("Allow microphone access to join a real online bark-off.");
      return;
    }
    window.localStorage.setItem("barkoff-name", displayName.trim() || "Anonymous Pup");
    closePeer();
    setRoom(null);
    roomRef.current = null;
    setScore(null);
    setRivalScore(null);
    resultRecordedRef.current = false;
    lastSignalIdRef.current = 0;
    setArenaNote("Sniffing for a live rival...");
    setCurrentStage("matching");
    try {
      const payload = await arenaPost({
        action: "match",
        playerId,
        name: displayName,
        rating,
      });
      if (payload.state === "matched" && payload.room) {
        const matchedRoom = payload.room as Room;
        roomRef.current = matchedRoom;
        setRoom(matchedRoom);
        setCurrentStage("battle");
        await handleSignals(matchedRoom, (payload.signals ?? []) as ArenaSignal[]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not enter the arena.");
      setCurrentStage("lobby");
    }
  };

  const readyUp = async () => {
    const activeRoom = roomRef.current;
    if (!activeRoom || connectionState !== "connected") return;
    try {
      if (!contextRef.current) {
        const AudioContextClass =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        contextRef.current = new AudioContextClass();
      }
      await contextRef.current.resume();
      await arenaPost({
        action: "ready",
        playerId,
        roomId: activeRoom.id,
      });
      setRoom((current) => (current ? { ...current, ready: true } : current));
      setRoundPhase("ready");
      setArenaNote("You’re ready. Waiting for your rival’s paw...");
    } catch {
      setError("The judge missed that. Tap ready again.");
    }
  };

  const leaveArena = useCallback(
    async (showLobby = true) => {
      const activeRoom = roomRef.current;
      if (activeRoom) {
        void arenaPost({
          action: "leave",
          playerId,
          roomId: activeRoom.id,
        }).catch(() => undefined);
      }
      closePeer();
      roomRef.current = null;
      setRoom(null);
      if (showLobby) setCurrentStage("lobby");
    },
    [closePeer, playerId, setCurrentStage],
  );

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void contextRef.current?.close();
      closePeer();
    },
    [closePeer],
  );

  const findNewRival = async () => {
    await leaveArena(false);
    await enterArena();
  };

  const connectionCopy =
    connectionState === "connected"
      ? "LIVE P2P"
      : connectionState === "recovering"
        ? "RECOVERING"
        : connectionState === "failed"
          ? "RETRYING"
          : "CONNECTING";

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => void leaveArena()} aria-label="Barkoff home">
          <PawMark />
          <span>BARK<span className="brand-slant">OFF</span></span>
        </button>
        <nav aria-label="Main navigation">
          <button className={stage !== "leaderboard" ? "nav-active" : ""} onClick={() => void leaveArena()}>
            Arena
          </button>
          <button
            className={stage === "leaderboard" ? "nav-active" : ""}
            onClick={() => {
              void leaveArena(false);
              setCurrentStage("leaderboard");
            }}
          >
            Leaderboard
          </button>
        </nav>
        <div className="profile-pill">
          <span className="status-dot" />
          <span className="profile-copy"><small>YOUR ELO</small><strong>{rating}</strong></span>
          <span className="profile-dog">🐶</span>
        </div>
      </header>

      {stage === "lobby" && (
        <section className="lobby">
          {error && <div className="error-banner" role="alert"><span>!</span>{error}</div>}
          <div className="eyebrow"><span>LIVE</span> WORLDWIDE 1V1 MATCHMAKING</div>
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="kicker">THE INTERNET&apos;S #1 COMPETITIVE BARKING ARENA</p>
              <h1>PROVE YOU&apos;RE<br /><em>TOP DOG.</em></h1>
              <p className="hero-sub">
                Meet a real rival anywhere in the world. One prompt. Ten seconds. One top dog.
              </p>
              <label className="name-field">
                <span>YOUR BARK NAME</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value.slice(0, 24))}
                  maxLength={24}
                  autoComplete="nickname"
                  aria-label="Your Barkoff name"
                />
              </label>
              <div className="hero-actions">
                <button className="primary-button" onClick={enterArena}>
                  <span>FIND A LIVE RIVAL</span><b>→</b>
                </button>
                <span className="privacy-note"><span>●</span> Encrypted peer-to-peer media</span>
              </div>
            </div>
            <div className="arena-preview" aria-label="Barkoff online match preview">
              <div className="preview-sticker">LIVE HEAD-TO-HEAD</div>
              <div className="preview-player preview-player--one">
                <div className="dog-portrait dog-portrait--cream">🐶</div>
                <span>YOU</span>
              </div>
              <div className="versus-badge">VS</div>
              <div className="preview-player preview-player--two">
                <div className="dog-portrait dog-portrait--dark">🐕‍🦺</div>
                <span>THE WORLD</span>
              </div>
              <div className="prompt-ticket">
                <small>GLOBAL BARK SIGNAL</small>
                <strong>“THE DRAMATIC<br />WHIMPER”</strong>
                <span>🥺</span>
              </div>
              <div className="sound-lines sound-lines--left"><i /><i /><i /></div>
              <div className="sound-lines sound-lines--right"><i /><i /><i /></div>
            </div>
          </div>
          <div className="stats-strip">
            <div><strong>1V1</strong><span>REAL PEOPLE<br />REAL TIME</span></div>
            <div><strong>10</strong><span>SECONDS<br />TO BARK</span></div>
            <div><strong>P2P</strong><span>ENCRYPTED<br />VIDEO + AUDIO</span></div>
            <div><strong>{winRate}%</strong><span>YOUR<br />WIN RATE</span></div>
          </div>
          <div className="how-it-works">
            <span className="section-label">HOW IT WORKS</span>
            <div><b>01</b><strong>GET MATCHED</strong><p>A live rival joins you from anywhere in the world.</p></div>
            <div><b>02</b><strong>READY TOGETHER</strong><p>Both cameras connect and the same prompt appears.</p></div>
            <div><b>03</b><strong>BARK FOR GLORY</strong><p>Both performances are scored and Elo updates globally.</p></div>
          </div>
          <div className="hackathon-ribbon">BUILT FOR CORGI HACKS <span>✦</span> MAY THE BEST BARK WIN</div>
        </section>
      )}

      {stage === "matching" && (
        <section className="matching-screen">
          <div className="radar">
            <span className="radar-ring radar-ring--one" />
            <span className="radar-ring radar-ring--two" />
            <span className="radar-ring radar-ring--three" />
            <span className="radar-dog">🐶</span>
          </div>
          <p className="kicker">SNIFFING AROUND THE GLOBE...</p>
          <h2>FINDING A REAL<br /><em>WORTHY RIVAL</em></h2>
          <div className="match-progress"><span /></div>
          <p className="media-note">{arenaNote}</p>
          <p className="queue-tip">Keep this tab open · The next available pup will join automatically</p>
          <button className="cancel-match" onClick={() => void leaveArena()}>LEAVE THE QUEUE</button>
        </section>
      )}

      {stage === "battle" && room && (
        <section className="battle-screen">
          {error && <div className="error-banner" role="alert"><span>!</span>{error}</div>}
          <div className="battle-heading">
            <div>
              <span className="round-chip">ONLINE MATCH</span>
              <p>ROOM SECURED · {room.id.slice(0, 8).toUpperCase()}</p>
            </div>
            <div className={`timer ${roundPhase === "barking" ? "timer--live" : ""}`}>
              <span>{roundPhase === "countdown" ? countdown : timeLeft}</span>
              <small>{roundPhase === "countdown" ? "READY" : "SEC"}</small>
            </div>
            <div className={`judge-chip connection-chip connection-chip--${connectionState}`}>
              <span>●</span> {connectionCopy}
            </div>
          </div>

          <div className="prompt-card" style={{ "--prompt": prompt.color } as React.CSSProperties}>
            <div className="prompt-emoji">{prompt.emoji}</div>
            <div><small>SHARED BARK PROMPT</small><h2>{prompt.title}</h2><p>{prompt.cue}</p></div>
            <div className="judge-brief"><small>JUDGED ON</small><strong>{prompt.judge}</strong></div>
          </div>

          <div className="battle-grid">
            <article className="player-card player-card--you">
              <div className="video-frame">
                {micReady && hasVideo ? (
                  <video ref={localVideoRef} autoPlay muted playsInline aria-label="Your camera preview" />
                ) : (
                  <div className="video-fallback">🐶<small>{mediaNote}</small></div>
                )}
                <span className="player-tag">YOU · {rating} ELO</span>
                {roundPhase === "barking" && <span className="live-chip"><i /> BARKING</span>}
              </div>
              <Waveform values={wave} active={roundPhase === "barking"} color={prompt.color} />
              <div className="player-meta"><strong>{displayName || "YOU"}</strong><span>{room.ready ? "READY TO BARK" : "THE UNDERDOG"}</span></div>
            </article>

            <div className="battle-vs"><span>VS</span><i /></div>

            <article className="player-card player-card--rival">
              <div className="video-frame rival-frame">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={remoteVideo ? "remote-feed remote-feed--visible" : "remote-feed"}
                  aria-label={`${rival.name}'s live camera`}
                />
                {!remoteVideo && (
                  <div className="remote-placeholder">
                    <span>{connectionState === "failed" ? "📡" : "🐕"}</span>
                    <small>{arenaNote}</small>
                  </div>
                )}
                <span className="player-tag">LIVE RIVAL · {rival.rating} ELO</span>
                <span className="demo-chip live-peer-chip"><i /> REAL PLAYER</span>
              </div>
              <Waveform values={opponentWave} active={roundPhase === "barking"} color="#b8ec57" />
              <div className="player-meta"><strong>{rival.name}</strong><span>{room.rivalReady ? "READY TO BARK" : "GETTING READY"}</span></div>
            </article>
          </div>

          <div className="record-panel">
            {roundPhase === "connecting" && (
              <button className="bark-button bark-button--waiting" disabled>
                <span className="record-dot" /><strong>CONNECTING CAMERAS</strong><small>SECURE P2P HANDSHAKE</small>
              </button>
            )}
            {(roundPhase === "ready" || roundPhase === "connecting") &&
              connectionState === "connected" &&
              !room.ready && (
                <button className="bark-button" onClick={readyUp}>
                  <span className="bark-rings" /><PawMark /><strong>READY TO BARK</strong><small>ROUND STARTS WHEN BOTH READY</small>
                </button>
              )}
            {room.ready && !room.startsAt && (
              <div className="judging-state"><span>✦</span><strong>WAITING FOR {rival.name.toUpperCase()}...</strong></div>
            )}
            {roundPhase === "countdown" && (
              <div className="countdown-state"><strong>{countdown}</strong><span>GET READY TO BARK</span></div>
            )}
            {roundPhase === "barking" && (
              <div className="stop-button live-status">
                <span className="record-dot" /><strong>BARKING NOW</strong><small>BOTH SCORES ARE LIVE</small>
              </div>
            )}
            {roundPhase === "judging" && (
              <div className="judging-state"><span>✦</span><strong>WAITING FOR BOTH SCORES...</strong></div>
            )}
            <p>{arenaNote} · Headphones strongly recommended</p>
            <button className="leave-link" onClick={() => void leaveArena()}>Leave match</button>
          </div>
        </section>
      )}

      {stage === "results" && score && rivalScore && (
        <section className="results-screen">
          <div className="confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <p className="kicker">THE GLOBAL PACK HAS SPOKEN</p>
          <h2 className={winner ? "win-title" : "loss-title"}>{winner ? "TOP DOG!" : "SO CLOSE!"}</h2>
          <p className="result-sub">
            {winner
              ? `You out-barked ${rival.name} live. Absolutely unleashed.`
              : `${rival.name} took this one. Your comeback arc starts now.`}
          </p>
          <div className="scoreboard">
            <div className={`result-player ${winner ? "result-player--winner" : ""}`}>
              <div className="result-avatar">🐶</div><span>YOU</span><strong>{score.total}</strong><small>{rating} ELO</small>
            </div>
            <div className="score-divider"><span>FINAL</span><b>—</b></div>
            <div className={`result-player ${!winner ? "result-player--winner" : ""}`}>
              <div className="result-avatar">🐕</div><span>{rival.name}</span><strong>{rivalScore.total}</strong><small>{rival.rating} ELO</small>
            </div>
          </div>
          <div className="score-breakdown">
            {[
              ["POWER", score.power, rivalScore.power],
              ["CONTROL", score.control, rivalScore.control],
              ["CHARACTER", score.character, rivalScore.character],
            ].map(([label, yours, theirs]) => (
              <div key={label as string}>
                <strong>{yours}</strong>
                <span className="score-track"><i style={{ width: `${yours}%` }} /><b style={{ width: `${theirs}%` }} /></span>
                <small>{label}</small><strong>{theirs}</strong>
              </div>
            ))}
          </div>
          <div className="result-actions">
            <button className="primary-button" onClick={findNewRival}><span>FIND NEXT RIVAL</span><b>↻</b></button>
            <button className="secondary-button" onClick={() => setCurrentStage("leaderboard")}>GLOBAL LEADERBOARD</button>
          </div>
          <p className="rating-note">NEW GLOBAL RATING <strong>{rating}</strong> · RANK #{userRank}</p>
        </section>
      )}

      {stage === "leaderboard" && (
        <section className="leaderboard-screen">
          <div className="leaderboard-title">
            <div><p className="kicker">LIVE GLOBAL PACK RANKINGS</p><h2>THE BIG DOGS.</h2></div>
            <button className="primary-button compact" onClick={enterArena}><span>ENTER ARENA</span><b>→</b></button>
          </div>
          <div className="season-card">
            <div><span>SEASON 01</span><strong>THE SUMMER OF BARK</strong></div>
            <p><b>LIVE</b> worldwide ratings</p>
          </div>
          <div className="leaderboard-table">
            <div className="leaderboard-row table-head"><span>RANK</span><span>PUP</span><span>RECORD</span><span>ELO</span></div>
            {leaders.map((dog, index) => (
              <div className="leaderboard-row" key={`${dog.name}-${index}`}>
                <span className={`rank rank--${index + 1}`}>{index + 1}</span>
                <span className="leader-dog"><i>{dogFaces[index % dogFaces.length]}</i><b>{dog.name}<small>GLOBAL COMPETITOR</small></b></span>
                <span className="record-copy">{dog.wins}W · {dog.losses}L</span>
                <span className="elo"><b>{dog.rating}</b><small>LIVE</small></span>
              </div>
            ))}
            {!leaders.some((leader) => leader.name === displayName) && (
              <div className="leaderboard-row you-row">
                <span className="rank">—</span>
                <span className="leader-dog"><i>🐶</i><b>{displayName || "You"}<small>READY TO COMPETE</small></b></span>
                <span className="record-copy">{record.wins}W · {record.losses}L</span>
                <span className="elo"><b>{rating}</b><small>YOU</small></span>
              </div>
            )}
          </div>
          <p className="board-footnote">Every completed live bark-off updates the worldwide rankings.</p>
        </section>
      )}

      <footer>
        <span>BARKOFF © 2026</span>
        <span>BUILT WITH <b>♥</b> FOR CORGI HACKS</span>
        <span>LIVE P2P MEDIA · GLOBAL SIGNALING</span>
      </footer>
    </main>
  );
}
